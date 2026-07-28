import { supabaseAdmin } from './supabaseClient.js'

export async function writeAuditLog(input: {
  userId: string
  workspaceId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('audit_logs').insert([{
    user_id: input.userId,
    workspace_id: input.workspaceId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {}
  }])
  if (error) console.error('Failed to write audit log:', error.message)
}
