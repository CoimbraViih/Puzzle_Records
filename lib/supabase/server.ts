import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para uso em Server Components, Server Actions e
 * Route Handlers do App Router.
 *
 * Deve ser instanciado dentro de cada função de request (nunca em módulo
 * top-level), pois depende do cookie store da requisição atual. As
 * variáveis de ambiente só são lidas quando a função é chamada, nunca no
 * momento do build.
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `setAll` foi chamado a partir de um Server Component.
          // Isso pode ser ignorado se houver um middleware atualizando
          // as sessões de usuário (a ser implementado em task futura).
        }
      },
    },
  });
}
