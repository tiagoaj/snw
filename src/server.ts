import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { supabaseAdmin, supabase } from './lib/supabaseClient.js'
import { requireAuth, requireRole, AuthRequest, ensureWorkspaceAccess } from './lib/auth.js'
import routes from './lib/routes.js'
import { startMonitoring } from './lib/monitoringService.js'
import { writeAuditLog } from './lib/auditService.js'

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
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api', routes)

app.get('/', (_req, res) => {
  res.send({ status: 'ok', message: 'SNW Whatsapp Notification backend' })
})

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, selected_plan } = req.body

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'email, password and full_name are required' })
  }
  if (selected_plan && !['start', 'growth', 'scale'].includes(String(selected_plan))) {
    return res.status(400).json({ error: 'selected_plan is invalid' })
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

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name,
      selected_plan: selected_plan || null
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
  const status = isFirstSuperadmin ? 'active' : 'pending'

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
    return res.status(500).json({ error: insertError.message })
  }

  res.status(201).json({ user, role, status, selected_plan: selected_plan || null })
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
  startMonitoring()
})
