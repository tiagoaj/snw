import { supabaseAdmin } from './supabaseClient.js'
import { sendEmail, unsubscribeUrl } from './emailService.js'

export type CampaignAudience =
  | 'all_clients'
  | 'active_subscribers'
  | 'trialing'
  | 'checkout_pending'
  | 'past_due'

let processingCampaigns = false
let campaignTimer: NodeJS.Timeout | null = null

async function campaignRecipients(audience: CampaignAudience) {
  const { data: users, error: usersError } = await supabaseAdmin.from('users')
    .select('id, email, full_name, role, status')
    .eq('status', 'active')
    .neq('role', 'superadmin')
  if (usersError) throw new Error(usersError.message)
  if (!users?.length) return []

  const userIds = users.map((user) => user.id)
  const { data: profiles, error: profilesError } = await supabaseAdmin.from('user_profiles')
    .select('user_id, workspace_id, role')
    .in('user_id', userIds)
    .eq('role', 'workspace_admin')
  if (profilesError) throw new Error(profilesError.message)
  const workspaceIds = [...new Set((profiles ?? []).map((profile) => profile.workspace_id).filter(Boolean))]
  const { data: subscriptions, error: subscriptionsError } = workspaceIds.length
    ? await supabaseAdmin.from('workspace_subscriptions')
      .select('workspace_id, status')
      .in('workspace_id', workspaceIds)
    : { data: [], error: null }
  if (subscriptionsError) throw new Error(subscriptionsError.message)

  const subscriptionStatus = new Map((subscriptions ?? []).map((subscription) => [
    subscription.workspace_id,
    subscription.status
  ]))
  const profilesByUser = new Map<string, any[]>()
  for (const profile of profiles ?? []) {
    profilesByUser.set(profile.user_id, [...(profilesByUser.get(profile.user_id) || []), profile])
  }

  const selected = users.flatMap((user) => {
    const userProfiles = profilesByUser.get(user.id) || []
    const requiredStatus = audience === 'active_subscribers' ? 'active' : audience
    const matchingProfile = audience === 'all_clients'
      ? userProfiles[0]
      : userProfiles.find((profile) => subscriptionStatus.get(profile.workspace_id) === requiredStatus)
    if (!matchingProfile) return []
    return [{
      user_id: user.id,
      workspace_id: matchingProfile.workspace_id,
      email: String(user.email).trim().toLowerCase(),
      full_name: user.full_name || null
    }]
  })

  const emails = [...new Set(selected.map((recipient) => recipient.email))]
  if (!emails.length) return []
  const [{ data: optOuts }, { data: suppressions }] = await Promise.all([
    supabaseAdmin.from('email_marketing_opt_outs').select('email').in('email', emails),
    supabaseAdmin.from('email_suppressions').select('email').in('email', emails)
  ])
  const blocked = new Set([
    ...(optOuts ?? []).map((item) => String(item.email).toLowerCase()),
    ...(suppressions ?? []).map((item) => String(item.email).toLowerCase())
  ])
  return selected.filter((recipient) => !blocked.has(recipient.email))
}

export async function estimateCampaignAudience(audience: CampaignAudience) {
  return (await campaignRecipients(audience)).length
}

export async function createEmailCampaign(input: {
  createdBy: string
  name: string
  audience: CampaignAudience
  subject: string
  preheader?: string
  contentText: string
  buttonLabel?: string
  buttonUrl?: string
}) {
  const recipients = await campaignRecipients(input.audience)
  const { data: campaign, error } = await supabaseAdmin.from('email_campaigns').insert({
    created_by: input.createdBy,
    name: input.name,
    audience: input.audience,
    subject: input.subject,
    preheader: input.preheader || null,
    content_text: input.contentText,
    button_label: input.buttonLabel || null,
    button_url: input.buttonUrl || null,
    status: 'queued',
    total_recipients: recipients.length
  }).select('*').single()
  if (error || !campaign) throw new Error(error?.message || 'Não foi possível criar a campanha')

  if (recipients.length) {
    const { error: recipientsError } = await supabaseAdmin.from('email_campaign_recipients').insert(
      recipients.map((recipient) => ({
        campaign_id: campaign.id,
        ...recipient
      }))
    )
    if (recipientsError) {
      await supabaseAdmin.from('email_campaigns').update({
        status: 'failed',
        last_error: recipientsError.message
      }).eq('id', campaign.id)
      throw new Error(recipientsError.message)
    }
  } else {
    await supabaseAdmin.from('email_campaigns').update({
      status: 'completed',
      completed_at: new Date().toISOString()
    }).eq('id', campaign.id)
  }
  return { ...campaign, total_recipients: recipients.length }
}

async function processCampaign(campaign: any) {
  const { data: claimed } = await supabaseAdmin.from('email_campaigns').update({
    status: 'sending',
    started_at: campaign.started_at || new Date().toISOString(),
    last_error: null
  }).eq('id', campaign.id).in('status', ['queued', 'sending']).select('*').single()
  if (!claimed) return

  while (true) {
    const { data: recipients, error } = await supabaseAdmin.from('email_campaign_recipients')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('status', 'pending')
      .order('created_at')
      .limit(25)
    if (error) throw new Error(error.message)
    if (!recipients?.length) break

    for (const recipient of recipients) {
      const { data: reserved } = await supabaseAdmin.from('email_campaign_recipients').update({
        status: 'processing'
      }).eq('id', recipient.id).eq('status', 'pending').select('id')
      if (!reserved?.length) continue
      try {
        const result = await sendEmail({
          recipient: {
            email: recipient.email,
            name: recipient.full_name,
            userId: recipient.user_id,
            workspaceId: recipient.workspace_id
          },
          category: 'marketing',
          templateKey: 'campaign',
          campaignId: campaign.id,
          marketing: true,
          idempotencyKey: `campaign:${campaign.id}:${recipient.id}`,
          variables: {
            subject: campaign.subject,
            title: campaign.subject,
            preheader: campaign.preheader,
            contentText: campaign.content_text,
            buttonLabel: campaign.button_label,
            buttonUrl: campaign.button_url,
            unsubscribeUrl: unsubscribeUrl(recipient.email)
          }
        })
        await supabaseAdmin.from('email_campaign_recipients').update({
          status: result.delivered ? 'sent' : 'skipped',
          provider_email_id: result.id || null,
          sent_at: result.delivered ? new Date().toISOString() : null,
          error_message: result.suppressed ? 'Destinatário suprimido ou descadastrado' : null
        }).eq('id', recipient.id)
      } catch (sendError: any) {
        await supabaseAdmin.from('email_campaign_recipients').update({
          status: 'failed',
          error_message: sendError.message
        }).eq('id', recipient.id)
      }
      // Mantém o envio abaixo de aproximadamente duas requisições por segundo.
      await new Promise((resolve) => setTimeout(resolve, 550))
    }
  }

  const [{ count: sent }, { count: failed }, { count: pending }] = await Promise.all([
    supabaseAdmin.from('email_campaign_recipients').select('id', { head: true, count: 'exact' })
      .eq('campaign_id', campaign.id).eq('status', 'sent'),
    supabaseAdmin.from('email_campaign_recipients').select('id', { head: true, count: 'exact' })
      .eq('campaign_id', campaign.id).in('status', ['failed', 'skipped']),
    supabaseAdmin.from('email_campaign_recipients').select('id', { head: true, count: 'exact' })
      .eq('campaign_id', campaign.id).in('status', ['pending', 'processing'])
  ])
  await supabaseAdmin.from('email_campaigns').update({
    status: pending ? 'sending' : 'completed',
    sent_count: sent || 0,
    failed_count: failed || 0,
    completed_at: pending ? null : new Date().toISOString()
  }).eq('id', campaign.id)
}

export async function processQueuedEmailCampaigns() {
  if (processingCampaigns) return
  processingCampaigns = true
  try {
    const { data: campaigns, error } = await supabaseAdmin.from('email_campaigns')
      .select('*')
      .in('status', ['queued', 'sending'])
      .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
      .order('created_at')
      .limit(3)
    if (error) {
      if (error.code !== '42P01') console.error('Email campaign queue failed:', error.message)
      return
    }
    for (const campaign of campaigns ?? []) {
      try {
        await processCampaign(campaign)
      } catch (campaignError: any) {
        await supabaseAdmin.from('email_campaigns').update({
          status: 'failed',
          last_error: campaignError.message
        }).eq('id', campaign.id)
      }
    }
  } finally {
    processingCampaigns = false
  }
}

export function startEmailCampaignWorker() {
  if (campaignTimer) return
  const configured = Number(process.env.EMAIL_CAMPAIGN_INTERVAL_MS || 60_000)
  const interval = Number.isFinite(configured) ? Math.max(30_000, configured) : 60_000
  void processQueuedEmailCampaigns()
  campaignTimer = setInterval(() => void processQueuedEmailCampaigns(), interval)
  campaignTimer.unref()
  console.log(`Fila de campanhas de e-mail ativa a cada ${interval}ms`)
}
