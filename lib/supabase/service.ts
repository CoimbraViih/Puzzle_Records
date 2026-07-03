import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com a service-role key — ignora RLS. Só para uso em
 * rotas de servidor sem sessão de usuário (convites de admin, cron de
 * ingestão do Drive). Nunca expor ao client.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
