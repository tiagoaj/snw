import { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from './supabaseClient.js'
import { workspaceBillingAccess } from './billingAccessService.js'

export interface AuthRequest extends Request {
  currentUser?: any
  currentUserProfiles?: any[]
  currentUserRow?: any
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1]
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = getBearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Authorization header is required' })
  }

  const { data: authResult, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authResult?.user) {
    return res.status(401).json({ error: authError?.message ?? 'Invalid auth token' })
  }

  const user = authResult.user
  const { data: userRows, error: userError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (userError || !userRows) {
    return res.status(403).json({ error: 'User not found or not approved' })
  }

  if (userRows.status !== 'active') {
    return res.status(403).json({ error: 'User is not approved yet' })
  }

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)

  if (profileError) {
    return res.status(500).json({ error: profileError.message })
  }

  req.currentUser = user
  req.currentUserRow = userRows
  req.currentUserProfiles = profiles ?? []
  next()
}

export function requireRole(expectedRoles: Array<'superadmin' | 'workspace_admin' | 'client_user'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.currentUserRow?.role
    if (userRole && expectedRoles.includes(userRole)) {
      return next()
    }

    const profiles = req.currentUserProfiles
    if (!profiles || profiles.length === 0) {
      return res.status(403).json({ error: 'User has no workspace role' })
    }

    const hasRole = profiles.some((profile) => expectedRoles.includes(profile.role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}

export async function ensureWorkspaceAccess(req: AuthRequest, workspaceId: string) {
  if (req.currentUserRow?.role === 'superadmin') {
    return true
  }

  if (!req.currentUserProfiles) return false
  return req.currentUserProfiles.some(
    (profile) => profile.workspace_id === workspaceId && ['workspace_admin', 'superadmin'].includes(profile.role)
  )
}

export async function ensureWorkspaceOperationalAccess(
  req: AuthRequest,
  res: Response,
  workspaceId: string
) {
  if (req.currentUserRow?.role === 'superadmin') return true
  const access = await workspaceBillingAccess(workspaceId)
  if (access.operational_allowed) return true
  res.status(402).json({
    error: 'Workspace suspenso por pendência financeira. Regularize o pagamento para reativar a operação.',
    code: 'BILLING_BLOCKED',
    billing_access: access
  })
  return false
}

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WEBHOOK_SECRET
  if (!expected) {
    return res.status(503).json({ error: 'Webhook security is not configured' })
  }

  const received = req.header('x-webhook-secret') ?? String(req.query.secret ?? '')
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  next()
}
