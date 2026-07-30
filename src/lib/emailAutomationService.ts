import { supabaseAdmin } from './supabaseClient.js'
import { sendEmail, unsubscribeUrl } from './emailService.js'

let automationRunning = false
let automationTimer: NodeJS.Timeout | null = null

async function workspaceOwner(workspaceId: string) {
  const { data: profile } = await supabaseAdmin.from('user_profiles')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'workspace_admin')
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!profile?.user_id) return null
  const { data: user } = await supabaseAdmin.from('users')
    .select('id, email, full_name')
    .eq('id', profile.user_id)
    .maybeSingle()
  return user || null
}

async function saveAutomationMetadata(subscription: any, key: string) {
  await supabaseAdmin.from('workspace_subscriptions').update({
    metadata: {
      ...(subscription.metadata || {}),
      email_automation: {
        ...(subscription.metadata?.email_automation || {}),
        [key]: new Date().toISOString()
      }
    }
  }).eq('id', subscription.id)
}

async function processSubscription(subscription: any) {
  const now = Date.now()
  const flags = subscription.metadata?.email_automation || {}
  const owner = await workspaceOwner(subscription.workspace_id)
  if (!owner?.email) return

  if (subscription.status === 'trialing' && subscription.trial_ends_at && !flags.trial_ending) {
    const trialEnd = new Date(subscription.trial_ends_at).getTime()
    const remaining = trialEnd - now
    if (remaining > 0 && remaining <= 48 * 60 * 60 * 1000) {
      await sendEmail({
        recipient: {
          email: owner.email,
          name: owner.full_name,
          userId: owner.id,
          workspaceId: subscription.workspace_id
        },
        category: 'platform',
        templateKey: 'trial_ending',
        idempotencyKey: `trial-ending:${subscription.id}`,
        variables: {
          trialEndsAt: new Date(subscription.trial_ends_at).toLocaleString('pt-BR'),
          dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
        }
      })
      await saveAutomationMetadata(subscription, 'trial_ending')
    }
    return
  }

  if (subscription.status !== 'checkout_pending' || !subscription.checkout_expires_at || !subscription.asaas_checkout_url) {
    return
  }
  const expiresAt = new Date(subscription.checkout_expires_at).getTime()
  const remaining = expiresAt - now
  if (remaining <= 0) return

  let reminder: 'cart_last_call' | 'cart_first_reminder' | null = null
  let subject = ''
  if (remaining <= 6 * 60 * 60 * 1000 && !flags.cart_last_call) {
    reminder = 'cart_last_call'
    subject = 'Seu link de pagamento expira em poucas horas'
  } else if (remaining <= 23 * 60 * 60 * 1000 && !flags.cart_first_reminder) {
    reminder = 'cart_first_reminder'
    subject = 'Falta concluir sua assinatura do SNW'
  }
  if (!reminder) return

  await sendEmail({
    recipient: {
      email: owner.email,
      name: owner.full_name,
      userId: owner.id,
      workspaceId: subscription.workspace_id
    },
    category: 'cart_recovery',
    templateKey: 'cart_recovery',
    marketing: true,
    idempotencyKey: `${reminder}:${subscription.id}`,
    variables: {
      subject,
      checkoutUrl: subscription.asaas_checkout_url,
      unsubscribeUrl: unsubscribeUrl(owner.email)
    }
  })
  await saveAutomationMetadata(subscription, reminder)
}

export async function processEmailAutomations() {
  if (automationRunning) return
  automationRunning = true
  try {
    const { data, error } = await supabaseAdmin.from('workspace_subscriptions')
      .select('*')
      .in('status', ['trialing', 'checkout_pending'])
      .limit(500)
    if (error) {
      if (error.code !== '42P01') console.error('Email automation query failed:', error.message)
      return
    }
    for (const subscription of data ?? []) {
      try {
        await processSubscription(subscription)
      } catch (error: any) {
        console.error(`Email automation failed for ${subscription.id}:`, error.message)
      }
    }
  } finally {
    automationRunning = false
  }
}

export function startEmailAutomationWorker() {
  if (automationTimer) return
  const configured = Number(process.env.EMAIL_AUTOMATION_INTERVAL_MS || 900_000)
  const interval = Number.isFinite(configured) ? Math.max(60_000, configured) : 900_000
  void processEmailAutomations()
  automationTimer = setInterval(() => void processEmailAutomations(), interval)
  automationTimer.unref()
  console.log(`Automações de e-mail ativas a cada ${interval}ms`)
}
