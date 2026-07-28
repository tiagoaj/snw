export const workspaceSchema = {
  id: 'uuid',
  name: 'text',
  slug: 'text'
}

export const clientSchema = {
  id: 'uuid',
  workspace_id: 'uuid',
  name: 'text',
  integration_platform: 'integration_platform',
  integration_config: 'jsonb',
  notify_email: 'text',
  notify_whatsapp: 'text',
  status: 'text'
}

export const whatsappNumberSchema = {
  id: 'uuid',
  client_id: 'uuid',
  phone: 'text',
  provider: 'integration_platform',
  status: 'number_status',
  last_seen_at: 'timestamptz',
  notify_to: 'text',
  notify_channel: 'notification_channel',
  pair_code: 'text',
  qr_code_url: 'text'
}
