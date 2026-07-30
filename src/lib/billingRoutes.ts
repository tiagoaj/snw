import { timingSafeEqual } from 'crypto'
import { Request, Response, Router } from 'express'
import { AuthRequest, ensureWorkspaceAccess, requireAuth, requireRole } from './auth.js'
import {
  BILLING_PLANS,
  createAsaasCheckout,
  ensureWorkspaceSubscription,
  getWorkspacePaymentHistory,
  planForIntegrationCount,
  planFromId,
  processAsaasWebhook,
  publicSubscription
} from './billingService.js'
import { supabaseAdmin } from './supabaseClient.js'
import { writeAuditLog } from './auditService.js'
import { lookupBrazilianCep } from './cepService.js'

const router = Router()

function billingProfile(value: any) {
  const digits = (input: unknown) => String(input || '').replace(/\D/g, '')
  return {
    name: String(value?.name || '').trim(),
    cpfCnpj: digits(value?.cpfCnpj),
    phone: digits(value?.phone),
    address: String(value?.address || '').trim(),
    addressNumber: String(value?.addressNumber || '').trim(),
    complement: String(value?.complement || '').trim(),
    postalCode: digits(value?.postalCode),
    province: String(value?.province || '').trim(),
    city: String(value?.city || '').trim(),
    state: String(value?.state || '').trim().toUpperCase(),
    cityCode: digits(value?.cityCode)
  }
}

function validateBillingProfile(profile: ReturnType<typeof billingProfile>) {
  const missing: string[] = []
  const nameParts = profile.name.split(/\s+/).filter(Boolean)
  if (profile.name.length < 3 || (profile.cpfCnpj.length === 11 && nameParts.length < 2)) {
    missing.push(profile.cpfCnpj.length === 11 ? 'nome e sobrenome do titular' : 'razão social')
  }
  if (![11, 14].includes(profile.cpfCnpj.length)) missing.push('CPF ou CNPJ válido')
  if (![10, 11].includes(profile.phone.length)) missing.push('telefone com DDD')
  if (!profile.address) missing.push('logradouro')
  if (!profile.addressNumber) missing.push('número do endereço')
  if (profile.postalCode.length !== 8) missing.push('CEP com 8 dígitos')
  if (!profile.province) missing.push('bairro')
  if (missing.length) {
    throw new Error(`Preencha os dados de cobrança: ${missing.join(', ')}.`)
  }
}

function safeTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
}

async function workspaceAccount(req: AuthRequest, workspaceId: string) {
  const ownProfile = (req.currentUserProfiles ?? []).find((profile) =>
    profile.workspace_id === workspaceId && profile.role === 'workspace_admin'
  )
  if (ownProfile && req.currentUser && req.currentUserRow) {
    return {
      userId: req.currentUser.id,
      name: req.currentUserRow.full_name,
      email: req.currentUserRow.email,
      metadata: req.currentUser.user_metadata || {}
    }
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'workspace_admin')
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (profileError) throw new Error(profileError.message)
  if (!profile) return { userId: null, name: null, email: null, metadata: {} }

  const [{ data: userRow, error: userError }, { data: authData, error: authError }] = await Promise.all([
    supabaseAdmin.from('users').select('id, full_name, email').eq('id', profile.user_id).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(profile.user_id)
  ])
  if (userError) throw new Error(userError.message)
  if (authError) throw new Error(authError.message)
  return {
    userId: profile.user_id,
    name: userRow?.full_name ?? authData.user?.user_metadata?.full_name ?? null,
    email: userRow?.email ?? authData.user?.email ?? null,
    metadata: authData.user?.user_metadata || {}
  }
}

async function loadOrCreateSubscription(req: AuthRequest, workspaceId: string) {
  const [{ count, error: integrationError }, account] = await Promise.all([
    supabaseAdmin.from('integrations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    workspaceAccount(req, workspaceId)
  ])
  if (integrationError) throw new Error(integrationError.message)
  const metadataPlan = planFromId(account.metadata?.selected_plan)
  const plan = metadataPlan ?? planForIntegrationCount(count ?? 0)
  const subscription = await ensureWorkspaceSubscription({
    workspaceId,
    plan,
    trialStartedAt: account.metadata?.trial_started_at,
    trialEndsAt: account.metadata?.trial_ends_at
  })
  return { subscription, account }
}

router.get('/billing/plans', (_req, res) => {
  res.json({
    plans: Object.values(BILLING_PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      integration_limit: plan.integrationLimit,
      amount_cents: plan.amountCents
    })),
    trial_days: 7,
    billing_cycle: 'MONTHLY'
  })
})

router.get('/admin/subscriptions', requireAuth, requireRole(['superadmin']), async (_req, res) => {
  try {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, workspace_id, role, created_at')
      .not('workspace_id', 'is', null)
      .order('created_at')
    if (profilesError) throw new Error(profilesError.message)

    const userIds = [...new Set((profiles ?? []).map((profile) => profile.user_id).filter(Boolean))]
    const { data: users, error: usersError } = userIds.length
      ? await supabaseAdmin
        .from('users')
        .select('id, full_name, email, role, status')
        .in('id', userIds)
      : { data: [], error: null }
    if (usersError) throw new Error(usersError.message)

    const usersById = new Map((users ?? []).map((user) => [user.id, user]))
    const ownerByWorkspace = new Map<string, any>()
    for (const profile of profiles ?? []) {
      const account = usersById.get(profile.user_id)
      if (!account || account.role === 'superadmin' || !profile.workspace_id) continue
      if (!ownerByWorkspace.has(profile.workspace_id) || profile.role === 'workspace_admin') {
        ownerByWorkspace.set(profile.workspace_id, { ...account, workspace_role: profile.role })
      }
    }

    const workspaceIds = [...ownerByWorkspace.keys()]
    if (!workspaceIds.length) {
      return res.json({
        subscriptions: [],
        summary: {
          total: 0,
          statuses: {},
          plans: { start: 0, growth: 0, scale: 0 }
        }
      })
    }

    const { data: workspaces, error: workspacesError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, created_at')
      .in('id', workspaceIds)
    if (workspacesError) throw new Error(workspacesError.message)

    await supabaseAdmin
      .from('workspace_subscriptions')
      .update({ status: 'expired' })
      .in('workspace_id', workspaceIds)
      .eq('status', 'trialing')
      .lte('trial_ends_at', new Date().toISOString())

    const { data: existingSubscriptions, error: subscriptionsError } = await supabaseAdmin
      .from('workspace_subscriptions')
      .select('*')
      .in('workspace_id', workspaceIds)
    if (subscriptionsError) throw new Error(subscriptionsError.message)

    const subscriptionsByWorkspace = new Map(
      (existingSubscriptions ?? []).map((subscription) => [subscription.workspace_id, subscription])
    )

    const workspacesById = new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace]))
    const subscriptions = workspaceIds
      .map((workspaceId) => {
        const subscription = subscriptionsByWorkspace.get(workspaceId)
        const workspace = workspacesById.get(workspaceId)
        const account = ownerByWorkspace.get(workspaceId)
        if (!subscription || !workspace || !account) return null
        return {
          ...publicSubscription(subscription),
          created_at: subscription.created_at,
          workspace,
          account: {
            id: account.id,
            full_name: account.full_name,
            email: account.email,
            status: account.status
          }
        }
      })
      .filter(Boolean)
      .sort((left: any, right: any) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      )

    const statuses: Record<string, number> = {}
    const plans: Record<string, number> = { start: 0, growth: 0, scale: 0 }
    for (const subscription of subscriptions as any[]) {
      statuses[subscription.status] = (statuses[subscription.status] ?? 0) + 1
      plans[subscription.plan_id] = (plans[subscription.plan_id] ?? 0) + 1
    }

    res.json({
      subscriptions,
      summary: {
        total: subscriptions.length,
        statuses,
        plans
      }
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/address/cep/:cep', requireAuth, async (req, res) => {
  try {
    const address = await lookupBrazilianCep(req.params.cep)
    res.json({ address })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

router.get('/billing/subscription', requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = String(req.query.workspace_id || '')
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' })
  if (!(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  try {
    const { subscription, account } = await loadOrCreateSubscription(req, workspaceId)
    res.json({
      subscription: publicSubscription(subscription),
      billing_contact: {
        name: account.name,
        email: account.email
      }
    })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/billing/payments', requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = String(req.query.workspace_id || '')
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required' })
  if (!(await ensureWorkspaceAccess(req, workspaceId))) {
    return res.status(403).json({ error: 'No access to this workspace' })
  }
  try {
    const payments = await getWorkspacePaymentHistory(workspaceId)
    res.json({ payments })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.post(
  '/billing/checkout',
  requireAuth,
  requireRole(['workspace_admin', 'superadmin']),
  async (req: AuthRequest, res) => {
    const workspaceId = String(req.body?.workspace_id || '')
    const plan = planFromId(req.body?.plan_id)
    if (!workspaceId || !plan) {
      return res.status(400).json({ error: 'workspace_id e plan_id válido são obrigatórios' })
    }
    if (!(await ensureWorkspaceAccess(req, workspaceId))) {
      return res.status(403).json({ error: 'No access to this workspace' })
    }

    let customerBillingProfile
    try {
      customerBillingProfile = billingProfile(req.body?.billing_profile)
      const cepAddress = await lookupBrazilianCep(customerBillingProfile.postalCode)
      customerBillingProfile = {
        ...customerBillingProfile,
        address: customerBillingProfile.address || cepAddress.address,
        province: customerBillingProfile.province || cepAddress.province,
        city: cepAddress.city,
        state: cepAddress.state,
        cityCode: cepAddress.cityCode
      }
      validateBillingProfile(customerBillingProfile)
    } catch (error: any) {
      return res.status(400).json({ error: error.message })
    }

    try {
      const [{ subscription, account }, { count, error: integrationError }] = await Promise.all([
        loadOrCreateSubscription(req, workspaceId),
        supabaseAdmin.from('integrations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
      ])
      if (integrationError) throw new Error(integrationError.message)
      if ((count ?? 0) > plan.integrationLimit) {
        return res.status(400).json({
          error: `Este workspace possui ${count} integrações liberadas. Escolha um plano com limite compatível.`
        })
      }

      const result = await createAsaasCheckout({
        workspaceId,
        plan,
        customer: {
          email: account.email,
          ...customerBillingProfile
        },
        trialEndsAt: subscription.trial_ends_at
      })
      await writeAuditLog({
        userId: req.currentUser!.id,
        workspaceId,
        action: 'billing.checkout_created',
        entityType: 'workspace',
        entityId: workspaceId,
        metadata: { provider: 'asaas', plan_id: plan.id, reused: result.reused }
      })
      res.json(result)
    } catch (error: any) {
      res.status(502).json({ error: error.message })
    }
  }
)

router.post('/webhooks/asaas', async (req: Request, res: Response) => {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN || ''
  const receivedToken = req.header('asaas-access-token') || ''
  if (!expectedToken) {
    return res.status(503).json({ error: 'Webhook Asaas não está configurado' })
  }
  if (!safeTokenEquals(expectedToken, receivedToken)) {
    return res.status(401).json({ error: 'Token de webhook inválido' })
  }

  try {
    const result = await processAsaasWebhook(req.body)
    // O Asaas exige HTTP 200 para considerar o evento entregue.
    res.status(200).json({ received: true, ...result })
  } catch (error: any) {
    console.error('Falha ao processar webhook do Asaas:', error.message)
    res.status(500).json({ error: 'Falha ao processar evento do Asaas' })
  }
})

export default router
