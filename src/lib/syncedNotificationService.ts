import { supabaseAdmin } from './supabaseClient.js'
import { decryptSecret } from './secrets.js'
import { requestProviderPairing, requestProviderQr } from './providerAdapters.js'
import { insertEvent, persistProviderAuthentication } from './whatsappService.js'

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')

async function sendTechnicalEmail(to: string, subject: string, message: string) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATION_EMAIL_FROM
  if (!apiKey || !from) throw new Error('Email delivery requires RESEND_API_KEY and NOTIFICATION_EMAIL_FROM')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: `<p>${message.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      })[character]!)}</p>`
    })
  })
  const responseText = await response.text()
  if (!response.ok) throw new Error(`Email delivery failed with HTTP ${response.status}: ${responseText}`)
  return { channel: 'email', to, response: responseText }
}

function providerClient(integration: any, number: any) {
  const apiKey = integration.provider === 'uazapi'
    ? decryptSecret(number.provider_token || '')
    : decryptSecret(integration.credentials.apiKey)
  return {
    id: integration.id,
    integration_platform: integration.provider,
    integration_config: {
      baseUrl: integration.base_url,
      apiKey,
      instanceName: integration.provider === 'evolution' ? number.external_id : undefined,
      sessionName: integration.provider === 'waha' ? number.external_id : undefined
    }
  }
}

async function sendFrom(sender: any, to: string, text: string, qr?: string | null) {
  const { data: integration } = await supabaseAdmin.from('integrations').select('*')
    .eq('id', sender.integration_id).single()
  if (!integration) throw new Error('Sender integration not found')
  const key = integration.provider === 'uazapi'
    ? decryptSecret(sender.provider_token || '')
    : decryptSecret(integration.credentials.apiKey)
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (integration.provider === 'uazapi') headers.token = key
  if (integration.provider === 'evolution') headers.apikey = key
  if (integration.provider === 'waha') headers['X-Api-Key'] = key

  let endpoint = ''
  let body: any
  if (integration.provider === 'uazapi') {
    endpoint = qr ? '/send/media' : '/send/text'
    body = qr ? { number: to, type: 'image', file: qr, text } : { number: to, text }
  } else if (integration.provider === 'evolution') {
    endpoint = qr ? `/message/sendMedia/${encodeURIComponent(sender.external_id)}` : `/message/sendText/${encodeURIComponent(sender.external_id)}`
    body = qr
      ? { number: to, mediatype: 'image', media: qr, caption: text, fileName: 'qrcode.png' }
      : { number: to, text }
  } else {
    endpoint = qr ? '/api/sendImage' : '/api/sendText'
    body = qr
      ? { session: sender.external_id, chatId: `${to}@c.us`, file: { mimetype: 'image/png', filename: 'qrcode.png', data: qr.replace(/^data:image\/\w+;base64,/, '') }, caption: text }
      : { session: sender.external_id, chatId: `${to}@c.us`, text }
  }
  const response = await fetch(`${integration.base_url.replace(/\/+$/, '')}${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  })
  const responseText = await response.text()
  if (!response.ok) throw new Error(`${integration.provider} sender returned HTTP ${response.status}: ${responseText}`)
  return { provider: integration.provider, sender: sender.phone, response: responseText }
}

async function chooseSender(workspaceId: string) {
  const { data: settings } = await supabaseAdmin.from('workspace_notification_settings').select('*')
    .eq('workspace_id', workspaceId).single()
  for (const id of [settings?.primary_sender_id, settings?.fallback_sender_id]) {
    if (!id) continue
    const { data: sender } = await supabaseAdmin.from('whatsapp_numbers').select('*').eq('id', id).single()
    if (sender?.status === 'connected' && sender.workspace_id === workspaceId) return sender
  }
  throw new Error('No configured notification sender is connected')
}

async function cancelPendingRequests(numberId: string, status = 'cancelled') {
  await supabaseAdmin.from('reconnect_requests').update({
    status,
    completed_at: new Date().toISOString()
  }).eq('whatsapp_number_id', numberId).eq('status', 'pending')
}

async function startInteractiveRequest(workspace: any, current: any, sender: any) {
  await cancelPendingRequests(current.id)
  const expiresAt = new Date(Date.now() + Number(process.env.RECONNECT_REQUEST_TTL_MS || 900_000)).toISOString()
  const { data: request, error } = await supabaseAdmin.from('reconnect_requests').insert({
    workspace_id: workspace.id,
    whatsapp_number_id: current.id,
    sender_number_id: sender.id,
    recipient_phone: digits(current.phone),
    status: 'pending',
    expires_at: expiresAt
  }).select('*').single()
  if (error) throw error

  try {
    const result = await sendFrom(
      sender,
      digits(current.phone),
      `⚠️ O WhatsApp ${current.display_name || current.phone} perdeu a conexão com o sistema.\n\nComo deseja reconectar?\n\n1 - Gerar QR Code\n2 - Gerar código de pareamento\n\nResponda apenas com 1 ou 2. Esta solicitação expira em 15 minutos.`
    )
    await insertEvent(current.id, 'reconnect_choice_requested', {
      request_id: request.id,
      sender_number_id: sender.id,
      recipient_phone: digits(current.phone),
      expires_at: expiresAt,
      ...result
    })
  } catch (error) {
    await supabaseAdmin.from('reconnect_requests').update({
      status: 'failed',
      completed_at: new Date().toISOString()
    }).eq('id', request.id)
    throw error
  }
}

export type IncomingProviderMessage = {
  externalId: string
  instanceToken: string
  from: string
  text: string
  fromMe: boolean
}

export function normalizeIncomingProviderMessage(body: any): IncomingProviderMessage | null {
  const data = body?.data ?? {}
  const payload = body?.payload ?? {}
  const message = data?.message ?? body?.message ?? payload?.message ?? {}
  const key = data?.key ?? message?.key ?? {}
  const firstString = (...values: unknown[]) =>
    String(values.find((value) => typeof value === 'string') ?? '').trim()
  const eventName = firstString(body?.event, body?.EventType, body?.type).toLowerCase()
  const isMessageEvent = !eventName || ['message', 'messages', 'messages.upsert', 'messages_upsert'].includes(eventName)
  if (!isMessageEvent) return null
  const text = firstString(
    payload?.body, data?.body, message?.conversation, message?.text,
    message?.extendedTextMessage?.text, data?.message?.extendedTextMessage?.text
  )
  const from = digits(
    payload?.from ?? data?.from ?? key?.remoteJid ?? message?.chatid ??
    message?.chatId ?? body?.from ?? ''
  )
  const externalId = firstString(
    body?.instance, body?.instanceName, body?.session, data?.instance,
    payload?.session, body?.instance?.name
  )
  const instanceToken = firstString(body?.token, data?.token, payload?.token)
  const fromMe = Boolean(payload?.fromMe ?? data?.fromMe ?? key?.fromMe ?? message?.fromMe ?? false)
  if ((!externalId && !instanceToken) || !from || !text) return null
  return { externalId, instanceToken, from, text, fromMe }
}

export async function processIncomingProviderMessage(integration: any, incoming: IncomingProviderMessage) {
  if (incoming.fromMe || !['1', '2'].includes(incoming.text)) {
    return { handled: false, reason: incoming.fromMe ? 'outgoing_message' : 'not_a_reconnect_choice' }
  }

  let receivingSender: any = null
  if (incoming.externalId) {
    const result = await supabaseAdmin.from('whatsapp_numbers').select('*')
      .eq('integration_id', integration.id).eq('external_id', incoming.externalId).maybeSingle()
    receivingSender = result.data
  }
  if (!receivingSender && incoming.instanceToken && integration.provider === 'uazapi') {
    const { data: candidates } = await supabaseAdmin.from('whatsapp_numbers').select('*')
      .eq('integration_id', integration.id).not('provider_token', 'is', null)
    receivingSender = (candidates ?? []).find((candidate) => {
      try {
        return decryptSecret(candidate.provider_token) === incoming.instanceToken
      } catch {
        return false
      }
    })
  }
  if (!receivingSender) return { handled: false, reason: 'receiving_instance_not_found' }

  const now = new Date().toISOString()
  await supabaseAdmin.from('reconnect_requests').update({
    status: 'expired',
    completed_at: now
  }).eq('status', 'pending').eq('sender_number_id', receivingSender.id).lte('expires_at', now)

  const { data: requests } = await supabaseAdmin.from('reconnect_requests').select('*')
    .eq('status', 'pending')
    .eq('sender_number_id', receivingSender.id)
    .eq('recipient_phone', digits(incoming.from))
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
  const request = requests?.[0]
  if (!request) return { handled: false, reason: 'pending_request_not_found' }

  const { data: number } = await supabaseAdmin.from('whatsapp_numbers').select('*')
    .eq('id', request.whatsapp_number_id).single()
  if (!number) return { handled: false, reason: 'disconnected_number_not_found' }
  const { data: numberIntegration } = await supabaseAdmin.from('integrations').select('*')
    .eq('id', number.integration_id).single()
  const providerIntegration = numberIntegration
  if (!providerIntegration) throw new Error('Disconnected number integration not found')

  const method = incoming.text === '1' ? 'qr' : 'pairing'
  const { data: claimed } = await supabaseAdmin.from('reconnect_requests').update({
    status: 'processing',
    selected_method: method
  }).eq('id', request.id).eq('status', 'pending').select('id')
  if (!claimed?.length) return { handled: false, reason: 'request_already_processing' }

  try {
    const client = providerClient(providerIntegration, number)
    const providerResult = method === 'qr'
      ? await requestProviderQr(client, number)
      : await requestProviderPairing(client, number)
    const authentication = await persistProviderAuthentication(number, providerResult, method)
    const message = method === 'qr'
      ? `✅ QR Code gerado para ${number.display_name || number.phone}. Escaneie-o no WhatsApp para reconectar.`
      : `✅ Código de pareamento para ${number.display_name || number.phone}: *${authentication.pair_code}*\n\nDigite este código no WhatsApp para reconectar.`
    const result = await sendFrom(receivingSender, request.recipient_phone, message, authentication.qr_code)
    await supabaseAdmin.from('reconnect_requests').update({
      status: 'completed',
      selected_method: method,
      completed_at: new Date().toISOString()
    }).eq('id', request.id)
    await insertEvent(number.id, 'interactive_reconnect_delivered', {
      request_id: request.id, method, ...result
    })
    return { handled: true, requestId: request.id, method }
  } catch (error: any) {
    await supabaseAdmin.from('reconnect_requests').update({
      status: 'failed',
      selected_method: method,
      error_message: error.message,
      completed_at: new Date().toISOString()
    }).eq('id', request.id)
    await insertEvent(number.id, 'interactive_reconnect_failed', {
      request_id: request.id, method, error: error.message
    })
    try {
      await sendFrom(receivingSender, request.recipient_phone, 'Não foi possível gerar a reconexão agora. Avise o responsável técnico e tente novamente.')
    } catch { /* failure already recorded */ }
    throw error
  }
}

export async function processSyncedTransition(previous: any, current: any, integration: any) {
  const { data: workspace } = await supabaseAdmin.from('workspaces').select('*')
    .eq('id', integration.workspace_id).single()
  if (!workspace?.monitoring_enabled || !current.monitoring_enabled) return

  if (previous.status === 'connected' && current.status !== 'connected') {
    const cooldown = Number(process.env.ALERT_COOLDOWN_MS || 300_000)
    if (previous.last_alert_at && Date.now() - new Date(previous.last_alert_at).getTime() < cooldown) return
    await supabaseAdmin.from('whatsapp_numbers').update({ last_alert_at: new Date().toISOString() }).eq('id', current.id)
    let sender: any
    try {
      sender = await chooseSender(workspace.id)
    } catch (error: any) {
      await insertEvent(current.id, 'notification_failed', { type: 'sender_selection', error: error.message })
      return
    }
    const technicalPhone = digits(workspace.notify_whatsapp)
    const clientPhone = digits(current.phone)
    const technicalMessage = `O número ${current.display_name || current.phone} foi desconectado. O cliente recebeu as opções de reconexão.`
    if (technicalPhone && technicalPhone !== clientPhone) {
      try {
        const technicalResult = await sendFrom(
          sender,
          technicalPhone,
          `⚠️ ${technicalMessage}`
        )
        await insertEvent(current.id, 'technical_disconnect_notification_sent', technicalResult)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'technical_whatsapp_disconnect', error: error.message })
      }
    }
    if (workspace.notify_email) {
      try {
        const emailResult = await sendTechnicalEmail(
          workspace.notify_email,
          `WhatsApp desconectado — ${current.display_name || current.phone}`,
          technicalMessage
        )
        await insertEvent(current.id, 'technical_disconnect_email_sent', emailResult)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'technical_email_disconnect', error: error.message })
      }
    }
    try {
      await startInteractiveRequest(workspace, current, sender)
    } catch (error: any) {
      await insertEvent(current.id, 'notification_failed', { type: 'interactive_disconnect', error: error.message })
    }
  }

  if (previous.status !== 'connected' && current.status === 'connected') {
    await supabaseAdmin.from('whatsapp_numbers').update({ last_alert_at: null }).eq('id', current.id)
    await cancelPendingRequests(current.id, 'reconnected')
    await insertEvent(current.id, 'reconnected', { provider: integration.provider })
    if (workspace.notify_on_reconnect && workspace.notify_whatsapp) {
      try {
        const sender = await chooseSender(workspace.id)
        const result = await sendFrom(
          sender,
          digits(workspace.notify_whatsapp),
          `✅ O número ${current.display_name || current.phone} foi reconectado.`
        )
        await insertEvent(current.id, 'reconnect_notification_sent', result)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'reconnect', error: error.message })
      }
    }
    if (workspace.notify_on_reconnect && workspace.notify_email) {
      try {
        const emailResult = await sendTechnicalEmail(
          workspace.notify_email,
          `WhatsApp reconectado — ${current.display_name || current.phone}`,
          `O número ${current.display_name || current.phone} foi reconectado.`
        )
        await insertEvent(current.id, 'technical_reconnect_email_sent', emailResult)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'technical_email_reconnect', error: error.message })
      }
    }
  }
}
