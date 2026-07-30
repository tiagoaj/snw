import express, { Router } from 'express'
import { Webhook } from 'svix'
import { AuthRequest, requireAuth, requireRole } from './auth.js'
import { writeAuditLog } from './auditService.js'
import {
  CampaignAudience,
  createEmailCampaign,
  estimateCampaignAudience,
  processQueuedEmailCampaigns
} from './emailCampaignService.js'
import {
  invalidateEmailTemplateCache,
  registerResendEvent,
  sendEmail,
  unsubscribeUrl,
  verifyUnsubscribeToken
} from './emailService.js'
import {
  emailTemplateCatalog,
  EmailTemplateKey
} from './emailTemplates.js'
import { supabaseAdmin } from './supabaseClient.js'

const router = Router()
const formParser = express.urlencoded({ extended: false })
const audiences: CampaignAudience[] = [
  'all_clients',
  'active_subscribers',
  'trialing',
  'checkout_pending',
  'past_due'
]
const templateKeys = Object.keys(emailTemplateCatalog) as EmailTemplateKey[]
const editableTemplateFields = [
  'subject_template',
  'preheader_template',
  'eyebrow_template',
  'title_template',
  'content_template',
  'button_label_template',
  'button_url_template'
] as const

function validHttpsUrl(value: unknown) {
  if (!value) return true
  try {
    return new URL(String(value)).protocol === 'https:'
  } catch {
    return false
  }
}

function unsubscribePage(message: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preferências de e-mail</title></head><body style="margin:0;background:#06110e;color:#eef7f3;font-family:Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px;border:1px solid #193a30;border-radius:18px;background:#0b1b16"><h1>SNW<span style="color:#42e3a5">•</span></h1><p style="color:#a9bbb5;line-height:1.7">${message}</p></main></body></html>`
}

router.get('/email/unsubscribe', (req, res) => {
  const email = String(req.query.email || '')
  const token = String(req.query.token || '')
  try {
    if (!email || !token || !verifyUnsubscribeToken(email, token)) {
      return res.status(400).send(unsubscribePage('Este link de descadastro é inválido ou foi alterado.'))
    }
  } catch {
    return res.status(503).send(unsubscribePage('As preferências de e-mail ainda não estão configuradas.'))
  }
  const action = `/api/email/unsubscribe?${new URLSearchParams({ email, token }).toString()}`
  res.send(unsubscribePage(`Deseja parar de receber comunicações comerciais do SNW?<form method="post" action="${action}" style="margin-top:24px"><button style="border:0;border-radius:10px;background:#42e3a5;padding:13px 18px;font-weight:800;cursor:pointer">Cancelar comunicações comerciais</button></form>`))
})

router.post('/email/unsubscribe', formParser, async (req, res) => {
  const email = String(req.query.email || req.body?.email || '').trim().toLowerCase()
  const token = String(req.query.token || req.body?.token || '')
  try {
    if (!email || !token || !verifyUnsubscribeToken(email, token)) {
      return res.status(400).send(unsubscribePage('Este link de descadastro é inválido ou foi alterado.'))
    }
    const { error } = await supabaseAdmin.from('email_marketing_opt_outs').upsert({
      email,
      reason: 'user_request',
      source: req.header('list-unsubscribe') ? 'one_click' : 'unsubscribe_link'
    }, { onConflict: 'email' })
    if (error) throw new Error(error.message)
    res.send(unsubscribePage('Pronto. Você não receberá mais campanhas e comunicações comerciais. Alertas operacionais e mensagens essenciais da sua conta continuam ativos.'))
  } catch (error: any) {
    res.status(500).send(unsubscribePage(`Não foi possível salvar sua preferência agora: ${String(error.message).replace(/[<>&]/g, '')}`))
  }
})

router.post('/webhooks/resend', async (req: any, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET is not configured' })
  try {
    const payload = new Webhook(secret).verify(req.rawBody || JSON.stringify(req.body), {
      'svix-id': String(req.header('svix-id') || ''),
      'svix-timestamp': String(req.header('svix-timestamp') || ''),
      'svix-signature': String(req.header('svix-signature') || '')
    }) as any
    const result = await registerResendEvent({
      svixId: String(req.header('svix-id')),
      type: String(payload.type || ''),
      payload
    })
    res.json(result)
  } catch (error: any) {
    res.status(400).json({ error: `Invalid Resend webhook: ${error.message}` })
  }
})

router.get('/admin/email-templates', requireAuth, requireRole(['superadmin']), async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('email_templates').select('*')
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    return res.status(500).json({ error: error.message })
  }
  const overrides = new Map((data || []).map((item: any) => [item.template_key, item]))
  res.json({
    templates: templateKeys.map((key) => {
      const override = overrides.get(key)
      return {
        ...emailTemplateCatalog[key],
        ...(override || {}),
        customized: Boolean(override),
        updated_at: override?.updated_at || null
      }
    })
  })
})

router.put('/admin/email-templates/:template_key', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const key = String(req.params.template_key) as EmailTemplateKey
  if (!templateKeys.includes(key)) return res.status(404).json({ error: 'Tipo de e-mail não encontrado' })
  const updates: Record<string, string> = {}
  for (const field of editableTemplateFields) {
    if (typeof req.body?.[field] !== 'string') {
      return res.status(400).json({ error: `O campo ${field} deve ser informado` })
    }
    updates[field] = req.body[field].trim()
  }
  if (!updates.subject_template || !updates.title_template || !updates.content_template) {
    return res.status(400).json({ error: 'Assunto, título e mensagem não podem ficar vazios' })
  }
  if (updates.button_url_template && !updates.button_url_template.includes('{{') && !validHttpsUrl(updates.button_url_template)) {
    return res.status(400).json({ error: 'A URL fixa do botão deve começar com https://' })
  }
  const { data, error } = await supabaseAdmin.from('email_templates').upsert({
    template_key: key,
    ...updates,
    updated_by: req.currentUser!.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'template_key' }).select('*').single()
  if (error) return res.status(500).json({
    error: error.code === '42P01' || error.code === 'PGRST205'
      ? 'Execute a migration supabase/email-templates.sql antes de editar os modelos'
      : error.message
  })
  invalidateEmailTemplateCache(key)
  await writeAuditLog({
    userId: req.currentUser!.id,
    action: 'email_template.updated',
    entityType: 'email_template',
    metadata: { template_key: key }
  })
  res.json({
    template: {
      ...emailTemplateCatalog[key],
      ...data,
      customized: true
    }
  })
})

router.delete('/admin/email-templates/:template_key', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const key = String(req.params.template_key) as EmailTemplateKey
  if (!templateKeys.includes(key)) return res.status(404).json({ error: 'Tipo de e-mail não encontrado' })
  const { error } = await supabaseAdmin.from('email_templates').delete().eq('template_key', key)
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    return res.status(500).json({ error: error.message })
  }
  invalidateEmailTemplateCache(key)
  await writeAuditLog({
    userId: req.currentUser!.id,
    action: 'email_template.reset',
    entityType: 'email_template',
    metadata: { template_key: key }
  })
  res.json({ template: { ...emailTemplateCatalog[key], customized: false, updated_at: null } })
})

router.get('/admin/email-messages', requireAuth, requireRole(['superadmin']), async (req, res) => {
  const requestedLimit = Number(req.query.limit || 100)
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(10, requestedLimit)) : 100
  const { data, error } = await supabaseAdmin.from('email_messages')
    .select('id,recipient_email,recipient_name,category,template_key,subject,status,error_message,sent_at,delivered_at,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ messages: data || [] })
})

router.get('/admin/email-campaigns', requireAuth, requireRole(['superadmin']), async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('email_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ campaigns: data || [] })
})

router.get('/admin/email-campaigns/audience-count', requireAuth, requireRole(['superadmin']), async (req, res) => {
  const audience = String(req.query.audience || '') as CampaignAudience
  if (!audiences.includes(audience)) return res.status(400).json({ error: 'Público inválido' })
  try {
    res.json({ count: await estimateCampaignAudience(audience) })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.post('/admin/email-campaigns/test', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const { test_email, subject, preheader, content_text, button_label, button_url } = req.body || {}
  if (!test_email || !subject || !content_text) {
    return res.status(400).json({ error: 'Informe e-mail de teste, assunto e conteúdo' })
  }
  if (!validHttpsUrl(button_url)) return res.status(400).json({ error: 'A URL do botão deve começar com https://' })
  try {
    const result = await sendEmail({
      recipient: { email: test_email, name: req.currentUserRow?.full_name, userId: req.currentUser?.id },
      category: 'marketing',
      templateKey: 'campaign',
      variables: {
        subject,
        title: subject,
        preheader,
        contentText: content_text,
        buttonLabel: button_label,
        buttonUrl: button_url
      }
    })
    res.json({ success: true, result })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.post('/admin/email-campaigns', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const {
    name, audience, subject, preheader, content_text, button_label, button_url
  } = req.body || {}
  if (!name || !audiences.includes(audience) || !subject || !content_text) {
    return res.status(400).json({ error: 'Informe nome, público, assunto e conteúdo' })
  }
  if (!validHttpsUrl(button_url)) return res.status(400).json({ error: 'A URL do botão deve começar com https://' })
  try {
    // Falha cedo se o segredo obrigatório dos links de descadastro não existir.
    unsubscribeUrl(req.currentUserRow?.email || req.currentUser?.email || '')
    const campaign = await createEmailCampaign({
      createdBy: req.currentUser!.id,
      name,
      audience,
      subject,
      preheader,
      contentText: content_text,
      buttonLabel: button_label,
      buttonUrl: button_url
    })
    await writeAuditLog({
      userId: req.currentUser!.id,
      action: 'email_campaign.created',
      entityType: 'email_campaign',
      entityId: campaign.id,
      metadata: { audience, total_recipients: campaign.total_recipients }
    })
    void processQueuedEmailCampaigns()
    res.status(201).json({ campaign })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

export default router
