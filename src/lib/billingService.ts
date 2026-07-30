import { randomUUID } from 'crypto'
import { supabaseAdmin } from './supabaseClient.js'
import { subscriptionBillingAccess } from './billingAccessService.js'
import { sendWorkspaceBillingNotification } from './syncedNotificationService.js'

export type PlanId = 'start' | 'growth' | 'scale'

export type BillingPlan = {
  id: PlanId
  name: string
  integrationLimit: number
  amountCents: number
}

export const BILLING_PLANS: Record<PlanId, BillingPlan> = {
  start: { id: 'start', name: 'Start', integrationLimit: 1, amountCents: 5990 },
  growth: { id: 'growth', name: 'Growth', integrationLimit: 2, amountCents: 7990 },
  scale: { id: 'scale', name: 'Scale', integrationLimit: 3, amountCents: 9990 }
}

type CheckoutCustomer = {
  name: string
  email?: string | null
  cpfCnpj: string
  phone: string
  address: string
  addressNumber: string
  complement?: string | null
  postalCode: string
  province: string
  city: string
  state: string
  cityCode: string
}

type CheckoutResult = {
  id: string
  link: string
  status: string
  externalReference?: string
}

function asaasBaseUrl() {
  const environment = String(process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase()
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('ASAAS_ENVIRONMENT deve ser sandbox ou production')
  }
  return environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3'
}

function publicAppUrl() {
  const configured = process.env.APP_PUBLIC_URL || (process.env.APP_ORIGIN || '').split(',')[0]
  if (!configured) throw new Error('APP_PUBLIC_URL não está configurada')
  const parsed = new URL(configured)
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_PUBLIC_URL deve usar HTTPS em produção')
  }
  return configured.replace(/\/+$/, '')
}

function apiKey() {
  const value = process.env.ASAAS_API_KEY
  if (!value) throw new Error('ASAAS_API_KEY não está configurada')
  return value
}

function formatAsaasDateTime(date: Date) {
  return `${date.toISOString().slice(0, 10)} 12:00:00`
}

async function asaasRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: apiKey(),
      ...(init.headers || {})
    }
  })
  const bodyText = await response.text()
  let body: any = {}
  if (bodyText) {
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new Error(`O Asaas retornou uma resposta inválida (HTTP ${response.status})`)
    }
  }
  if (!response.ok) {
    const descriptions = Array.isArray(body.errors)
      ? body.errors.map((item: any) => item?.description).filter(Boolean).join(' ')
      : ''
    throw new Error(descriptions || `Falha na comunicação com o Asaas (HTTP ${response.status})`)
  }
  return body as T
}

export function planFromId(value: unknown): BillingPlan | null {
  const id = String(value || '') as PlanId
  return BILLING_PLANS[id] ?? null
}

export function planForIntegrationCount(count: number): BillingPlan {
  if (count >= 3) return BILLING_PLANS.scale
  if (count === 2) return BILLING_PLANS.growth
  return BILLING_PLANS.start
}

export function publicSubscription(subscription: any) {
  if (!subscription) return null
  const plan = planFromId(subscription.plan_id)
  return {
    id: subscription.id,
    workspace_id: subscription.workspace_id,
    provider: subscription.provider,
    plan_id: subscription.plan_id,
    plan_name: plan?.name ?? subscription.plan_id,
    integration_limit: subscription.integration_limit,
    amount_cents: subscription.amount_cents,
    status: subscription.status,
    trial_started_at: subscription.trial_started_at,
    trial_ends_at: subscription.trial_ends_at,
    checkout_expires_at: subscription.checkout_expires_at,
    billing_profile: subscription.metadata?.billing_profile ?? null,
    billing_access: subscriptionBillingAccess(subscription),
    last_payment_status: subscription.last_payment_status,
    next_due_date: subscription.next_due_date,
    updated_at: subscription.updated_at
  }
}

export async function ensureWorkspaceSubscription(input: {
  workspaceId: string
  plan: BillingPlan
  trialStartedAt?: string | null
  trialEndsAt?: string | null
}) {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('workspace_subscriptions')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()
  if (selectError) throw new Error(selectError.message)
  if (existing) {
    if (existing.status === 'trialing' &&
      existing.trial_ends_at &&
      new Date(existing.trial_ends_at).getTime() <= Date.now()) {
      const { data: expired, error: expireError } = await supabaseAdmin
        .from('workspace_subscriptions')
        .update({ status: 'expired' })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (expireError) throw new Error(expireError.message)
      return expired
    }
    return existing
  }

  const trialStart = input.trialStartedAt ? new Date(input.trialStartedAt) : new Date()
  const trialEndCandidate = input.trialEndsAt ? new Date(input.trialEndsAt) : null
  const trialEnd = trialEndCandidate && !Number.isNaN(trialEndCandidate.getTime())
    ? trialEndCandidate
    : new Date(trialStart.getTime() + 7 * 86_400_000)

  const { data, error } = await supabaseAdmin.from('workspace_subscriptions').insert({
    workspace_id: input.workspaceId,
    plan_id: input.plan.id,
    integration_limit: input.plan.integrationLimit,
    amount_cents: input.plan.amountCents,
    status: trialEnd.getTime() > Date.now() ? 'trialing' : 'expired',
    trial_started_at: trialStart.toISOString(),
    trial_ends_at: trialEnd.toISOString()
  }).select('*').single()

  if (error) {
    // Outra requisição pode ter criado a linha entre o SELECT e o INSERT.
    if (error.code === '23505') {
      const { data: concurrent, error: concurrentError } = await supabaseAdmin
        .from('workspace_subscriptions').select('*').eq('workspace_id', input.workspaceId).single()
      if (concurrentError) throw new Error(concurrentError.message)
      return concurrent
    }
    throw new Error(error.message)
  }
  return data
}

export async function createAsaasCheckout(input: {
  workspaceId: string
  plan: BillingPlan
  customer: CheckoutCustomer
  trialEndsAt?: string | null
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('workspace_subscriptions').select('*').eq('workspace_id', input.workspaceId).maybeSingle()
  if (existingError) throw new Error(existingError.message)

  if (existing?.status === 'active') {
    throw new Error('Este workspace já possui uma assinatura ativa. Alterações de plano serão liberadas em uma próxima etapa.')
  }

  const activeCheckout = existing?.status === 'checkout_pending' &&
    existing?.asaas_checkout_url &&
    existing?.checkout_expires_at &&
    new Date(existing.checkout_expires_at).getTime() > Date.now()
  if (activeCheckout && existing.plan_id === input.plan.id) {
    return { checkoutUrl: existing.asaas_checkout_url as string, reused: true }
  }
  if (activeCheckout) {
    throw new Error('Já existe um checkout válido para outro plano. Conclua esse checkout ou aguarde até 24 horas para gerar um novo.')
  }

  const now = new Date()
  const requestedTrialEnd = input.trialEndsAt ? new Date(input.trialEndsAt) : null
  const firstChargeAt = requestedTrialEnd && !Number.isNaN(requestedTrialEnd.getTime()) && requestedTrialEnd > now
    ? requestedTrialEnd
    : now
  const checkoutExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const externalReference = `snw:${input.workspaceId}:${input.plan.id}:${randomUUID()}`
  const appUrl = publicAppUrl()

  const baseRecord = {
    workspace_id: input.workspaceId,
    plan_id: input.plan.id,
    integration_limit: input.plan.integrationLimit,
    amount_cents: input.plan.amountCents,
    status: 'checkout_pending',
    checkout_expires_at: checkoutExpiresAt.toISOString(),
    last_error: null,
    metadata: {
      ...(existing?.metadata || {}),
      external_reference: externalReference,
      billing_profile: {
        name: input.customer.name,
        cpfCnpj: input.customer.cpfCnpj,
        phone: input.customer.phone,
        address: input.customer.address,
        addressNumber: input.customer.addressNumber,
        complement: input.customer.complement || '',
        postalCode: input.customer.postalCode,
        province: input.customer.province,
        city: input.customer.city,
        state: input.customer.state,
        cityCode: input.customer.cityCode
      }
    }
  }
  const { error: prepareError } = await supabaseAdmin
    .from('workspace_subscriptions')
    .upsert(baseRecord, { onConflict: 'workspace_id' })
  if (prepareError) throw new Error(prepareError.message)

  const customerData = {
    name: input.customer.name,
    ...(input.customer.email ? { email: input.customer.email } : {}),
    cpfCnpj: input.customer.cpfCnpj,
    phone: input.customer.phone,
    address: input.customer.address,
    addressNumber: input.customer.addressNumber,
    ...(input.customer.complement ? { complement: input.customer.complement } : {}),
    postalCode: input.customer.postalCode,
    province: input.customer.province,
    city: Number(input.customer.cityCode)
  }

  try {
    const checkout = await asaasRequest<CheckoutResult>('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 1440,
        externalReference,
        callback: {
          successUrl: `${appUrl}/?billing=success`,
          cancelUrl: `${appUrl}/?billing=cancel`,
          expiredUrl: `${appUrl}/?billing=expired`
        },
        items: [{
          externalReference: input.plan.id,
          name: `SNW ${input.plan.name}`,
          description: `${input.plan.integrationLimit} integração(ões) e instâncias ilimitadas`,
          quantity: 1,
          value: input.plan.amountCents / 100
        }],
        customerData,
        subscription: {
          cycle: 'MONTHLY',
          nextDueDate: formatAsaasDateTime(firstChargeAt)
        }
      })
    })

    if (!checkout.id || !checkout.link) {
      throw new Error('O Asaas não retornou o link do checkout')
    }

    const { error: updateError } = await supabaseAdmin.from('workspace_subscriptions').update({
      asaas_checkout_id: checkout.id,
      asaas_checkout_url: checkout.link,
      checkout_expires_at: checkoutExpiresAt.toISOString(),
      last_error: null
    }).eq('workspace_id', input.workspaceId)
    if (updateError) throw new Error(updateError.message)

    return { checkoutUrl: checkout.link, reused: false }
  } catch (error: any) {
    await supabaseAdmin.from('workspace_subscriptions').update({
      status: existing?.status || 'trialing',
      last_error: String(error.message || error)
    }).eq('workspace_id', input.workspaceId)
    throw error
  }
}

function workspaceIdFromExternalReference(reference: unknown) {
  const match = /^snw:([0-9a-f-]{36}):(start|growth|scale):/i.exec(String(reference || ''))
  return match?.[1] ?? null
}

export async function getWorkspacePaymentHistory(workspaceId: string) {
  const { data: local, error: subscriptionError } = await supabaseAdmin
    .from('workspace_subscriptions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (!local) return []

  const { data: events, error: eventsError } = await supabaseAdmin
    .from('billing_webhook_events')
    .select('event_id, event_type, payload, created_at')
    .eq('provider', 'asaas')
    .order('created_at', { ascending: false })
    .limit(500)
  if (eventsError) throw new Error(eventsError.message)

  const payments = new Map<string, any>()
  for (const row of events ?? []) {
    const payload = row.payload || {}
    const payment = payload.payment || {}
    const checkout = payload.checkout || {}
    const subscription = payload.subscription || {}
    const reference = checkout.externalReference ??
      subscription.externalReference ??
      payment.externalReference
    const belongsToWorkspace =
      workspaceIdFromExternalReference(reference) === workspaceId ||
      (local.asaas_checkout_id && String(checkout.id || '') === String(local.asaas_checkout_id)) ||
      (local.asaas_subscription_id && String(subscription.id || payment.subscription || '') === String(local.asaas_subscription_id)) ||
      (local.asaas_customer_id && String(checkout.customer || subscription.customer || payment.customer || '') === String(local.asaas_customer_id))
    if (!belongsToWorkspace) continue

    const eventType = String(row.event_type || '')
    const paymentId = String(payment.id || '')
    if (!paymentId && eventType !== 'CHECKOUT_PAID') continue
    const key = paymentId || `checkout:${checkout.id || row.event_id}`
    if (payments.has(key)) continue

    const invoiceUrl = String(payment.invoiceUrl || payment.transactionReceiptUrl || '')
    payments.set(key, {
      id: key,
      asaas_payment_id: paymentId || null,
      event_type: eventType,
      status: String(payment.status || (eventType === 'CHECKOUT_PAID' ? 'RECEIVED' : eventType.replace(/^PAYMENT_/, ''))),
      description: String(payment.description || `SNW ${planFromId(local.plan_id)?.name || local.plan_id}`),
      value: Number(payment.value ?? local.amount_cents / 100),
      billing_type: String(payment.billingType || 'CREDIT_CARD'),
      due_date: payment.dueDate ? String(payment.dueDate).slice(0, 10) : null,
      payment_date: payment.paymentDate
        ? String(payment.paymentDate).slice(0, 10)
        : payment.confirmedDate
          ? String(payment.confirmedDate).slice(0, 10)
          : null,
      created_at: row.created_at,
      invoice_url: invoiceUrl.startsWith('https://') ? invoiceUrl : null
    })
  }
  return Array.from(payments.values())
}

async function findLocalSubscription(payload: any) {
  const checkout = payload?.checkout
  const subscription = payload?.subscription
  const payment = payload?.payment

  if (checkout?.id) {
    const { data } = await supabaseAdmin.from('workspace_subscriptions').select('*')
      .eq('asaas_checkout_id', String(checkout.id)).maybeSingle()
    if (data) return data
    // Não associe um checkout antigo ao registro atual apenas pelo workspace.
    return null
  }
  if (subscription?.id || payment?.subscription) {
    const asaasSubscriptionId = String(subscription?.id || payment?.subscription)
    const { data } = await supabaseAdmin.from('workspace_subscriptions').select('*')
      .eq('asaas_subscription_id', asaasSubscriptionId).maybeSingle()
    if (data) return data
  }

  const externalReference = checkout?.externalReference ??
    subscription?.externalReference ??
    payment?.externalReference
  const workspaceId = workspaceIdFromExternalReference(externalReference)
  if (workspaceId) {
    const { data } = await supabaseAdmin.from('workspace_subscriptions').select('*')
      .eq('workspace_id', workspaceId).maybeSingle()
    if (data) return data
  }

  const customerId = checkout?.customer ?? subscription?.customer ?? payment?.customer
  if (customerId) {
    const { data } = await supabaseAdmin.from('workspace_subscriptions').select('*')
      .eq('asaas_customer_id', String(customerId)).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (data) return data
  }
  return null
}

export async function processAsaasWebhook(payload: any) {
  const eventId = String(payload?.id || '')
  const eventType = String(payload?.event || '')
  if (!eventId || !eventType) throw new Error('Evento do Asaas sem id ou event')

  const { data: eventRow, error: insertError } = await supabaseAdmin
    .from('billing_webhook_events')
    .insert({ provider: 'asaas', event_id: eventId, event_type: eventType, payload })
    .select('id')
    .single()
  if (insertError?.code === '23505') return { duplicate: true }
  if (insertError || !eventRow) throw new Error(insertError?.message || 'Não foi possível registrar o webhook')

  try {
    const local = await findLocalSubscription(payload)
    if (!local) {
      await supabaseAdmin.from('billing_webhook_events')
        .update({ processed_at: new Date().toISOString(), error_message: 'Assinatura local não localizada' })
        .eq('id', eventRow.id)
      return { ignored: true }
    }

    const checkout = payload.checkout ?? {}
    const subscription = payload.subscription ?? {}
    const payment = payload.payment ?? {}
    const metadata: Record<string, any> = {
      ...(local.metadata || {}),
      last_event_id: eventId,
      last_event_type: eventType
    }
    let notifyDelinquency = false
    let notifyRecovery = false
    const updates: Record<string, unknown> = {
      last_error: null,
      metadata
    }

    if (checkout.customer) updates.asaas_customer_id = String(checkout.customer)
    if (subscription.customer) updates.asaas_customer_id = String(subscription.customer)
    if (payment.customer) updates.asaas_customer_id = String(payment.customer)
    if (subscription.id) updates.asaas_subscription_id = String(subscription.id)
    if (payment.subscription) updates.asaas_subscription_id = String(payment.subscription)
    if (payment.id) updates.asaas_last_payment_id = String(payment.id)
    if (payment.status) updates.last_payment_status = String(payment.status)
    if (subscription.nextDueDate) updates.next_due_date = String(subscription.nextDueDate).slice(0, 10)

    if (eventType === 'CHECKOUT_PAID' ||
      eventType === 'PAYMENT_CONFIRMED' ||
      eventType === 'PAYMENT_RECEIVED') {
      updates.status = 'active'
      notifyRecovery = Boolean(local.metadata?.delinquency)
      metadata.delinquency = null
    } else if (eventType === 'CHECKOUT_CREATED') {
      updates.status = local.status === 'active' ? 'active' : 'checkout_pending'
    } else if (eventType === 'CHECKOUT_CANCELED' || eventType === 'CHECKOUT_EXPIRED') {
      if (local.status !== 'active') updates.status = eventType === 'CHECKOUT_CANCELED' ? 'canceled' : 'expired'
    } else if (eventType === 'SUBSCRIPTION_CREATED' || eventType === 'SUBSCRIPTION_UPDATED') {
      if (String(subscription.status).toUpperCase() === 'ACTIVE' && local.status !== 'past_due') {
        updates.status = 'active'
      }
    } else if (eventType === 'SUBSCRIPTION_INACTIVATED' || eventType === 'SUBSCRIPTION_DELETED') {
      updates.status = 'canceled'
    } else if (eventType === 'PAYMENT_OVERDUE' ||
      eventType === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' ||
      eventType === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS') {
      updates.status = 'past_due'
      const existingDelinquency = local.status === 'past_due' ? local.metadata?.delinquency : null
      const startedAt = existingDelinquency?.started_at || new Date().toISOString()
      const graceEndsAt = existingDelinquency?.grace_ends_at ||
        new Date(new Date(startedAt).getTime() + 3 * 86_400_000).toISOString()
      metadata.delinquency = {
        ...(existingDelinquency || {}),
        started_at: startedAt,
        grace_ends_at: graceEndsAt,
        reason_event: eventType,
        payment_id: payment.id ? String(payment.id) : null
      }
      notifyDelinquency = !existingDelinquency?.notified_at
    }

    const { error: updateError } = await supabaseAdmin.from('workspace_subscriptions')
      .update(updates).eq('id', local.id)
    if (updateError) throw new Error(updateError.message)

    if (notifyDelinquency) {
      const graceEndsAt = metadata.delinquency.grace_ends_at
      const paymentUrl = String(payment.invoiceUrl || '')
      const message = [
        '⚠️ Não foi possível confirmar o pagamento da assinatura SNW.',
        `O acesso continuará disponível até ${new Date(graceEndsAt).toLocaleDateString('pt-BR')}.`,
        'Regularize o pagamento dentro desse prazo para evitar a suspensão do painel operacional e dos alertas por WhatsApp e e-mail.',
        paymentUrl.startsWith('https://') ? `Pagamento: ${paymentUrl}` : 'Acesse Assinatura > Pagamentos no painel para verificar a cobrança.'
      ].join('\n\n')
      try {
        const deliveries = await sendWorkspaceBillingNotification(
          local.workspace_id,
          'Pendência no pagamento da assinatura SNW',
          message
        )
        const delivered = deliveries.some((delivery) => delivery.delivered)
        const delinquency = {
          ...metadata.delinquency,
          notification_attempted_at: new Date().toISOString(),
          notified_at: delivered ? new Date().toISOString() : null,
          notification_deliveries: deliveries
        }
        await supabaseAdmin.from('workspace_subscriptions').update({
          metadata: { ...metadata, delinquency }
        }).eq('id', local.id)
      } catch (notificationError: any) {
        console.error(`Billing notification failed (${local.workspace_id}):`, notificationError.message)
      }
    }

    if (notifyRecovery) {
      try {
        await sendWorkspaceBillingNotification(
          local.workspace_id,
          'Pagamento confirmado — assinatura SNW reativada',
          '✅ Pagamento confirmado pelo Asaas. A assinatura SNW está ativa novamente e o painel operacional e os alertas foram restabelecidos automaticamente.'
        )
      } catch (notificationError: any) {
        console.error(`Billing recovery notification failed (${local.workspace_id}):`, notificationError.message)
      }
    }

    await supabaseAdmin.from('billing_webhook_events')
      .update({ processed_at: new Date().toISOString(), error_message: null })
      .eq('id', eventRow.id)
    return { processed: true }
  } catch (error: any) {
    await supabaseAdmin.from('billing_webhook_events')
      .update({ error_message: String(error.message || error) })
      .eq('id', eventRow.id)
    throw error
  }
}
