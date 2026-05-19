/**
 * Supabase Vault wrappers for integration secrets.
 *
 * `vault.decrypted_secrets` and `vault.secrets` are not exposed via PostgREST,
 * so we call into three SECURITY DEFINER RPCs defined in
 * supabase/migrations/20260519000002_integration_secrets.sql:
 *
 *   - store_integration_secret(payload, name) → uuid
 *   - get_integration_secret(secret_id)       → text | null
 *   - delete_integration_secret(secret_id)    → boolean
 *
 * The RPCs are granted only to service_role; this module must always be
 * called with the admin client (createAdminClient).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Store a new secret. Returns the new vault.secrets row id.
 * `name` should be agent-scoped and stable (e.g. `gmail_refresh_${agent_id}`)
 * so it's grep-able in Vault, but the id is what the caller persists into
 * agent_integrations.vault_secret_id.
 */
export async function storeIntegrationSecret(
  admin: SupabaseClient,
  payload: string,
  name: string
): Promise<string> {
  const { data, error } = await admin.rpc('store_integration_secret', {
    p_secret_text: payload,
    p_name: name,
  })
  if (error || !data) {
    throw new Error(`vault.store failed: ${error?.message ?? 'no id returned'}`)
  }
  return data as string
}

/**
 * Read a secret by id. Returns null if the secret has been deleted
 * (caller treats this as a disconnected/revoked integration).
 */
export async function readIntegrationSecret(
  admin: SupabaseClient,
  secretId: string
): Promise<string | null> {
  const { data, error } = await admin.rpc('get_integration_secret', {
    p_secret_id: secretId,
  })
  if (error) {
    throw new Error(`vault.read failed: ${error.message}`)
  }
  return (data ?? null) as string | null
}

/**
 * Delete a secret by id. Idempotent: returns false if the row was already gone.
 */
export async function deleteIntegrationSecret(
  admin: SupabaseClient,
  secretId: string
): Promise<boolean> {
  const { data, error } = await admin.rpc('delete_integration_secret', {
    p_secret_id: secretId,
  })
  if (error) {
    throw new Error(`vault.delete failed: ${error.message}`)
  }
  return Boolean(data)
}
