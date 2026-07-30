import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from './supabaseClient.js'
import {
  EmailTemplateOverride,
  EmailTemplateKey,
  renderEmailTemplate
} from './emailTemplates.js'

export type EmailCategory = 'status' | 'billing' | 'platform' | 'marketing' | 'cart_recovery'

export type EmailRecipient = {
  email: string
  name?: string | null
  userId?: string | null
  workspaceId?: string | null
}

export type SendEmailInput = {
  recipient: EmailRecipient
  category: EmailCategory
  templateKey: EmailTemplateKey
  variables: Record<string, unknown>
  idempotencyKey?: string
  campaignId?: string | null
  marketing?: boolean
  attachments?: Array<{ filename: string; content: string }>
}

const templateCache = new Map<EmailTemplateKey, {
  value: EmailTemplateOverride | null
  expiresAt: number
}>()

export function invalidateEmailTemplateCache(key?: EmailTemplateKey) {
  if (key) templateCache.delete(key)
  else templateCache.clear()
}

async function emailTemplateOverride(key: EmailTemplateKey) {
  const cached = templateCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const { data, error } = await supabaseAdmin.from('email_templates')
    .select('subject_template,preheader_template,eyebrow_template,title_template,content_template,button_label_template,button_url_template')
    .eq('template_key', key)
    .maybeSingle()
  if (error) {
    if (error.code !== '42P01' && error.code !== 'PGRST205') {
      console.warn(`Email template override lookup failed (${key}):`, error.message)
    }
    templateCache.set(key, { value: null, expiresAt: Date.now() + 30_000 })
    return null
  }
  const value = data as EmailTemplateOverride | null
  templateCache.set(key, { value, expiresAt: Date.now() + 60_000 })
  return value
}

function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATION_EMAIL_FROM
  if (!apiKey || !from) {
    throw new Error('Configure RESEND_API_KEY e NOTIFICATION_EMAIL_FROM')
  }
  return { apiKey, from }
}

function normalizedEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function publicApiUrl() {
  return (process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN || '')
    .split(',')[0]
    .replace(/\/+$/, '')
}

function unsubscribeSecret() {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET
  if (!secret || secret.length < 24) {
    throw new Error('EMAIL_UNSUBSCRIBE_SECRET deve ter pelo menos 24 caracteres')
  }
  return secret
}

export function createUnsubscribeToken(email: string) {
  return createHmac('sha256', unsubscribeSecret())
    .update(normalizedEmail(email))
    .digest('base64url')
}

export function verifyUnsubscribeToken(email: string, token: string) {
  const expected = Buffer.from(createUnsubscribeToken(email))
  const received = Buffer.from(String(token || ''))
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function unsubscribeUrl(email: string) {
  const baseUrl = publicApiUrl()
  if (!baseUrl) throw new Error('APP_PUBLIC_URL não está configurada')
  const params = new URLSearchParams({
    email: normalizedEmail(email),
    token: createUnsubscribeToken(email)
  })
  return `${baseUrl}/api/email/unsubscribe?${params.toString()}`
}

async function isSuppressed(email: string, marketing: boolean) {
  const normalized = normalizedEmail(email)
  const checks = [
    supabaseAdmin.from('email_suppressions').select('id').ilike('email', normalized).limit(1).maybeSingle()
  ]
  if (marketing) {
    checks.push(
      supabaseAdmin.from('email_marketing_opt_outs').select('id').ilike('email', normalized).limit(1).maybeSingle()
    )
  }
  const results = await Promise.all(checks)
  return results.some((result) => Boolean(result.data))
}

async function insertMessage(input: SendEmailInput, subject: string, status = 'queued') {
  const { data, error } = await supabaseAdmin.from('email_messages').insert({
    workspace_id: input.recipient.workspaceId || null,
    user_id: input.recipient.userId || null,
    campaign_id: input.campaignId || null,
    category: input.category,
    template_key: input.templateKey,
    recipient_email: normalizedEmail(input.recipient.email),
    recipient_name: input.recipient.name || null,
    subject,
    status,
    idempotency_key: input.idempotencyKey || null,
    metadata: input.variables
  }).select('*').single()
  if (error) {
    // Durante o primeiro deploy o envio transacional não deve parar apenas
    // porque a migration de auditoria ainda não foi aplicada.
    console.warn('Email audit insert failed:', error.message)
    return null
  }
  return data
}

async function updateMessage(id: string | undefined, updates: Record<string, unknown>) {
  if (!id) return
  const { error } = await supabaseAdmin.from('email_messages').update(updates).eq('id', id)
  if (error) console.warn('Email audit update failed:', error.message)
}

export async function sendEmail(input: SendEmailInput) {
  const email = normalizedEmail(input.recipient.email)
  if (!validEmail(email)) throw new Error('E-mail do destinatário é inválido')
  const override = await emailTemplateOverride(input.templateKey)
  const rendered = renderEmailTemplate(input.templateKey, {
    ...input.variables,
    customerName: input.variables.customerName || input.recipient.name || ''
  }, override)
  const message = await insertMessage(input, rendered.subject)

  try {
    if (await isSuppressed(email, Boolean(input.marketing))) {
      await updateMessage(message?.id, {
        status: 'suppressed',
        error_message: 'Destinatário suprimido ou descadastrado'
      })
      return { delivered: false, suppressed: true, email }
    }
  } catch (error: any) {
    // A ausência temporária das tabelas novas não deve bloquear alertas críticos.
    console.warn('Email suppression check failed:', error.message)
  }

  const { apiKey, from } = resendConfig()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'SNW-WhatsApp-Operations/1.0'
  }
  if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey.slice(0, 256)
  const marketingUrl = input.marketing ? unsubscribeUrl(email) : null
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from,
      to: [email],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(marketingUrl ? {
        headers: {
          'List-Unsubscribe': `<${marketingUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      } : {}),
      tags: [
        { name: 'category', value: input.category.replace(/[^a-zA-Z0-9_-]/g, '_') },
        { name: 'template', value: input.templateKey.replace(/[^a-zA-Z0-9_-]/g, '_') }
      ]
    })
  })
  const responseText = await response.text()
  let body: any = {}
  try { body = responseText ? JSON.parse(responseText) : {} } catch { /* handled below */ }
  if (!response.ok || !body.id) {
    const errorMessage = body?.message || `Resend retornou HTTP ${response.status}: ${responseText}`
    await updateMessage(message?.id, { status: 'failed', error_message: errorMessage })
    throw new Error(errorMessage)
  }
  await updateMessage(message?.id, {
    provider_email_id: body.id,
    status: 'sent',
    sent_at: new Date().toISOString(),
    error_message: null
  })
  return { delivered: true, id: body.id, email, messageId: message?.id || null }
}

export async function registerResendEvent(input: {
  svixId: string
  type: string
  payload: any
}) {
  const providerEmailId = String(input.payload?.data?.email_id || '')
  const { data: event, error } = await supabaseAdmin.from('email_webhook_events').insert({
    svix_id: input.svixId,
    event_type: input.type,
    provider_email_id: providerEmailId || null,
    payload: input.payload
  }).select('id').single()
  if (error?.code === '23505') return { duplicate: true }
  if (error || !event) throw new Error(error?.message || 'Não foi possível registrar o webhook da Resend')

  try {
    const statusMap: Record<string, string> = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'delayed',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
      'email.failed': 'failed'
    }
    const status = statusMap[input.type]
    if (providerEmailId && status) {
      const updates: Record<string, unknown> = { status }
      if (status === 'delivered') updates.delivered_at = input.payload.created_at || new Date().toISOString()
      if (['bounced', 'complained', 'failed'].includes(status)) {
        updates.error_message = input.payload?.data?.bounce?.message || input.payload?.data?.reason || input.type
      }
      await supabaseAdmin.from('email_messages').update(updates).eq('provider_email_id', providerEmailId)
    }

    if (['email.bounced', 'email.complained'].includes(input.type)) {
      const recipients = Array.isArray(input.payload?.data?.to) ? input.payload.data.to : []
      for (const recipient of recipients) {
        const email = normalizedEmail(recipient)
        if (!validEmail(email)) continue
        await supabaseAdmin.from('email_suppressions').upsert({
          email,
          reason: input.type === 'email.bounced' ? 'bounced' : 'complained',
          provider_event_id: input.svixId,
          metadata: input.payload?.data || {}
        }, { onConflict: 'email' })
      }
    }

    await supabaseAdmin.from('email_webhook_events').update({
      processed_at: new Date().toISOString(),
      error_message: null
    }).eq('id', event.id)
    return { processed: true }
  } catch (processingError: any) {
    await supabaseAdmin.from('email_webhook_events').update({
      error_message: processingError.message
    }).eq('id', event.id)
    throw processingError
  }
}
