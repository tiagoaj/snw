import { Router } from 'express'
import { supabaseAdmin } from './supabaseClient.js'
import {
  requireAuth,
  requireRole,
  requireWebhookSecret,
  AuthRequest,
  ensureWorkspaceAccess,
  ensureWorkspaceOperationalAccess
} from './auth.js'
import {
  createDisconnectNotification,
  insertEvent,
  persistProviderAuthentication,
  shouldUsePairingCode
} from './whatsappService.js'
import { getProviderStatus, requestProviderPairing, requestProviderReconnect, requestProviderQr } from './providerAdapters.js'
import { encryptIntegrationConfig, encryptSecret, publicIntegrationConfig } from './secrets.js'
import { writeAuditLog } from './auditService.js'
import { publicIntegration, syncIntegration } from './integrationService.js'
import {
  normalizeIncomingProviderMessage,
  processIncomingProviderMessage,
  processSyncedTransition,
  sendManualReconnectAuthentication
} from './syncedNotificationService.js'
import { ensureWorkspaceSubscription, planForIntegrationCount } from './billingService.js'
import { workspaceBillingAccess } from './billingAccessService.js'
import { sendEmail } from './emailService.js'

const router = Router()

function publicClient(client: any) {
  return { ...client, integration_config: publicIntegrationConfig(client.integration_config) }
}

type ProviderConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error'

function normalizedWebhookEvent(body: any) {
  return String(
    body.EventType ??
    body.eventType ??
    body.event_type ??
    body.event ??
    body.type ??
    body.payload?.EventType ??
    body.payload?.event ??
    body.data?.EventType ??
    body.data?.event ??
    ''
  ).trim().toLowerCase()
}

function normalizeWebhookConnectionStatus(value: unknown): ProviderConnectionStatus | null {
  const current = String(value ?? '').trim().toLowerCase()
  if (['connected', 'open', 'working', 'authenticated', 'ready'].includes(current)) return 'connected'
  if (['connecting', 'pairing', 'starting', 'scan_qr_code', 'qrcode', 'qr_code', 'pending', 'hibernated'].includes(current)) {
    return 'pending'
  }
  if (['disconnected', 'close', 'closed', 'offline', 'logged_out'].includes(current)) {
    return 'disconnected'
  }
  if (['failed', 'error'].includes(current)) return 'error'
  return null
}

function connectionWebhookPayload(provider: string, body: any) {
  const event = normalizedWebhookEvent(body)
  const normalizedProvider = String(provider ?? '').toLowerCase()
  const connectionEvents: Record<string, string[]> = {
    uazapi: ['connection', 'connection.update', 'connection_update'],
    evolution: ['connection', 'connection.update', 'connection_update'],
    waha: ['session.status', 'session_status', 'connection', 'connection.update', 'connection_update']
  }
  const allowedEvents = connectionEvents[normalizedProvider] ?? ['connection', 'connection.update', 'connection_update']

  // Providers send many webhook types to the same URL. A message delivery can,
  // for example, contain status=Failed; it must never change the session state.
  if (event && !allowedEvents.includes(event)) {
    return { ignored: true as const, reason: 'not_a_connection_event', event }
  }

  let rawStatus: unknown
  let externalId: unknown

  if (normalizedProvider === 'uazapi') {
    rawStatus =
      body.instance?.status ??
      body.data?.instance?.status ??
      body.payload?.instance?.status
    externalId =
      body.instance?.id ??
      body.data?.instance?.id ??
      body.payload?.instance?.id ??
      body.instanceName ??
      body.data?.instanceName ??
      body.payload?.instanceName
  } else if (normalizedProvider === 'evolution') {
    rawStatus =
      body.data?.state ??
      body.instance?.state ??
      body.payload?.state ??
      body.data?.status ??
      body.instance?.status
    externalId =
      (typeof body.instance === 'string' ? body.instance : body.instance?.name ?? body.instance?.id) ??
      body.instanceName ??
      body.data?.instance ??
      body.data?.instanceName
  } else {
    rawStatus =
      body.payload?.status ??
      body.session?.status ??
      body.data?.status
    externalId =
      (typeof body.session === 'string' ? body.session : body.session?.name ?? body.session?.id) ??
      body.payload?.session ??
      body.data?.session
  }

  // Some provider versions put connection status at the envelope root. Only
  // accept that ambiguous field when the event explicitly says "connection".
  if (event && allowedEvents.includes(event)) {
    rawStatus ??= body.status
    externalId ??=
      (typeof body.instance === 'string' ? body.instance : body.instance?.name ?? body.instance?.id) ??
      (typeof body.session === 'string' ? body.session : body.session?.name ?? body.session?.id)
  }

  const status = normalizeWebhookConnectionStatus(rawStatus)
  if (!event && (!status || !externalId)) {
    return { ignored: true as const, reason: 'ambiguous_webhook_without_connection_event', event }
  }
  if (!status) {
    return {
      ignored: true as const,
      reason: 'unknown_connection_status',
      event,
      rawStatus: String(rawStatus ?? '')
    }
  }
  if (!externalId) {
    return { ignored: true as const, reason: 'missing_instance_identifier', event }
  }
  return {
    ignored: false as const,
    event,
    externalId: String(externalId),
    rawStatus: String(rawStatus),
    status
  }
}

router.get('/workspaces/me', requireAuth, async (req: AuthRequest, res) => {
  if (req.currentUserRow?.role === 'superadmin') {
    const { data, error } = await supabaseAdmin.from('workspaces').select('*').order('name')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ workspaces: data })
  }
  const profiles = req.currentUserProfiles ?? []
  const workspaceIds = [...new Set(profiles.map((profile) => profile.workspace_id))]

  if (workspaceIds.length === 0) {
    return res.json({ workspaces: [] })
  }

  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .select('*')
    .in('id', workspaceIds)

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ workspaces: data })
})

router.post('/workspaces', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const { name, slug } = req.body

  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' })
  }

  const { data: workspace, error } = await supabaseAdmin
    .from('workspaces')
    .insert([{ name, slug }])
    .select('*')
    .single()

  if (error || !workspace) {
    return res.status(500).json({ error: error?.message || 'Failed to create workspace' })
  }

  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .insert([
      {
        user_id: req.currentUser?.id,
        workspace_id: workspace.id,
        role: 'workspace_admin'
      }
    ])

  if (profileError) {
    return res.status(500).json({ error: profileError.message })
  }

  res.status(201).json({ workspace })
})

router.get('/clients', requireAuth, async (req: AuthRequest, res) => {
  const workspace_id = req.query.workspace_id as string

  if (!workspace_id) {
    return res.status(400).json({ error: 'workspace_id is required' })
  }

  const allowed = await ensureWorkspaceAccess(req, workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('workspace_id', workspace_id)

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ clients: (data ?? []).map(publicClient) })
})

router.post('/admin/customers', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const { company_name, slug, full_name, email, password, providers = [] } = req.body
  if (!company_name || !slug || !full_name || !email || !password) {
    return res.status(400).json({ error: 'company_name, slug, full_name, email and password are required' })
  }
  const allowedProviders = ['uazapi', 'evolution', 'waha']
  if (!Array.isArray(providers) || providers.some((provider) => !allowedProviders.includes(provider))) {
    return res.status(400).json({ error: 'providers contains an invalid provider' })
  }

  const billingPlan = planForIntegrationCount(providers.length)
  const trialStartedAt = new Date()
  const trialEndsAt = new Date(trialStartedAt.getTime() + 7 * 86_400_000)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      selected_plan: billingPlan.id,
      subscription_status: 'trialing',
      trial_started_at: trialStartedAt.toISOString(),
      trial_ends_at: trialEndsAt.toISOString()
    }
  })
  if (authError || !authData.user) return res.status(400).json({ error: authError?.message })

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces').insert([{ name: company_name, slug }]).select('*').single()
  if (workspaceError || !workspace) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return res.status(400).json({ error: workspaceError?.message })
  }

  const { error: userError } = await supabaseAdmin.from('users').insert([{
    id: authData.user.id, email, full_name, role: 'client_user', status: 'active'
  }])
  const { error: profileError } = await supabaseAdmin.from('user_profiles').insert([{
    user_id: authData.user.id, workspace_id: workspace.id, role: 'workspace_admin'
  }])
  if (userError || profileError) {
    return res.status(500).json({ error: userError?.message || profileError?.message })
  }
  if (providers.length) {
    const { error } = await supabaseAdmin.from('integrations').insert(
      providers.map((provider: string) => ({
        workspace_id: workspace.id, provider, name: provider.toUpperCase()
      }))
    )
    if (error) return res.status(500).json({ error: error.message })
  }
  try {
    await ensureWorkspaceSubscription({
      workspaceId: workspace.id,
      plan: billingPlan,
      trialStartedAt: trialStartedAt.toISOString(),
      trialEndsAt: trialEndsAt.toISOString()
    })
  } catch (billingError: any) {
    return res.status(500).json({ error: `Não foi possível iniciar o teste grátis: ${billingError.message}` })
  }
  await writeAuditLog({
    userId: req.currentUser!.id,
    workspaceId: workspace.id,
    action: 'customer.provisioned',
    entityType: 'workspace',
    entityId: workspace.id,
    metadata: { email, providers }
  })
  try {
    await sendEmail({
      recipient: {
        email,
        name: full_name,
        userId: authData.user.id,
        workspaceId: workspace.id
      },
      category: 'platform',
      templateKey: 'welcome',
      idempotencyKey: `welcome:${authData.user.id}`,
      variables: {
        trialEndsAt: trialEndsAt.toLocaleString('pt-BR'),
        dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
      }
    })
  } catch (emailError: any) {
    console.error('Provisioned customer welcome email failed:', emailError.message)
  }
  res.status(201).json({ workspace, user: { id: authData.user.id, email, full_name }, providers })
})

router.get('/integrations', requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = String(req.query.workspace_id || '')
  if (!workspaceId || !(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  const { data, error } = await supabaseAdmin.from('integrations').select('*')
    .eq('workspace_id', workspaceId).order('created_at')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ integrations: (data ?? []).map(publicIntegration) })
})

router.patch('/integrations/:integration_id/configure', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const integrationId = String(req.params.integration_id)
  const { base_url, api_key } = req.body
  if (!base_url || !api_key) return res.status(400).json({ error: 'base_url and api_key are required' })
  try {
    const parsed = new URL(base_url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    return res.status(400).json({ error: 'base_url is invalid' })
  }
  const { data: integration } = await supabaseAdmin.from('integrations').select('*').eq('id', integrationId).single()
  if (!integration) return res.status(404).json({ error: 'Integration not found' })
  if (!(await ensureWorkspaceAccess(req, integration.workspace_id))) {
    return res.status(403).json({ error: 'No access to this integration' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, integration.workspace_id))) return
  const { data, error } = await supabaseAdmin.from('integrations').update({
    base_url: base_url.replace(/\/+$/, ''),
    credentials: { apiKey: encryptSecret(api_key) },
    status: 'configured',
    last_sync_error: null
  }).eq('id', integrationId).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  try {
    const instances = await syncIntegration(data)
    res.json({ integration: publicIntegration({ ...data, status: 'active' }), instances })
  } catch (syncError: any) {
    res.status(502).json({ error: syncError.message, integration: publicIntegration(data) })
  }
})

router.post('/integrations/:integration_id/sync', requireAuth, async (req: AuthRequest, res) => {
  const integrationId = String(req.params.integration_id)
  const { data: integration } = await supabaseAdmin.from('integrations').select('*').eq('id', integrationId).single()
  if (!integration) return res.status(404).json({ error: 'Integration not found' })
  if (!(await ensureWorkspaceAccess(req, integration.workspace_id))) {
    return res.status(403).json({ error: 'No access to this integration' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, integration.workspace_id))) return
  try {
    const instances = await syncIntegration(integration)
    res.json({ instances })
  } catch (error: any) {
    res.status(502).json({ error: error.message })
  }
})

router.get('/workspace-numbers', requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = String(req.query.workspace_id || '')
  if (!workspaceId || !(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  const { data, error } = await supabaseAdmin.from('whatsapp_numbers').select('*')
    .eq('workspace_id', workspaceId).order('display_name')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ numbers: data })
})

router.patch('/workspaces/:workspace_id/monitoring', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const workspaceId = String(req.params.workspace_id)
  if (!(await ensureWorkspaceAccess(req, workspaceId))) return res.status(403).json({ error: 'No access to this workspace' })
  if (!(await ensureWorkspaceOperationalAccess(req, res, workspaceId))) return
  const allowed = ['monitoring_enabled', 'auto_monitor_new_numbers', 'notify_whatsapp', 'notify_email', 'notify_on_reconnect']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)))
  const { data, error } = await supabaseAdmin.from('workspaces').update(updates)
    .eq('id', workspaceId).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ workspace: data })
})

router.patch('/numbers/:number_id/monitoring', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const numberId = String(req.params.number_id)
  const { data: number } = await supabaseAdmin.from('whatsapp_numbers').select('*').eq('id', numberId).single()
  if (!number) return res.status(404).json({ error: 'Number not found' })
  const workspaceId = number.workspace_id
  if (!workspaceId || !(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this number' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, workspaceId))) return
  const { data, error } = await supabaseAdmin.from('whatsapp_numbers')
    .update({ monitoring_enabled: Boolean(req.body.monitoring_enabled) })
    .eq('id', numberId).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ number: data })
})

router.post('/numbers/:number_id/reconnect-authentication', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const numberId = String(req.params.number_id)
  const method = String(req.body?.method || '')
  if (!['qr', 'pairing'].includes(method)) {
    return res.status(400).json({ error: 'method must be qr or pairing' })
  }
  const { data: number } = await supabaseAdmin.from('whatsapp_numbers')
    .select('id, workspace_id')
    .eq('id', numberId)
    .single()
  if (!number) return res.status(404).json({ error: 'Número não encontrado' })
  if (!number.workspace_id || !(await ensureWorkspaceAccess(req, number.workspace_id))) {
    return res.status(403).json({ error: 'Sem acesso a este número' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, number.workspace_id))) return
  try {
    const result = await sendManualReconnectAuthentication(
      numberId,
      method as 'qr' | 'pairing'
    )
    await writeAuditLog({
      userId: req.currentUser!.id,
      workspaceId: number.workspace_id,
      action: result.skipped
        ? 'number.manual_reconnect_authentication_skipped'
        : 'number.manual_reconnect_authentication_sent',
      entityType: 'whatsapp_number',
      entityId: numberId,
      metadata: { method, reason: result.reason ?? null, status: result.status ?? null }
    })
    res.json({ result })
  } catch (error: any) {
    await insertEvent(numberId, 'manual_reconnect_authentication_failed', {
      method,
      error: error.message
    })
    res.status(502).json({ error: error.message })
  }
})

router.get('/admin/notification-settings', requireAuth, requireRole(['superadmin']), async (_req, res) => {
  const [{ data: settings, error }, { data: senders }] = await Promise.all([
    supabaseAdmin.from('platform_settings').select('*').eq('id', 1).single(),
    supabaseAdmin.from('whatsapp_numbers').select('id, phone, display_name, provider, external_id, status')
      .eq('status', 'connected').not('integration_id', 'is', null).order('display_name')
  ])
  if (error) return res.status(500).json({ error: error.message })
  res.json({ settings, senders: senders ?? [] })
})

router.patch('/admin/notification-settings', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const { primary_sender_id, fallback_sender_id } = req.body
  if (primary_sender_id && primary_sender_id === fallback_sender_id) {
    return res.status(400).json({ error: 'Primary and fallback senders must be different' })
  }
  const { data, error } = await supabaseAdmin.from('platform_settings').upsert({
    id: 1, primary_sender_id: primary_sender_id || null, fallback_sender_id: fallback_sender_id || null
  }).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  await writeAuditLog({
    userId: req.currentUser!.id, action: 'notification_senders.updated',
    entityType: 'platform_settings', metadata: { primary_sender_id, fallback_sender_id }
  })
  res.json({ settings: data })
})

router.get('/workspaces/:workspace_id/notification-settings', requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = String(req.params.workspace_id)
  if (!(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  const [{ data: settings, error }, { data: senders }] = await Promise.all([
    supabaseAdmin.from('workspace_notification_settings').select('*').eq('workspace_id', workspaceId).maybeSingle(),
    supabaseAdmin.from('whatsapp_numbers')
      .select('id, phone, display_name, provider, external_id, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'connected')
      .not('integration_id', 'is', null)
      .order('display_name')
  ])
  if (error) return res.status(500).json({ error: error.message })
  res.json({
    settings: settings ?? { workspace_id: workspaceId, primary_sender_id: null, fallback_sender_id: null },
    senders: senders ?? []
  })
})

router.patch('/workspaces/:workspace_id/notification-settings', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const workspaceId = String(req.params.workspace_id)
  if (!(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, workspaceId))) return
  const { primary_sender_id, fallback_sender_id } = req.body
  if (primary_sender_id && primary_sender_id === fallback_sender_id) {
    return res.status(400).json({ error: 'Primary and fallback senders must be different' })
  }
  const senderIds = [primary_sender_id, fallback_sender_id].filter(Boolean)
  if (senderIds.length) {
    const { data: validSenders } = await supabaseAdmin.from('whatsapp_numbers').select('id')
      .eq('workspace_id', workspaceId).eq('status', 'connected').in('id', senderIds)
    if ((validSenders ?? []).length !== senderIds.length) {
      return res.status(400).json({ error: 'Senders must be connected numbers from this workspace' })
    }
  }
  const { data, error } = await supabaseAdmin.from('workspace_notification_settings').upsert({
    workspace_id: workspaceId,
    primary_sender_id: primary_sender_id || null,
    fallback_sender_id: fallback_sender_id || null,
    updated_at: new Date().toISOString()
  }).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  await writeAuditLog({
    userId: req.currentUser!.id, workspaceId,
    action: 'workspace.notification_senders.updated',
    entityType: 'workspace', entityId: workspaceId,
    metadata: { primary_sender_id, fallback_sender_id }
  })
  res.json({ settings: data })
})

router.post('/webhooks/providers/:integration_id', requireWebhookSecret, async (req, res) => {
  const integrationId = String(req.params.integration_id)
  const { data: integration } = await supabaseAdmin.from('integrations').select('*').eq('id', integrationId).single()
  if (!integration) return res.status(404).json({ error: 'Integration not found' })
  const body = req.body ?? {}
  const incomingMessage = normalizeIncomingProviderMessage(body)
  if (incomingMessage) {
    try {
      const result = await processIncomingProviderMessage(integration, incomingMessage)
      return res.json({ received: true, type: 'message', ...result })
    } catch (error: any) {
      console.error('Failed to process incoming reconnect choice:', error.message)
      return res.status(502).json({ received: true, type: 'message', error: error.message })
    }
  }
  const connectionUpdate = connectionWebhookPayload(integration.provider, body)
  if (connectionUpdate.ignored) {
    return res.json({
      received: true,
      ignored: true,
      reason: connectionUpdate.reason,
      event: connectionUpdate.event
    })
  }
  const { externalId, status: normalized, event, rawStatus } = connectionUpdate
  const { data: previous } = await supabaseAdmin.from('whatsapp_numbers').select('*')
    .eq('integration_id', integrationId).eq('external_id', externalId).single()
  if (!previous) {
    return res.json({ received: true, ignored: true, reason: 'instance_not_found', external_id: externalId })
  }

  const checkedAt = new Date().toISOString()
  const confirmationThreshold = Math.max(1, Number(process.env.MONITOR_FAILURE_THRESHOLD || 2))
  const disconnectGraceMs = Math.max(0, Number(process.env.DISCONNECT_GRACE_MS || 120_000))
  let savedStatus: ProviderConnectionStatus = normalized
  let consecutiveFailures = Number(previous.consecutive_failures || 0)

  if (normalized === 'connected') {
    consecutiveFailures = 0
  } else if (normalized === 'pending') {
    savedStatus = previous.status
  } else if (previous.status === 'connected') {
    consecutiveFailures += 1
    const lastSeenAt = previous.last_seen_at ? new Date(previous.last_seen_at).getTime() : 0
    const insideGraceWindow = lastSeenAt > 0 && Date.now() - lastSeenAt < disconnectGraceMs
    if (consecutiveFailures < confirmationThreshold || insideGraceWindow) savedStatus = 'connected'
  }

  const { data: number } = await supabaseAdmin.from('whatsapp_numbers').update({
    status: savedStatus,
    consecutive_failures: consecutiveFailures,
    last_checked_at: checkedAt,
    last_seen_at: normalized === 'connected' ? checkedAt : previous.last_seen_at
  }).eq('integration_id', integrationId).eq('external_id', externalId).select('*').single()
  if (number) {
    await insertEvent(number.id, 'provider_status_webhook', {
      provider: integration.provider,
      event,
      raw_status: rawStatus,
      normalized_status: normalized,
      saved_status: savedStatus,
      consecutive_failures: consecutiveFailures,
      disconnect_grace_ms: disconnectGraceMs
    })
    if (previous && previous.status !== number.status) await processSyncedTransition(previous, number, integration)
  }
  res.json({ received: true, updated: Boolean(number) })
})

router.get('/clients/:client_id/numbers', requireAuth, async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  if (!(await ensureWorkspaceAccess(req, client.workspace_id))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('client_id', client_id)
    .order('created_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ numbers: data })
})

router.post('/clients/:client_id/numbers', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const { phone, notify_to, notify_channel = 'whatsapp' } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  if (!['email', 'whatsapp'].includes(notify_channel)) {
    return res.status(400).json({ error: 'notify_channel must be email or whatsapp' })
  }

  const normalizedPhone = String(phone).replace(/\D/g, '')
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return res.status(400).json({ error: 'phone must contain 10 to 15 digits, including country code' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  if (!(await ensureWorkspaceAccess(req, client.workspace_id))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, client.workspace_id))) return

  const { data, error } = await supabaseAdmin
    .from('whatsapp_numbers')
    .insert([{
      client_id,
      phone: normalizedPhone,
      provider: client.integration_platform,
      notify_to: notify_to ? String(notify_to).trim() : null,
      notify_channel
    }])
    .select('*')
    .single()

  if (error) {
    return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message })
  }

  await writeAuditLog({
    userId: req.currentUser!.id,
    workspaceId: client.workspace_id,
    action: 'number.created',
    entityType: 'whatsapp_number',
    entityId: data.id,
    metadata: { client_id, phone: normalizedPhone, notify_channel }
  })
  res.status(201).json({ number: data })
})

router.get('/numbers/:number_id/events', requireAuth, async (req: AuthRequest, res) => {
  const { number_id } = req.params
  const { data: number } = await supabaseAdmin.from('whatsapp_numbers').select('*').eq('id', number_id).single()
  if (!number) return res.status(404).json({ error: 'Whatsapp number not found' })
  const { data: client } = await supabaseAdmin.from('clients').select('*').eq('id', number.client_id).single()
  if (!client || !(await ensureWorkspaceAccess(req, client.workspace_id))) {
    return res.status(403).json({ error: 'No access to this number' })
  }
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, event_type, payload, created_at')
    .eq('whatsapp_number_id', number_id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ events: data })
})

router.get('/numbers/:number_id/uptime', requireAuth, async (req: AuthRequest, res) => {
  const { number_id } = req.params
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90)
  const since = new Date(Date.now() - days * 86_400_000)
  const { data: number } = await supabaseAdmin.from('whatsapp_numbers').select('*').eq('id', number_id).single()
  if (!number) return res.status(404).json({ error: 'Whatsapp number not found' })
  const { data: client } = await supabaseAdmin.from('clients').select('*').eq('id', number.client_id).single()
  if (!client || !(await ensureWorkspaceAccess(req, client.workspace_id))) {
    return res.status(403).json({ error: 'No access to this number' })
  }
  const { data: transitions, error } = await supabaseAdmin
    .from('events')
    .select('event_type, created_at')
    .eq('whatsapp_number_id', number_id)
    .in('event_type', ['disconnect', 'reconnected'])
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })

  let connected = transitions?.[0]?.event_type !== 'reconnected'
  let cursor = since.getTime()
  let connectedMs = 0
  let incidents = 0
  for (const transition of transitions ?? []) {
    const at = new Date(transition.created_at).getTime()
    if (connected) connectedMs += Math.max(0, at - cursor)
    if (transition.event_type === 'disconnect') incidents += 1
    connected = transition.event_type === 'reconnected'
    cursor = at
  }
  if (connected) connectedMs += Date.now() - cursor
  const totalMs = Date.now() - since.getTime()
  res.json({
    uptime: {
      days,
      percentage: Number(((connectedMs / totalMs) * 100).toFixed(2)),
      incidents,
      current_status: number.status,
      last_checked_at: number.last_checked_at
    }
  })
})

router.get('/audit-logs', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const workspaceId = String(req.query.workspace_id || '')
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' })
  if (!(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ audit_logs: data })
})

router.post('/clients', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { workspace_id, name, integration_platform, notify_email, notify_whatsapp, integration_config = {} } = req.body

  if (!workspace_id || !name || !integration_platform) {
    return res.status(400).json({ error: 'workspace_id, name and integration_platform are required' })
  }

  const allowed = await ensureWorkspaceAccess(req, workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, workspace_id))) return

  const { data, error } = await supabaseAdmin
    .from('clients')
    .insert([
      {
        workspace_id,
        name,
        integration_platform,
        notify_email,
        notify_whatsapp,
        integration_config
      }
    ])
    .select('*')
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.status(201).json({ client: publicClient(data) })
})

router.patch('/clients/:client_id/integration', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const requestedConfig = req.body.integration_config

  if (!requestedConfig || !requestedConfig.baseUrl) {
    return res.status(400).json({ error: 'integration_config.baseUrl is required' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  const existingApiKey = client.integration_config?.apiKey
  const suppliedApiKey = requestedConfig.apiKey
  if (!suppliedApiKey && !existingApiKey) {
    return res.status(400).json({ error: 'integration_config.apiKey is required' })
  }
  const integration_config = {
    ...requestedConfig,
    apiKey: suppliedApiKey || existingApiKey
  }

  try {
    const parsedUrl = new URL(integration_config.baseUrl)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Integration URL must use http or https' })
    }
  } catch {
    return res.status(400).json({ error: 'Integration baseUrl is invalid' })
  }

  if (client.integration_platform === 'evolution' && !integration_config.instanceName) {
    return res.status(400).json({ error: 'instanceName is required for Evolution' })
  }
  if (client.integration_platform === 'waha' && !integration_config.sessionName) {
    return res.status(400).json({ error: 'sessionName is required for WAHA' })
  }

  const allowed = await ensureWorkspaceAccess(req, client.workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, client.workspace_id))) return

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update({ integration_config: encryptIntegrationConfig(integration_config) })
    .eq('id', client_id)
    .select('*')
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  await writeAuditLog({
    userId: req.currentUser!.id,
    workspaceId: client.workspace_id,
    action: 'integration.updated',
    entityType: 'client',
    entityId: String(client_id),
    metadata: { provider: client.integration_platform, base_url: integration_config.baseUrl }
  })
  res.json({ client: publicClient(data) })
})

router.get('/clients/:client_id/provider-status', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const phone = req.query.phone as string

  if (!phone) {
    return res.status(400).json({ error: 'phone query parameter is required' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  const allowed = await ensureWorkspaceAccess(req, client.workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, client.workspace_id))) return

  try {
    const status = await getProviderStatus(client)
    res.json({ status })
  } catch (providerError: any) {
    res.status(502).json({ error: providerError.message })
  }
})

router.post('/clients/:client_id/reconnect', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const { phone } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  const allowed = await ensureWorkspaceAccess(req, client.workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, client.workspace_id))) return

  const { data: number, error: numberError } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('phone', phone)
    .eq('client_id', client_id)
    .single()

  if (numberError || !number) {
    return res.status(404).json({ error: 'Whatsapp number not found for this client' })
  }

  try {
    const result = await requestProviderReconnect(client, number)
    await insertEvent(number.id, 'provider_reconnect_requested', result)
    res.json({ result })
  } catch (providerError: any) {
    res.status(502).json({ error: providerError.message })
  }
})

router.post('/clients/:client_id/qr', requireAuth, requireRole(['workspace_admin', 'superadmin']), async (req: AuthRequest, res) => {
  const { client_id } = req.params
  const { phone } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found' })
  }

  const allowed = await ensureWorkspaceAccess(req, client.workspace_id)
  if (!allowed) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  if (!(await ensureWorkspaceOperationalAccess(req, res, client.workspace_id))) return

  const { data: number, error: numberError } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('phone', phone)
    .eq('client_id', client_id)
    .single()

  if (numberError || !number) {
    return res.status(404).json({ error: 'Whatsapp number not found for this client' })
  }

  try {
    const usePairing = shouldUsePairingCode(number, client)
    const result = usePairing
      ? await requestProviderPairing(client, number)
      : await requestProviderQr(client, number)
    await insertEvent(number.id, usePairing ? 'provider_pairing_requested' : 'provider_qr_requested', result)
    const authentication = await persistProviderAuthentication(number, result, usePairing ? 'pairing' : 'qr')
    res.json({ result: authentication })
  } catch (providerError: any) {
    await insertEvent(number.id, 'provider_authentication_failed', { error: providerError.message })
    res.status(502).json({ error: providerError.message })
  }
})

router.post('/webhooks/disconnect', requireWebhookSecret, async (req, res) => {
  const { phone, reason, client_id } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  let numberQuery = supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('phone', phone)

  if (client_id) {
    numberQuery = numberQuery.eq('client_id', client_id)
  }

  const { data: numbers, error } = await numberQuery.limit(2)

  if (error || !numbers?.length) {
    return res.status(404).json({ error: 'Whatsapp number not found' })
  }

  if (numbers.length > 1) {
    return res.status(409).json({ error: 'More than one client uses this phone; client_id is required' })
  }

  const number = numbers[0]
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', number.client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found for this number' })
  }
  const billingAccess = await workspaceBillingAccess(client.workspace_id)
  if (!billingAccess.communications_allowed) {
    await insertEvent(number.id, 'notification_suspended_billing', {
      billing_state: billingAccess.state,
      reason: billingAccess.reason
    })
    return res.json({ received: true, suspended: true, reason: 'billing_blocked' })
  }

  try {
    const usePairing = shouldUsePairingCode(number, client)
    const providerResult = usePairing
      ? await requestProviderPairing(client, number)
      : await requestProviderQr(client, number)
    const authentication = await persistProviderAuthentication(
      number,
      providerResult,
      usePairing ? 'pairing' : 'qr'
    )
    const result = await createDisconnectNotification(number, client, reason || 'disconnect', authentication)
    res.json({ result })
  } catch (providerError: any) {
    await insertEvent(number.id, 'provider_authentication_failed', { error: providerError.message })
    res.status(502).json({ error: providerError.message })
  }
})

router.post('/webhooks/generate-qr', requireWebhookSecret, async (req, res) => {
  const { phone } = req.body

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' })
  }

  const { data: number, error } = await supabaseAdmin
    .from('whatsapp_numbers')
    .select('*')
    .eq('phone', phone)
    .single()

  if (error || !number) {
    return res.status(404).json({ error: 'Whatsapp number not found' })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', number.client_id)
    .single()

  if (clientError || !client) {
    return res.status(404).json({ error: 'Client not found for this number' })
  }
  const billingAccess = await workspaceBillingAccess(client.workspace_id)
  if (!billingAccess.communications_allowed) {
    return res.json({ received: true, suspended: true, reason: 'billing_blocked' })
  }

  try {
    const usePairing = shouldUsePairingCode(number, client)
    const providerResult = usePairing
      ? await requestProviderPairing(client, number)
      : await requestProviderQr(client, number)
    const authentication = await persistProviderAuthentication(
      number,
      providerResult,
      usePairing ? 'pairing' : 'qr'
    )
    res.json({ authentication })
  } catch (providerError: any) {
    await insertEvent(number.id, 'provider_authentication_failed', { error: providerError.message })
    res.status(502).json({ error: providerError.message })
  }
})

export default router
