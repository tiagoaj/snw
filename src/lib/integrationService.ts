import { supabaseAdmin } from './supabaseClient.js'
import { decryptSecret, encryptSecret, publicIntegrationConfig } from './secrets.js'
import { processSyncedTransition } from './syncedNotificationService.js'
import { insertEvent } from './whatsappService.js'

type NumberStatus = 'connected' | 'disconnected' | 'pending' | 'error'
type DiscoveredInstance = {
  external_id: string
  phone: string
  display_name: string
  status: NumberStatus
  raw_status?: string
  provider_token?: string | null
}

function status(value: unknown): NumberStatus {
  const current = String(value ?? '').toLowerCase()
  if (['connected', 'open', 'working', 'ready'].includes(current)) return 'connected'
  if (['connecting', 'pairing', 'starting', 'scan_qr_code', 'qrcode', 'hibernated'].includes(current)) return 'pending'
  if (['failed', 'error'].includes(current)) return 'error'
  if (['disconnected', 'close', 'closed', 'offline', 'logged_out'].includes(current)) return 'disconnected'
  // Ausência ou valor novo/desconhecido do provedor não comprova uma queda.
  return 'pending'
}

function phone(value: unknown) {
  return String(value ?? '').split('@')[0].replace(/\D/g, '')
}

async function getJson(integration: any, endpoint: string) {
  const key = decryptSecret(integration.credentials.apiKey)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (integration.provider === 'uazapi') headers.admintoken = key
  if (integration.provider === 'evolution') headers.apikey = key
  if (integration.provider === 'waha') headers['X-Api-Key'] = key
  const response = await fetch(`${integration.base_url.replace(/\/+$/, '')}${endpoint}`, { headers })
  const text = await response.text()
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`Provider returned invalid JSON (HTTP ${response.status})`) }
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}: ${text}`)
  return data
}

export async function discoverInstances(integration: any): Promise<DiscoveredInstance[]> {
  if (integration.provider === 'uazapi') {
    const response = await getJson(integration, '/instance/all')
    const rows = Array.isArray(response) ? response : response.instances ?? response.data ?? []
    return rows.map((row: any) => ({
      external_id: String(row.id ?? row.name ?? row.token),
      phone: phone(row.owner ?? row.phone ?? row.number),
      display_name: row.name ?? row.profileName ?? phone(row.owner),
      status: status(row.status),
      raw_status: String(row.status ?? ''),
      provider_token: row.token ? encryptSecret(String(row.token)) : null
    }))
  }
  if (integration.provider === 'evolution') {
    const response = await getJson(integration, '/instance/fetchInstances')
    const rows = Array.isArray(response) ? response : response.instances ?? []
    return rows.map((row: any) => ({
      external_id: String(row.name ?? row.instance?.instanceName ?? row.id),
      phone: phone(row.ownerJid ?? row.number ?? row.instance?.owner),
      display_name: row.profileName ?? row.name ?? row.instance?.instanceName,
      status: status(row.connectionStatus ?? row.state ?? row.instance?.status),
      raw_status: String(row.connectionStatus ?? row.state ?? row.instance?.status ?? '')
    }))
  }
  const response = await getJson(integration, '/api/sessions?all=true')
  return (Array.isArray(response) ? response : []).map((row: any) => ({
    external_id: String(row.name),
    phone: phone(row.me?.id),
    display_name: row.me?.pushName ?? row.name,
    status: status(row.status),
    raw_status: String(row.status ?? '')
  }))
}

export async function syncIntegration(integration: any) {
  try {
    const instances = await discoverInstances(integration)
    const { data: workspace } = await supabaseAdmin.from('workspaces').select('*')
      .eq('id', integration.workspace_id).single()
    for (const instance of instances) {
      const { data: previous } = await supabaseAdmin.from('whatsapp_numbers').select('*')
        .eq('integration_id', integration.id).eq('external_id', instance.external_id).maybeSingle()
      const checkedAt = new Date().toISOString()
      const confirmationThreshold = Math.max(1, Number(process.env.MONITOR_FAILURE_THRESHOLD || 2))
      const disconnectGraceMs = Math.max(0, Number(process.env.DISCONNECT_GRACE_MS || 120_000))
      let savedStatus = instance.status
      let consecutiveFailures = 0

      if (previous && instance.status === 'pending') {
        // Estados transitórios ou desconhecidos não derrubam um estado estável.
        savedStatus = previous.status
        consecutiveFailures = previous.consecutive_failures || 0
      } else if (previous?.status === 'connected' && ['disconnected', 'error'].includes(instance.status)) {
        consecutiveFailures = (previous.consecutive_failures || 0) + 1
        const lastSeenAt = previous.last_seen_at ? new Date(previous.last_seen_at).getTime() : 0
        const insideGraceWindow = lastSeenAt > 0 && Date.now() - lastSeenAt < disconnectGraceMs
        if (consecutiveFailures < confirmationThreshold || insideGraceWindow) savedStatus = 'connected'
      } else if (instance.status === 'connected') {
        consecutiveFailures = 0
      } else {
        consecutiveFailures = previous?.consecutive_failures || 0
      }

      const { data: saved, error } = await supabaseAdmin.from('whatsapp_numbers').upsert({
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        client_id: null,
        external_id: instance.external_id,
        phone: instance.phone || `pending:${instance.external_id}`,
        display_name: instance.display_name,
        provider: integration.provider,
        provider_token: instance.provider_token ?? null,
        status: savedStatus,
        last_seen_at: instance.status === 'connected' ? checkedAt : previous?.last_seen_at ?? null,
        monitoring_enabled: previous?.monitoring_enabled ?? workspace?.auto_monitor_new_numbers ?? true,
        last_checked_at: checkedAt,
        consecutive_failures: consecutiveFailures
      }, { onConflict: 'integration_id,external_id' }).select('*').single()
      if (error) throw error
      const previousCheck = previous?.last_checked_at ? new Date(previous.last_checked_at).getTime() : 0
      const previousSeen = previous?.last_seen_at ? new Date(previous.last_seen_at).getTime() : 0
      const firstTransientObservation =
        instance.status === 'pending' &&
        previous?.status === 'connected' &&
        previousCheck > 0 &&
        Math.abs(previousCheck - previousSeen) < 1_000
      const evaluatingDisconnect =
        ['disconnected', 'error'].includes(instance.status) &&
        previous?.status === 'connected'
      if (saved && (firstTransientObservation || evaluatingDisconnect || previous?.status !== saved.status)) {
        await insertEvent(saved.id, 'provider_status_observed', {
          provider: integration.provider,
          source: 'scheduled_sync',
          raw_status: instance.raw_status,
          normalized_status: instance.status,
          saved_status: savedStatus,
          consecutive_failures: consecutiveFailures,
          disconnect_grace_ms: disconnectGraceMs
        })
      }
      if (previous && saved && previous.status !== saved.status) {
        await processSyncedTransition(previous, saved, integration)
      }
    }
    await supabaseAdmin.from('integrations').update({
      status: 'active', last_sync_at: new Date().toISOString(), last_sync_error: null
    }).eq('id', integration.id)
    return instances
  } catch (error: any) {
    await supabaseAdmin.from('integrations').update({
      status: 'error', last_sync_at: new Date().toISOString(), last_sync_error: error.message
    }).eq('id', integration.id)
    throw error
  }
}

export function publicIntegration(integration: any) {
  return { ...integration, credentials: publicIntegrationConfig(integration.credentials) }
}
