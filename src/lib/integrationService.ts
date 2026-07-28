import { supabaseAdmin } from './supabaseClient.js'
import { decryptSecret, encryptSecret, publicIntegrationConfig } from './secrets.js'
import { processSyncedTransition } from './syncedNotificationService.js'

type NumberStatus = 'connected' | 'disconnected' | 'pending' | 'error'
type DiscoveredInstance = {
  external_id: string
  phone: string
  display_name: string
  status: NumberStatus
  provider_token?: string | null
}

function status(value: unknown): NumberStatus {
  const current = String(value ?? '').toLowerCase()
  if (['connected', 'open', 'working', 'ready'].includes(current)) return 'connected'
  if (['connecting', 'pairing', 'starting', 'scan_qr_code', 'qrcode'].includes(current)) return 'pending'
  if (['failed', 'error'].includes(current)) return 'error'
  return 'disconnected'
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
      status: status(row.connectionStatus ?? row.state ?? row.instance?.status)
    }))
  }
  const response = await getJson(integration, '/api/sessions?all=true')
  return (Array.isArray(response) ? response : []).map((row: any) => ({
    external_id: String(row.name),
    phone: phone(row.me?.id),
    display_name: row.me?.pushName ?? row.name,
    status: status(row.status)
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
      const { data: saved, error } = await supabaseAdmin.from('whatsapp_numbers').upsert({
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        client_id: null,
        external_id: instance.external_id,
        phone: instance.phone || `pending:${instance.external_id}`,
        display_name: instance.display_name,
        provider: integration.provider,
        provider_token: instance.provider_token ?? null,
        status: instance.status,
        last_seen_at: instance.status === 'connected' ? new Date().toISOString() : null,
        monitoring_enabled: previous?.monitoring_enabled ?? workspace?.auto_monitor_new_numbers ?? true,
        last_checked_at: new Date().toISOString()
      }, { onConflict: 'integration_id,external_id' }).select('*').single()
      if (error) throw error
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
