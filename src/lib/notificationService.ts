import { supabaseAdmin } from './supabaseClient.js'
import { insertEvent } from './whatsappService.js'
import { sendProviderNotification } from './providerAdapters.js'

type Notification = {
  to: string
  channel: 'email' | 'whatsapp'
  message: string
  qr_code?: string | null
  pair_code?: string | null
}

async function sendEmail(notification: Notification, client: any) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATION_EMAIL_FROM
  if (!apiKey || !from) {
    throw new Error('Email delivery requires RESEND_API_KEY and NOTIFICATION_EMAIL_FROM')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [notification.to],
      subject: `WhatsApp desconectado — ${client.name}`,
      html: `<h2>WhatsApp desconectado</h2><p>${notification.message}</p>${
        notification.qr_code
          ? `<p>O QR Code para reconexão está anexado a este e-mail.</p>`
          : ''
      }`,
      attachments: notification.qr_code
        ? [{
            filename: 'qrcode.png',
            content: notification.qr_code.replace(/^data:image\/\w+;base64,/, '')
          }]
        : undefined
    })
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Email delivery failed with HTTP ${response.status}: ${body}`)
  return JSON.parse(body)
}

async function findWhatsappSender(disconnectedNumberId: string, workspaceId: string) {
  const { data: candidates, error } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('status', 'connected')
    .neq('id', disconnectedNumberId)
    .order('last_seen_at', { ascending: false })
    .limit(10)

  if (error) throw error
  for (const number of candidates ?? []) {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', number.client_id)
      .eq('status', 'active')
      .single()
    if (
      client?.workspace_id === workspaceId &&
      client?.integration_config?.baseUrl &&
      client?.integration_config?.apiKey
    ) {
      return { number, client }
    }
  }
  throw new Error('No connected WhatsApp sender is available')
}

export async function deliverNotification(
  disconnectedNumber: any,
  client: any,
  notification: Notification
) {
  try {
    let providerResponse: unknown
    let senderNumber: string | null = null
    if (notification.channel === 'email') {
      providerResponse = await sendEmail(notification, client)
    } else {
      const sender = await findWhatsappSender(disconnectedNumber.id, client.workspace_id)
      senderNumber = sender.number.phone
      providerResponse = await sendProviderNotification(
        sender.client,
        notification.to,
        notification.message,
        notification.qr_code
      )
    }

    await insertEvent(disconnectedNumber.id, 'notification_sent', {
      channel: notification.channel,
      to: notification.to,
      sender_number: senderNumber,
      provider_response: providerResponse
    })
    return { delivered: true, sender_number: senderNumber, provider_response: providerResponse }
  } catch (error: any) {
    await insertEvent(disconnectedNumber.id, 'notification_failed', {
      channel: notification.channel,
      to: notification.to,
      error: error.message
    })
    return { delivered: false, error: error.message }
  }
}
