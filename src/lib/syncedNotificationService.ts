import { supabaseAdmin } from './supabaseClient.js'
import { decryptSecret } from './secrets.js'
import {
  getProviderStatus,
  requestProviderPairing,
  requestProviderQr
} from './providerAdapters.js'
import { insertEvent, persistProviderAuthentication } from './whatsappService.js'
import { workspaceBillingAccess } from './billingAccessService.js'
import { sendEmail } from './emailService.js'

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
const manualReconnectWatchers = new Set<string>()

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

async function verifyLiveStatusBeforeAuthentication(
  integration: any,
  number: any,
  source: 'interactive' | 'manual'
) {
  const providerResult = await getProviderStatus(providerClient(integration, number))
  await insertEvent(number.id, 'reconnect_generation_status_checked', {
    provider: integration.provider,
    source,
    live_status: providerResult.status
  })

  if (providerResult.status !== 'connected') {
    return { status: providerResult.status, number }
  }

  const checkedAt = new Date().toISOString()
  const { data: connected, error } = await supabaseAdmin.from('whatsapp_numbers')
    .update({
      status: 'connected',
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      consecutive_failures: 0
    })
    .eq('id', number.id)
    .select('*')
    .single()
  if (error || !connected) throw new Error(error?.message || 'Não foi possível atualizar o estado do número')

  await insertEvent(number.id, 'reconnect_generation_skipped_connected', {
    provider: integration.provider,
    source
  })
  if (number.status !== 'connected') {
    try {
      await processSyncedTransition(number, connected, integration)
    } catch (error: any) {
      await insertEvent(number.id, 'notification_failed', {
        type: 'reconnect_after_authentication_guard',
        source,
        error: error.message
      })
    }
  }
  return { status: 'connected' as const, number: connected }
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

export async function sendWorkspaceBillingNotification(
  workspaceId: string,
  subject: string,
  message: string
) {
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single()
  if (workspaceError || !workspace) throw new Error(workspaceError?.message || 'Workspace not found')

  let accountUser: { id: string; email: string; full_name?: string | null } | null = null
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'workspace_admin')
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (profile?.user_id) {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .eq('id', profile.user_id)
      .maybeSingle()
    accountUser = user || null
  }

  const results: Array<{ channel: string; delivered: boolean; error?: string }> = []
  const email = workspace.notify_email || accountUser?.email
  if (email) {
    try {
      const paymentUrl = message.match(/https:\/\/[^\s]+/)?.[0]
      await sendEmail({
        recipient: {
          email,
          name: accountUser?.full_name,
          userId: accountUser?.id,
          workspaceId
        },
        category: 'billing',
        templateKey: 'billing_notice',
        variables: { subject, message, buttonUrl: paymentUrl }
      })
      results.push({ channel: 'email', delivered: true })
    } catch (error: any) {
      results.push({ channel: 'email', delivered: false, error: error.message })
    }
  }
  if (workspace.notify_whatsapp) {
    try {
      const sender = await chooseSender(workspaceId)
      await sendFrom(sender, digits(workspace.notify_whatsapp), message)
      results.push({ channel: 'whatsapp', delivered: true })
    } catch (error: any) {
      results.push({ channel: 'whatsapp', delivered: false, error: error.message })
    }
  }
  return results
}

async function cancelPendingRequests(numberId: string, status = 'cancelled') {
  await supabaseAdmin.from('reconnect_requests').update({
    status,
    completed_at: new Date().toISOString()
  }).eq('whatsapp_number_id', numberId).eq('status', 'pending')
}

async function hasDeliveredOpenDisconnect(numberId: string) {
  const { data: lifecycle, error: lifecycleError } = await supabaseAdmin.from('events')
    .select('event_type, created_at')
    .eq('whatsapp_number_id', numberId)
    .in('event_type', ['disconnect', 'reconnected'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (lifecycleError) throw new Error(lifecycleError.message)
  const lastTransition = lifecycle?.[0]
  if (!lastTransition || lastTransition.event_type !== 'disconnect') return false

  const { data: deliveries, error: deliveryError } = await supabaseAdmin.from('events')
    .select('id')
    .eq('whatsapp_number_id', numberId)
    .in('event_type', [
      'technical_disconnect_notification_sent',
      'technical_disconnect_email_sent',
      'reconnect_choice_requested',
      'manual_reconnect_authentication_sent'
    ])
    .gte('created_at', lastTransition.created_at)
    .limit(1)
  if (deliveryError) throw new Error(deliveryError.message)
  return Boolean(deliveries?.length)
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
  const billingAccess = await workspaceBillingAccess(integration.workspace_id)
  if (!billingAccess.communications_allowed) {
    return { handled: false, reason: 'billing_blocked' }
  }
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
  if (!request) {
    const recentCutoff = new Date(
      Date.now() - Number(process.env.RECONNECT_REQUEST_TTL_MS || 900_000)
    ).toISOString()
    const { data: reconnectedRequests } = await supabaseAdmin.from('reconnect_requests').select('*')
      .eq('status', 'reconnected')
      .eq('sender_number_id', receivingSender.id)
      .eq('recipient_phone', digits(incoming.from))
      .gte('completed_at', recentCutoff)
      .order('completed_at', { ascending: false })
      .limit(1)
    const reconnectedRequest = reconnectedRequests?.[0]
    if (!reconnectedRequest) return { handled: false, reason: 'pending_request_not_found' }

    const { data: reconnectedNumber } = await supabaseAdmin.from('whatsapp_numbers')
      .select('id, display_name, phone')
      .eq('id', reconnectedRequest.whatsapp_number_id)
      .single()
    const message = `✅ O WhatsApp ${reconnectedNumber?.display_name || reconnectedNumber?.phone || 'monitorado'} já está conectado. Não é necessário gerar um novo QR Code ou código de pareamento.`
    const result = await sendFrom(receivingSender, digits(incoming.from), message)
    if (reconnectedNumber) {
      await insertEvent(reconnectedNumber.id, 'interactive_reconnect_reply_after_reconnected', {
        request_id: reconnectedRequest.id,
        ...result
      })
    }
    return {
      handled: true,
      requestId: reconnectedRequest.id,
      skipped: true,
      reason: 'already_reconnected'
    }
  }

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
    const live = await verifyLiveStatusBeforeAuthentication(providerIntegration, number, 'interactive')
    if (live.status === 'connected') {
      const completedAt = new Date().toISOString()
      await supabaseAdmin.from('reconnect_requests').update({
        status: 'reconnected',
        selected_method: method,
        error_message: null,
        completed_at: completedAt
      }).eq('id', request.id)
      const message = `✅ O WhatsApp ${number.display_name || number.phone} já está conectado. Não é necessário gerar um novo QR Code ou código de pareamento.`
      const result = await sendFrom(receivingSender, request.recipient_phone, message)
      await insertEvent(number.id, 'interactive_reconnect_skipped_connected', {
        request_id: request.id,
        method,
        ...result
      })
      return {
        handled: true,
        requestId: request.id,
        method,
        skipped: true,
        reason: 'already_connected'
      }
    }
    if (live.status === 'pending') {
      await supabaseAdmin.from('reconnect_requests').update({
        status: 'pending',
        selected_method: null,
        error_message: null
      }).eq('id', request.id).eq('status', 'processing')
      const message = `⏳ O WhatsApp ${number.display_name || number.phone} está restabelecendo a conexão automaticamente. Aguarde um minuto; nenhum QR Code ou código foi gerado para proteger a sessão atual.`
      const result = await sendFrom(receivingSender, request.recipient_phone, message)
      await insertEvent(number.id, 'interactive_reconnect_deferred_pending', {
        request_id: request.id,
        method,
        ...result
      })
      return {
        handled: true,
        requestId: request.id,
        method,
        skipped: true,
        reason: 'connection_pending'
      }
    }

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

export async function sendManualReconnectAuthentication(
  numberId: string,
  method: 'qr' | 'pairing'
) {
  const { data: number, error: numberError } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('id', numberId)
    .single()
  if (numberError || !number) throw new Error(numberError?.message || 'Número não encontrado')
  if (!['disconnected', 'error'].includes(number.status)) {
    throw new Error('A reconexão manual só pode ser acionada para números desconectados')
  }
  if (!number.integration_id || !number.workspace_id) {
    throw new Error('Este número não está vinculado a uma integração do workspace')
  }
  const recipientPhone = digits(number.phone)
  if (recipientPhone.length < 10 || String(number.phone).startsWith('pending:')) {
    throw new Error('O número ainda não possui um telefone válido para receber a reconexão')
  }

  const billingAccess = await workspaceBillingAccess(number.workspace_id)
  if (!billingAccess.communications_allowed) {
    throw new Error('Os disparos deste workspace estão suspensos por pendência financeira')
  }

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('id', number.integration_id)
    .single()
  if (integrationError || !integration) {
    throw new Error(integrationError?.message || 'Integração do número não encontrada')
  }

  const live = await verifyLiveStatusBeforeAuthentication(integration, number, 'manual')
  if (live.status === 'connected') {
    return {
      method,
      recipient_phone: recipientPhone,
      delivered: false,
      skipped: true,
      reason: 'already_connected',
      status: 'connected',
      message: `${number.display_name || number.phone} já está conectado. Nenhum QR Code ou código de pareamento foi gerado.`,
      number: live.number
    }
  }
  if (live.status === 'pending') {
    return {
      method,
      recipient_phone: recipientPhone,
      delivered: false,
      skipped: true,
      reason: 'connection_pending',
      status: 'pending',
      message: `${number.display_name || number.phone} está restabelecendo a conexão. Aguarde antes de gerar uma nova autenticação.`,
      number: live.number
    }
  }

  const sender = await chooseSender(number.workspace_id)
  const { data: lifecycle } = await supabaseAdmin.from('events')
    .select('event_type')
    .eq('whatsapp_number_id', number.id)
    .in('event_type', ['disconnect', 'reconnected'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (!lifecycle?.length || lifecycle[0].event_type === 'reconnected') {
    await insertEvent(number.id, 'disconnect', {
      provider: integration.provider,
      source: 'manual_reconnect',
      current_status: number.status
    })
  }
  await supabaseAdmin.from('whatsapp_numbers').update({
    last_alert_at: new Date().toISOString()
  }).eq('id', number.id)

  const client = providerClient(integration, number)
  const providerResult = method === 'qr'
    ? await requestProviderQr(client, number)
    : await requestProviderPairing(client, number)
  const authentication = await persistProviderAuthentication(number, providerResult, method)
  if (method === 'qr' && !authentication.qr_code) {
    throw new Error('A plataforma não retornou um QR Code válido')
  }
  if (method === 'pairing' && !authentication.pair_code) {
    throw new Error('A plataforma não retornou um código de pareamento válido')
  }

  const text = method === 'qr'
    ? `✅ QR Code gerado manualmente para ${number.display_name || number.phone}. Escaneie a imagem no WhatsApp para reconectar.`
    : `✅ Código de pareamento gerado manualmente para ${number.display_name || number.phone}: *${authentication.pair_code}*\n\nDigite este código no WhatsApp para reconectar.`
  const delivery = await sendFrom(
    sender,
    recipientPhone,
    text,
    method === 'qr' ? authentication.qr_code : null
  )
  await insertEvent(number.id, 'manual_reconnect_authentication_sent', {
    method,
    sender_number_id: sender.id,
    recipient_phone: recipientPhone,
    ...delivery
  })
  void watchManualReconnection(number, integration, method)
  return {
    method,
    recipient_phone: recipientPhone,
    sender_phone: sender.phone,
    delivered: true
  }
}

async function watchManualReconnection(
  originalNumber: any,
  integration: any,
  method: 'qr' | 'pairing'
) {
  if (manualReconnectWatchers.has(originalNumber.id)) return
  manualReconnectWatchers.add(originalNumber.id)
  try {
    const attempts = method === 'pairing' ? 60 : 30
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      const { data: previous } = await supabaseAdmin.from('whatsapp_numbers')
        .select('*')
        .eq('id', originalNumber.id)
        .single()
      if (!previous || previous.status === 'connected') return

      let providerStatus
      try {
        providerStatus = await getProviderStatus(providerClient(integration, previous))
      } catch (error: any) {
        await insertEvent(previous.id, 'manual_reconnect_status_check_failed', {
          attempt: attempt + 1,
          error: error.message
        })
        continue
      }
      if (providerStatus.status !== 'connected') continue

      const checkedAt = new Date().toISOString()
      const { data: connected, error } = await supabaseAdmin.from('whatsapp_numbers')
        .update({
          status: 'connected',
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          consecutive_failures: 0
        })
        .eq('id', previous.id)
        .neq('status', 'connected')
        .select('*')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (connected) await processSyncedTransition(previous, connected, integration)
      return
    }
    await insertEvent(originalNumber.id, 'manual_reconnect_watch_expired', {
      method,
      attempts
    })
  } catch (error: any) {
    await insertEvent(originalNumber.id, 'manual_reconnect_watch_failed', {
      method,
      error: error.message
    })
  } finally {
    manualReconnectWatchers.delete(originalNumber.id)
  }
}

export async function processSyncedTransition(previous: any, current: any, integration: any) {
  const { data: workspace } = await supabaseAdmin.from('workspaces').select('*')
    .eq('id', integration.workspace_id).single()
  if (!workspace?.monitoring_enabled || !current.monitoring_enabled) return
  const billingAccess = await workspaceBillingAccess(workspace.id)
  if (!billingAccess.communications_allowed) {
    await insertEvent(current.id, 'notification_suspended_billing', {
      billing_state: billingAccess.state,
      reason: billingAccess.reason
    })
    return
  }

  if (previous.status === 'connected' && ['disconnected', 'error'].includes(current.status)) {
    const cooldown = Number(process.env.ALERT_COOLDOWN_MS || 300_000)
    if (previous.last_alert_at && Date.now() - new Date(previous.last_alert_at).getTime() < cooldown) return
    await supabaseAdmin.from('whatsapp_numbers').update({ last_alert_at: new Date().toISOString() }).eq('id', current.id)
    await insertEvent(current.id, 'disconnect', {
      provider: integration.provider,
      previous_status: previous.status,
      current_status: current.status
    })
    let sender: any
    try {
      sender = await chooseSender(workspace.id)
    } catch (error: any) {
      await insertEvent(current.id, 'notification_failed', { type: 'sender_selection', error: error.message })
    }
    const technicalPhone = digits(workspace.notify_whatsapp)
    const clientPhone = digits(current.phone)
    const technicalMessage = `O número ${current.display_name || current.phone} foi desconectado.`
    if (sender && technicalPhone && technicalPhone !== clientPhone) {
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
        const emailResult = await sendEmail({
          recipient: { email: workspace.notify_email, workspaceId: workspace.id },
          category: 'status',
          templateKey: 'status_disconnected',
          variables: {
            numberName: current.display_name || current.phone,
            dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
          }
        })
        await insertEvent(current.id, 'technical_disconnect_email_sent', emailResult)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'technical_email_disconnect', error: error.message })
      }
    }
    if (sender) {
      try {
        await startInteractiveRequest(workspace, current, sender)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'interactive_disconnect', error: error.message })
      }
    }
  }

  if (previous.status !== 'connected' && current.status === 'connected') {
    const { data: claimed, error: claimError } = await supabaseAdmin.from('whatsapp_numbers')
      .update({ last_alert_at: null })
      .eq('id', current.id)
      .not('last_alert_at', 'is', null)
      .select('id')
    if (claimError) throw new Error(claimError.message)
    await cancelPendingRequests(current.id, 'reconnected')
    if (!claimed?.length) return

    const shouldNotify = await hasDeliveredOpenDisconnect(current.id)
    await insertEvent(current.id, 'reconnected', {
      provider: integration.provider,
      notification_sent: shouldNotify
    })
    if (!shouldNotify) {
      await insertEvent(current.id, 'reconnect_notification_suppressed', {
        reason: 'no_delivered_disconnect_notification'
      })
      return
    }
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
        const emailResult = await sendEmail({
          recipient: { email: workspace.notify_email, workspaceId: workspace.id },
          category: 'status',
          templateKey: 'status_reconnected',
          variables: {
            numberName: current.display_name || current.phone,
            dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
          }
        })
        await insertEvent(current.id, 'technical_reconnect_email_sent', emailResult)
      } catch (error: any) {
        await insertEvent(current.id, 'notification_failed', { type: 'technical_email_reconnect', error: error.message })
      }
    }
  }
}
