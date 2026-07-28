import { supabaseAdmin } from './supabaseClient.js'
import { decryptSecret } from './secrets.js'

type ProviderPlatform = 'uazapi' | 'evolution' | 'waha'
type NumberStatus = 'connected' | 'disconnected' | 'pending' | 'error'
type ProviderAction = 'status' | 'reconnect' | 'qr' | 'pairing'

export type NormalizedProviderResult = {
  provider: ProviderPlatform
  status?: NumberStatus
  qrCode?: string | null
  pairingCode?: string | null
  raw: unknown
}

type IntegrationConfig = {
  baseUrl: string
  apiKey: string
  instanceName?: string
  sessionName?: string
  timeoutMs?: number
  endpoints?: Partial<Record<ProviderAction, string>>
}

function configFor(client: any): IntegrationConfig {
  const config = (client.integration_config ?? {}) as IntegrationConfig
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('Integration baseUrl and apiKey are required')
  }
  return { ...config, apiKey: decryptSecret(config.apiKey) }
}

function identifierFor(client: any, config: IntegrationConfig) {
  if (client.integration_platform === 'evolution') {
    if (!config.instanceName) throw new Error('Evolution integration requires instanceName')
    return config.instanceName
  }
  if (client.integration_platform === 'waha') {
    if (!config.sessionName) throw new Error('WAHA integration requires sessionName')
    return config.sessionName
  }
  return ''
}

function buildUrl(baseUrl: string, endpoint: string, values: Record<string, string>) {
  let resolved = endpoint
  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.split(`{{${key}}}`).join(encodeURIComponent(value))
  }
  return `${baseUrl.replace(/\/+$/, '')}/${resolved.replace(/^\/+/, '')}`
}

function deepValue(value: any, paths: string[]): any {
  for (const path of paths) {
    const result = path.split('.').reduce((current, key) => current?.[key], value)
    if (result !== undefined && result !== null) return result
  }
  return undefined
}

function normalizeStatus(value: unknown): NumberStatus {
  const status = String(value ?? '').toLowerCase()
  if (['connected', 'open', 'working', 'authenticated', 'ready'].includes(status)) return 'connected'
  if (['connecting', 'pairing', 'qrcode', 'qr_code', 'scan_qr_code', 'starting', 'pending'].includes(status)) return 'pending'
  if (['failed', 'error'].includes(status)) return 'error'
  return 'disconnected'
}

function normalize(provider: ProviderPlatform, raw: any): NormalizedProviderResult {
  const statusPaths: Record<ProviderPlatform, string[]> = {
    uazapi: ['instance.status', 'status'],
    evolution: ['instance.state', 'state', 'status'],
    waha: ['status']
  }
  const qrPaths = ['base64', 'qrcode.base64', 'qrcode', 'qrCode', 'qr', 'data.qr']
  const pairingPaths = ['pairingCode', 'pairing_code', 'paircode', 'instance.paircode', 'code']
  return {
    provider,
    status: normalizeStatus(deepValue(raw, statusPaths[provider])),
    qrCode: deepValue(raw, qrPaths) ?? null,
    pairingCode: deepValue(raw, pairingPaths) ?? null,
    raw
  }
}

async function callProvider(
  client: any,
  action: ProviderAction,
  options: { phone?: string } = {}
): Promise<NormalizedProviderResult> {
  const provider = client.integration_platform as ProviderPlatform
  const config = configFor(client)
  const identifier = identifierFor(client, config)
  const defaults: Record<ProviderPlatform, Record<ProviderAction, { method: string; endpoint: string }>> = {
    uazapi: {
      status: { method: 'GET', endpoint: '/instance/status' },
      reconnect: { method: 'POST', endpoint: '/instance/connect' },
      qr: { method: 'POST', endpoint: '/instance/connect' },
      pairing: { method: 'POST', endpoint: '/instance/connect' }
    },
    evolution: {
      status: { method: 'GET', endpoint: '/instance/connectionState/{{instance}}' },
      reconnect: { method: 'POST', endpoint: '/instance/restart/{{instance}}' },
      qr: { method: 'GET', endpoint: '/instance/connect/{{instance}}' },
      pairing: { method: 'GET', endpoint: '/instance/connect/{{instance}}?number={{phone}}' }
    },
    waha: {
      status: { method: 'GET', endpoint: '/api/sessions/{{session}}' },
      reconnect: { method: 'POST', endpoint: '/api/sessions/{{session}}/restart' },
      qr: { method: 'GET', endpoint: '/api/{{session}}/auth/qr' },
      pairing: { method: 'POST', endpoint: '/api/{{session}}/auth/request-code' }
    }
  }

  const definition = defaults[provider]?.[action]
  if (!definition) throw new Error(`Unsupported provider action: ${provider}.${action}`)
  const endpoint = config.endpoints?.[action] || definition.endpoint
  const url = buildUrl(config.baseUrl, endpoint, {
    instance: identifier,
    session: identifier,
    phone: options.phone ?? ''
  })
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider === 'uazapi') headers.token = config.apiKey
  if (provider === 'evolution') headers.apikey = config.apiKey
  if (provider === 'waha') headers['X-Api-Key'] = config.apiKey

  let body: string | undefined
  if (definition.method === 'POST') {
    headers['Content-Type'] = 'application/json'
    if (action === 'pairing') {
      body = JSON.stringify(provider === 'waha'
        ? { phoneNumber: options.phone }
        : { phone: options.phone })
    } else {
      body = JSON.stringify({})
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000)
  try {
    const response = await fetch(url, { method: definition.method, headers, body, signal: controller.signal })
    const contentType = response.headers.get('content-type') ?? ''
    const raw = contentType.includes('application/json')
      ? await response.json()
      : await response.text()
    if (!response.ok) {
      throw new Error(`${provider} returned HTTP ${response.status}: ${JSON.stringify(raw)}`)
    }
    return normalize(provider, raw)
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`${provider} request timed out`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export const getProviderStatus = (client: any) => callProvider(client, 'status')
export const requestProviderReconnect = (client: any, number: any) =>
  callProvider(client, 'reconnect', { phone: number.phone })
export const requestProviderQr = (client: any, number: any) =>
  callProvider(client, 'qr', { phone: number.phone })
export const requestProviderPairing = (client: any, number: any) =>
  callProvider(client, 'pairing', { phone: number.phone })

export async function sendProviderNotification(
  client: any,
  to: string,
  message: string,
  qrCode?: string | null
) {
  const provider = client.integration_platform as ProviderPlatform
  const config = configFor(client)
  const identifier = identifierFor(client, config)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  if (provider === 'uazapi') headers.token = config.apiKey
  if (provider === 'evolution') headers.apikey = config.apiKey
  if (provider === 'waha') headers['X-Api-Key'] = config.apiKey

  let endpoint: string
  let payload: Record<string, any>
  if (qrCode) {
    if (provider === 'uazapi') {
      endpoint = '/send/media'
      payload = { number: to, type: 'image', file: qrCode, text: message }
    } else if (provider === 'evolution') {
      endpoint = '/message/sendMedia/{{instance}}'
      payload = { number: to, mediatype: 'image', media: qrCode, caption: message, fileName: 'qrcode.png' }
    } else {
      endpoint = '/api/sendImage'
      payload = {
        session: identifier,
        chatId: `${to.replace(/\D/g, '')}@c.us`,
        file: {
          mimetype: 'image/png',
          filename: 'qrcode.png',
          data: qrCode.replace(/^data:image\/\w+;base64,/, '')
        },
        caption: message
      }
    }
  } else {
    if (provider === 'uazapi') {
      endpoint = '/send/text'
      payload = { number: to, text: message }
    } else if (provider === 'evolution') {
      endpoint = '/message/sendText/{{instance}}'
      payload = { number: to, text: message }
    } else {
      endpoint = '/api/sendText'
      payload = { session: identifier, chatId: `${to.replace(/\D/g, '')}@c.us`, text: message }
    }
  }

  const url = buildUrl(config.baseUrl, endpoint, { instance: identifier, session: identifier })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    const text = await response.text()
    let data: unknown = text
    try { data = JSON.parse(text) } catch { /* provider returned plain text */ }
    if (!response.ok) throw new Error(`${provider} send failed with HTTP ${response.status}: ${text}`)
    return { provider, data }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`${provider} notification timed out`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function refreshClientNumbers(clientId: string) {
  const { data, error } = await supabaseAdmin.from('whatsapp_numbers').select('*').eq('client_id', clientId)
  if (error) throw error
  return data
}
