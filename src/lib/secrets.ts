import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const prefix = 'enc:v1:'

function encryptionKey() {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!encoded) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured')
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }
  return key
}

export function encryptSecret(value: string) {
  if (value.startsWith(prefix)) return value
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${prefix}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(value: string) {
  // Legacy plaintext credentials remain readable until the integration is
  // saved again, at which point they are encrypted.
  if (!value.startsWith(prefix)) return value
  const [ivEncoded, tagEncoded, dataEncoded] = value.slice(prefix.length).split(':')
  if (!ivEncoded || !tagEncoded || !dataEncoded) throw new Error('Encrypted credential is malformed')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64'))
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataEncoded, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

export function encryptIntegrationConfig(config: Record<string, any>) {
  return {
    ...config,
    apiKey: config.apiKey ? encryptSecret(String(config.apiKey)) : config.apiKey
  }
}

export function publicIntegrationConfig(config: Record<string, any> | null | undefined) {
  if (!config) return {}
  const { apiKey, ...safe } = config
  return { ...safe, apiKeyConfigured: Boolean(apiKey) }
}
