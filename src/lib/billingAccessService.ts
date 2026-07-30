import { supabaseAdmin } from './supabaseClient.js'

export type BillingAccessState = {
  state: 'active' | 'trial' | 'grace' | 'blocked'
  operational_allowed: boolean
  communications_allowed: boolean
  grace_ends_at: string | null
  reason: string | null
}

const unrestrictedAccess: BillingAccessState = {
  state: 'active',
  operational_allowed: true,
  communications_allowed: true,
  grace_ends_at: null,
  reason: 'superadmin_exempt'
}

const superadminWorkspaceCache = new Map<string, { exempt: boolean; expiresAt: number }>()

async function workspaceBelongsToSuperadmin(workspaceId: string) {
  const cached = superadminWorkspaceCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.exempt

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('workspace_id', workspaceId)
  if (profilesError) throw new Error(profilesError.message)

  const userIds = [...new Set((profiles ?? []).map((profile) => profile.user_id).filter(Boolean))]
  let exempt = false
  if (userIds.length) {
    const { count, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .in('id', userIds)
      .eq('role', 'superadmin')
    if (usersError) throw new Error(usersError.message)
    exempt = (count ?? 0) > 0
  }

  superadminWorkspaceCache.set(workspaceId, {
    exempt,
    expiresAt: Date.now() + 5 * 60_000
  })
  return exempt
}

export function subscriptionBillingAccess(subscription: any, now = new Date()): BillingAccessState {
  if (!subscription) {
    return {
      state: 'trial',
      operational_allowed: true,
      communications_allowed: true,
      grace_ends_at: null,
      reason: null
    }
  }

  if (subscription.status === 'active') {
    return {
      state: 'active',
      operational_allowed: true,
      communications_allowed: true,
      grace_ends_at: null,
      reason: null
    }
  }

  const delinquency = subscription.metadata?.delinquency
  const graceEndsAt = delinquency?.grace_ends_at ? new Date(delinquency.grace_ends_at) : null
  if (subscription.status === 'past_due' && graceEndsAt && graceEndsAt.getTime() > now.getTime()) {
    return {
      state: 'grace',
      operational_allowed: true,
      communications_allowed: true,
      grace_ends_at: graceEndsAt.toISOString(),
      reason: 'payment_past_due'
    }
  }

  if (subscription.status !== 'past_due' &&
    subscription.trial_ends_at &&
    new Date(subscription.trial_ends_at).getTime() > now.getTime()) {
    return {
      state: 'trial',
      operational_allowed: true,
      communications_allowed: true,
      grace_ends_at: null,
      reason: null
    }
  }

  return {
    state: 'blocked',
    operational_allowed: false,
    communications_allowed: false,
    grace_ends_at: graceEndsAt?.toISOString() ?? null,
    reason: subscription.status === 'past_due' ? 'payment_grace_expired' : `subscription_${subscription.status}`
  }
}

export async function workspaceBillingAccess(workspaceId: string) {
  if (await workspaceBelongsToSuperadmin(workspaceId)) {
    return { ...unrestrictedAccess }
  }
  const { data, error } = await supabaseAdmin
    .from('workspace_subscriptions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return subscriptionBillingAccess(data)
}
