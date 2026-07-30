import { supabaseAdmin } from './supabaseClient.js'
import {
  getProviderStatus,
  requestProviderPairing,
  requestProviderQr
} from './providerAdapters.js'
import {
  createDisconnectNotification,
  insertEvent,
  persistProviderAuthentication,
  shouldUsePairingCode,
  updateWhatsappNumber
} from './whatsappService.js'
import { syncIntegration } from './integrationService.js'

const intervalMs = Number(process.env.MONITOR_INTERVAL_MS || 60_000)
const failureThreshold = Number(process.env.MONITOR_FAILURE_THRESHOLD || 2)
const alertCooldownMs = Number(process.env.ALERT_COOLDOWN_MS || 300_000)
let running = false
let timer: NodeJS.Timeout | null = null

function alertIsDue(number: any) {
  if (!number.last_alert_at) return true
  return Date.now() - new Date(number.last_alert_at).getTime() >= alertCooldownMs
}

async function monitorNumber(number: any) {
  const checkedAt = new Date().toISOString()
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', number.client_id)
    .eq('status', 'active')
    .single()

  if (error || !client?.integration_config?.baseUrl || !client?.integration_config?.apiKey) {
    await updateWhatsappNumber(number.id, { last_checked_at: checkedAt })
    return
  }

  try {
    const providerResult = await getProviderStatus(client)
    if (providerResult.status === 'connected') {
      const wasDisconnected = ['disconnected', 'error'].includes(number.status)
      await updateWhatsappNumber(number.id, {
        status: 'connected',
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        last_alert_at: null,
        consecutive_failures: 0
      })
      if (wasDisconnected) await insertEvent(number.id, 'reconnected', { provider: providerResult.provider })
      return
    }

    if (providerResult.status === 'pending') {
      await updateWhatsappNumber(number.id, { last_checked_at: checkedAt })
      return
    }

    const failures = (number.consecutive_failures || 0) + 1
    await updateWhatsappNumber(number.id, {
      last_checked_at: checkedAt,
      consecutive_failures: failures
    })
    if (failures < failureThreshold || !alertIsDue(number)) return

    // Reserve the alert window before external requests to prevent duplicate
    // alerts from overlapping cycles in this process.
    await updateWhatsappNumber(number.id, {
      status: providerResult.status === 'error' ? 'error' : 'disconnected',
      last_alert_at: checkedAt
    })
    const usePairing = shouldUsePairingCode(number, client)
    const authResult = usePairing
      ? await requestProviderPairing(client, number)
      : await requestProviderQr(client, number)
    const authentication = await persistProviderAuthentication(
      number,
      authResult,
      usePairing ? 'pairing' : 'qr'
    )
    const result = await createDisconnectNotification(number, client, 'automatic_monitor', authentication)
    if (!result.delivery.delivered) {
      // A failed delivery becomes eligible for retry after the cooldown.
      await insertEvent(number.id, 'notification_retry_scheduled', {
        retry_after: new Date(Date.now() + alertCooldownMs).toISOString()
      })
    }
  } catch (monitorError: any) {
    const failures = (number.consecutive_failures || 0) + 1
    await updateWhatsappNumber(number.id, {
      last_checked_at: checkedAt,
      consecutive_failures: failures,
      status: failures >= failureThreshold ? 'error' : number.status
    })
    await insertEvent(number.id, 'monitor_check_failed', {
      error: monitorError.message,
      consecutive_failures: failures
    })
  }
}

export async function runMonitoringCycle() {
  if (running) return
  running = true
  try {
    const { data: integrations } = await supabaseAdmin
      .from('integrations')
      .select('*')
      .in('status', ['active', 'configured', 'error'])
    for (const integration of integrations ?? []) {
      if (integration.base_url && integration.credentials?.apiKey) {
        try {
          await syncIntegration(integration)
        } catch (error: any) {
          console.error(`Integration sync failed (${integration.id}):`, error.message)
        }
      }
    }

    const { data: numbers, error } = await supabaseAdmin
      .from('whatsapp_numbers')
      .select('*')
      .not('client_id', 'is', null)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
    if (error) throw error
    for (const number of numbers ?? []) {
      await monitorNumber(number)
    }
  } catch (error) {
    console.error('Monitoring cycle failed:', error)
  } finally {
    running = false
  }
}

export function startMonitoring() {
  if (timer || !Number.isFinite(intervalMs) || intervalMs < 10_000) return
  void runMonitoringCycle()
  timer = setInterval(() => void runMonitoringCycle(), intervalMs)
  timer.unref()
  console.log(`Monitor de conexões ativo a cada ${intervalMs}ms`)
}
