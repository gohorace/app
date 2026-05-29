/**
 * HOR-321 · Public API v1 — service-role data client.
 *
 * Deliberately UNTYPED (no `<Database>` generic). The v1 relationship resource
 * reads `contact_property_engagement`, which doesn't exist in the generated
 * `database.types.ts` yet (the migration applies via Studio per the drift
 * rule, then types get regenerated). Rather than fight the generated types or
 * cast every call, v1 data queries run through this untyped client and every
 * row is funnelled through the typed mappers in `mappers.ts`, which enforce the
 * public output shape. Auth/token resolution still uses the typed admin client
 * (`@/lib/supabase/admin`) since `resolve_api_token` is in the generated types.
 *
 * Once the migration is applied and types are regenerated, this can switch to
 * the typed client with no change to the routes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function createApiV1Db(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
