import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para uso em componentes de cliente ("use client").
 *
 * Cria uma nova instância a cada chamada (padrão recomendado pelo
 * @supabase/ssr) para evitar compartilhar estado entre requisições.
 * As variáveis de ambiente só são lidas quando a função é chamada,
 * nunca no momento do build.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
