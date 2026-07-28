import { supabaseAdmin } from './supabaseClient.js'
import type { NormalizedProviderResult } from './providerAdapters.js'
import { deliverNotification } from './notificationService.js'

export async function insertEvent(whatsapp_number_id: string, event_type: string, payload: any) {
  const { data, error } = await supabaseAdmin
    .from('events')
    .insert([{ whatsapp_number_id, event_type, payload }])
    .select('*')
    .single()

  if (error) {
    console.error('Failed to insert event:', error.message)
    return null
  }
  return data
}

export async function updateWhatsappNumber(id: string, updates: Record<string, any>) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_numbers')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data
}

function notificationTarget(number: any, client: any) {
  return number.notify_to ||
    (number.notify_channel === 'email' ? client.notify_email : client.notify_whatsapp) ||
    number.phone
}

export function shouldUsePairingCode(number: any, client: any) {
  const target = notificationTarget(number, client)
  return number.notify_channel === 'whatsapp' && target === number.phone
}

export async function persistProviderAuthentication(
  number: any,
  providerResult: NormalizedProviderResult,
  requestedMethod: 'qr' | 'pairing'
) {
  const qrCode = providerResult.qrCode ?? null
  const pairingCode = providerResult.pairingCode ?? null

  if (requestedMethod === 'pairing' && !pairingCode) {
    throw new Error(`${providerResult.provider} did not return a pairing code`)
  }
  if (requestedMethod === 'qr' && !qrCode) {
    throw new Error(`${providerResult.provider} did not return a QR code`)
  }

  // Provider QR codes expire quickly. This is an application-side upper bound;
  // clients should always request a fresh code when reconnection fails.
  const qrExpiresAt = qrCode ? new Date(Date.now() + 60_000).toISOString() : null
  const updated = await updateWhatsappNumber(number.id, {
    pair_code: pairingCode,
    qr_code_url: qrCode,
    qr_expires_at: qrExpiresAt,
    status: providerResult.status === 'connected' ? 'connected' : 'pending'
  })

  await insertEvent(number.id, 'provider_authentication_received', {
    provider: providerResult.provider,
    method: requestedMethod,
    has_qr_code: Boolean(qrCode),
    has_pairing_code: Boolean(pairingCode),
    qr_expires_at: qrExpiresAt
  })

  return { updated, pair_code: pairingCode, qr_code: qrCode, qr_expires_at: qrExpiresAt }
}

export async function createDisconnectNotification(
  number: any,
  client: any,
  reason: string,
  authentication: Awaited<ReturnType<typeof persistProviderAuthentication>>
) {
  const notifyTo = notificationTarget(number, client)
  const usesPairingCode = Boolean(authentication.pair_code)
  const updated = await updateWhatsappNumber(number.id, {
    status: 'disconnected',
    last_seen_at: new Date().toISOString()
  })

  await insertEvent(number.id, 'disconnect', {
    reason,
    notify_to: notifyTo,
    notify_channel: number.notify_channel,
    target_phone: number.phone,
    authentication_method: usesPairingCode ? 'pairing' : 'qr'
  })

  const notification = {
    to: notifyTo,
    channel: number.notify_channel,
    message: usesPairingCode
      ? `O número ${number.phone} do cliente ${client.name} desconectou. Código de pareamento: ${authentication.pair_code}`
      : `O número ${number.phone} do cliente ${client.name} desconectou. Use o QR Code enviado para reconectar.`,
    qr_code: authentication.qr_code,
    pair_code: authentication.pair_code,
    expires_at: authentication.qr_expires_at
  }

  // Delivery is implemented in the next stage. This event deliberately says
  // queued instead of sent, so the audit log does not claim a false delivery.
  await insertEvent(number.id, 'notification_queued', notification)
  const delivery = await deliverNotification(number, client, notification)
  return { updated, notification, delivery }
}
