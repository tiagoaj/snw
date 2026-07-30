import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import { supabaseAdmin, supabase } from './lib/supabaseClient.js'
import { requireAuth, requireRole, AuthRequest, ensureWorkspaceAccess } from './lib/auth.js'
import routes from './lib/routes.js'
import billingRoutes from './lib/billingRoutes.js'
import emailRoutes from './lib/emailRoutes.js'
import { startMonitoring } from './lib/monitoringService.js'
import { startEmailCampaignWorker } from './lib/emailCampaignService.js'
import { startEmailAutomationWorker } from './lib/emailAutomationService.js'
import { sendEmail } from './lib/emailService.js'
import { writeAuditLog } from './lib/auditService.js'
import { ensureWorkspaceSubscription, planFromId } from './lib/billingService.js'

dotenv.config()

const app = express()
const port = process.env.PORT ? Number(process.env.PORT) : 4000

const allowedOrigins = (process.env.APP_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.set('trust proxy', 1)
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('Origin not allowed by CORS'))
  }
}))
app.use(express.json({
  verify(req: any, _res, buffer) {
    req.rawBody = buffer.toString('utf8')
  }
}))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', billingRoutes)
app.use('/api', emailRoutes)
app.use('/api', routes)

app.get('/', (_req, res) => {
  res.send({ status: 'ok', message: 'SNW Whatsapp Notification backend' })
})

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, company_name, selected_plan, providers = [] } = req.body
  const selectedPlan = planFromId(selected_plan)
  const allowedProviders = ['uazapi', 'evolution', 'waha']

  if (!email || !password || !full_name || !company_name) {
    return res.status(400).json({ error: 'email, password, full_name and company_name are required' })
  }
  if (!selectedPlan) {
    return res.status(400).json({ error: 'selected_plan is invalid' })
  }
  if (!Array.isArray(providers) ||
    providers.length !== selectedPlan.integrationLimit ||
    providers.some((provider) => !allowedProviders.includes(String(provider))) ||
    new Set(providers).size !== providers.length) {
    return res.status(400).json({
      error: `Selecione exatamente ${selectedPlan.integrationLimit} integração(ões) diferentes para este plano`
    })
  }

  const { data: existingUser, error: existingError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .single()

  if (existingError && existingError.code !== 'PGRST116') {
    return res.status(500).json({ error: existingError.message })
  }

  if (existingUser) {
    return res.status(400).json({ error: 'A user with this email already exists' })
  }

  const trialStartedAt = new Date()
  const trialEndsAt = new Date(trialStartedAt.getTime() + 7 * 86_400_000)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      company_name,
      selected_plan: selectedPlan.id,
      subscription_status: 'trialing',
      trial_started_at: trialStartedAt.toISOString(),
      trial_ends_at: trialEndsAt.toISOString()
    }
  })

  if (authError) {
    return res.status(500).json({ error: authError.message })
  }

  const user = authData?.user ?? authData
  const user_id = user?.id

  if (!user_id) {
    return res.status(500).json({ error: 'Unable to determine created user id' })
  }

  const { data: selectedSuperadmin, error: superadminError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('role', 'superadmin')
    .limit(1)
    .single()

  if (superadminError && superadminError.code !== 'PGRST116') {
    return res.status(500).json({ error: superadminError.message })
  }

  const isFirstSuperadmin = !selectedSuperadmin
  const role = isFirstSuperadmin ? 'superadmin' : 'client_user'
  const status = 'active'

  const { error: insertError } = await supabaseAdmin.from('users').insert([
    {
      id: user_id,
      email,
      full_name,
      role,
      status
    }
  ])

  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(user_id)
    return res.status(500).json({ error: insertError.message })
  }

  if (isFirstSuperadmin) {
    return res.status(201).json({
      user,
      role,
      status,
      selected_plan: selectedPlan.id,
      workspace: null
    })
  }

  const slugBase = String(company_name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'workspace'
  const workspaceSlug = `${slugBase}-${randomUUID().slice(0, 6)}`
  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert([{ name: String(company_name).trim(), slug: workspaceSlug }])
    .select('*')
    .single()
  if (workspaceError || !workspace) {
    await supabaseAdmin.from('users').delete().eq('id', user_id)
    await supabaseAdmin.auth.admin.deleteUser(user_id)
    return res.status(500).json({ error: workspaceError?.message || 'Unable to create workspace' })
  }

  const { error: profileError } = await supabaseAdmin.from('user_profiles').insert([{
    user_id,
    workspace_id: workspace.id,
    role: 'workspace_admin'
  }])
  const { error: integrationsError } = await supabaseAdmin.from('integrations').insert(
    providers.map((provider: string) => ({
      workspace_id: workspace.id,
      provider,
      name: provider.toUpperCase()
    }))
  )
  if (profileError || integrationsError) {
    await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id)
    await supabaseAdmin.from('users').delete().eq('id', user_id)
    await supabaseAdmin.auth.admin.deleteUser(user_id)
    return res.status(500).json({ error: profileError?.message || integrationsError?.message })
  }

  try {
    await ensureWorkspaceSubscription({
      workspaceId: workspace.id,
      plan: selectedPlan,
      trialStartedAt: trialStartedAt.toISOString(),
      trialEndsAt: trialEndsAt.toISOString()
    })
  } catch (billingError: any) {
    return res.status(500).json({ error: `Não foi possível iniciar o teste grátis: ${billingError.message}` })
  }

  await writeAuditLog({
    userId: user_id,
    workspaceId: workspace.id,
    action: 'customer.self_registered',
    entityType: 'workspace',
    entityId: workspace.id,
    metadata: { plan_id: selectedPlan.id, providers }
  })

  try {
    await sendEmail({
      recipient: {
        email,
        name: full_name,
        userId: user_id,
        workspaceId: workspace.id
      },
      category: 'platform',
      templateKey: 'welcome',
      idempotencyKey: `welcome:${user_id}`,
      variables: {
        trialEndsAt: trialEndsAt.toLocaleString('pt-BR'),
        dashboardUrl: process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN
      }
    })
  } catch (emailError: any) {
    console.error('Welcome email failed:', emailError.message)
  }

  res.status(201).json({
    user,
    role,
    status,
    selected_plan: selectedPlan.id,
    workspace,
    providers,
    trial_ends_at: trialEndsAt.toISOString()
  })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    return res.status(401).json({ error: error.message })
  }

  const user = data.user
  if (!user) {
    return res.status(401).json({ error: 'Authentication failed' })
  }

  const { data: userRow, error: userRowError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return res.status(403).json({ error: 'User not found or not approved' })
  }

  if (userRow.status !== 'active') {
    return res.status(403).json({ error: 'User is not approved yet' })
  }

  res.json({ session: data.session, user: data.user })
})

app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = String(req.body?.refresh_token || '')
  if (!refreshToken) {
    return res.status(400).json({ error: 'refresh_token is required' })
  }
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  })
  if (error || !data.session) {
    return res.status(401).json({ error: error?.message || 'Unable to refresh session' })
  }
  res.json({ session: data.session })
})

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Informe o e-mail da conta' })
  const redirectBase = (process.env.APP_PUBLIC_URL || process.env.APP_ORIGIN || '')
    .split(',')[0]
    .replace(/\/+$/, '')
  if (!redirectBase) return res.status(503).json({ error: 'APP_PUBLIC_URL não está configurada' })
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectBase
  })
  if (error) console.error('Password recovery request failed:', error.message)
  // Resposta deliberadamente neutra para não revelar quais e-mails possuem conta.
  res.json({ success: true, message: 'Se este e-mail estiver cadastrado, enviaremos o link de recuperação.' })
})

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({
    user: req.currentUser,
    userRow: req.currentUserRow,
    profiles: req.currentUserProfiles
  })
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { access_token, password } = req.body
  if (!access_token || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'access_token and a password with at least 8 characters are required' })
  }

  const { data: authResult, error: tokenError } = await supabaseAdmin.auth.getUser(access_token)
  if (tokenError || !authResult.user) {
    return res.status(401).json({ error: 'Recovery link is invalid or expired' })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(authResult.user.id, { password })
  if (error) return res.status(500).json({ error: error.message })

  await writeAuditLog({
    userId: authResult.user.id,
    action: 'user.password_reset',
    entityType: 'user',
    entityId: authResult.user.id
  })
  res.json({ success: true })
})

app.get('/api/users/pending', requireAuth, requireRole(['superadmin']), async (_req: AuthRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ users: data })
})

app.post('/api/users/approve', requireAuth, requireRole(['superadmin']), async (req: AuthRequest, res) => {
  const { user_id, approve } = req.body

  if (!user_id || typeof approve !== 'boolean') {
    return res.status(400).json({ error: 'user_id and approve(boolean) are required' })
  }

  const status = approve ? 'active' : 'rejected'

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ status })
    .eq('id', user_id)
    .select('*')
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  let trial: { trial_started_at: string; trial_ends_at: string; selected_plan: string | null } | null = null
  if (approve) {
    const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(user_id)
    if (authUserError || !authUserData.user) {
      await supabaseAdmin.from('users').update({ status: 'pending' }).eq('id', user_id)
      return res.status(500).json({ error: authUserError?.message || 'Auth user not found' })
    }
    const trialStartedAt = new Date()
    const trialEndsAt = new Date(trialStartedAt.getTime() + 7 * 86_400_000)
    const selectedPlan = authUserData.user.user_metadata?.selected_plan || null
    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      user_metadata: {
        ...authUserData.user.user_metadata,
        selected_plan: selectedPlan,
        subscription_status: 'trialing',
        trial_started_at: trialStartedAt.toISOString(),
        trial_ends_at: trialEndsAt.toISOString()
      }
    })
    if (metadataError) {
      await supabaseAdmin.from('users').update({ status: 'pending' }).eq('id', user_id)
      return res.status(500).json({ error: metadataError.message })
    }
    trial = {
      trial_started_at: trialStartedAt.toISOString(),
      trial_ends_at: trialEndsAt.toISOString(),
      selected_plan: selectedPlan
    }
  }

  await writeAuditLog({
    userId: req.currentUser!.id,
    action: approve ? 'user.approved' : 'user.rejected',
    entityType: 'user',
    entityId: user_id
  })
  res.json({ user: data, trial })
})

app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`)
  const backgroundWorkersEnabled = !['false', '0', 'off'].includes(
    String(process.env.BACKGROUND_WORKERS_ENABLED ?? 'true').toLowerCase()
  )
  if (backgroundWorkersEnabled) {
    startMonitoring()
    startEmailCampaignWorker()
    startEmailAutomationWorker()
  } else {
    console.log('Workers automáticos desativados neste ambiente')
  }
})
