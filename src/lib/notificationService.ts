import { supabaseAdmin } from './supabaseClient.js'
import { insertEvent } from './whatsappService.js'
import { sendProviderNotification } from './providerAdapters.js'
import { workspaceBillingAccess } from './billingAccessService.js'
import { sendEmail } from './emailService.js'

type Notification = {
  to: string
  channel: 'email' | 'whatsapp'
  message: string
  qr_code?: string | null
  pair_code?: string | null
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
    const billingAccess = await workspaceBillingAccess(client.workspace_id)
    if (!billingAccess.communications_allowed) {
      await insertEvent(disconnectedNumber.id, 'notification_suspended_billing', {
        billing_state: billingAccess.state,
        reason: billingAccess.reason
      })
      return { delivered: false, suspended: true, error: 'Workspace suspended due to billing status' }
    }
    let providerResponse: unknown
    let senderNumber: string | null = null
    if (notification.channel === 'email') {
      providerResponse = await sendEmail({
        recipient: { email: notification.to, workspaceId: client.workspace_id },
        category: 'status',
        templateKey: 'status_disconnected',
        variables: {
          numberName: client.name,
          dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
        },
        attachments: notification.qr_code
          ? [{
              filename: 'qrcode.png',
              content: notification.qr_code.replace(/^data:image\/\w+;base64,/, '')
            }]
          : undefined
      })
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
