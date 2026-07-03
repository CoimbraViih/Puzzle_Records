import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { ROLE_HOME, type Role } from "@/lib/types/profile";

const PUBLIC_ROUTES = ["/login", "/auth"];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function roleAllowsRoute(role: Role, pathname: string) {
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return role === "admin";
  }
  if (pathname.startsWith("/aprovacao")) {
    return role === "admin" || role === "aprovador";
  }
  if (pathname.startsWith("/conteudo")) return true;
  return true;
}

/**
 * Faz o refresh de sessão do Supabase a cada request e aplica o
 * redirecionamento por papel. Chamado a partir de `proxy.ts` na raiz.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sem env vars (ex: dev local ainda não configurado) — não bloqueia
    // a navegação, mesma postura tolerante do SupabaseStatus do M0.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (isPublicRoute(pathname)) {
      return response;
    }
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const redirectResponse = NextResponse.redirect(
      new URL("/login", request.url)
    );
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "equipe_conteudo") as Role;

  if (pathname === "/" || pathname === "/login") {
    const redirectResponse = NextResponse.redirect(
      new URL(ROLE_HOME[role], request.url)
    );
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (!roleAllowsRoute(role, pathname) && !isPublicRoute(pathname)) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const redirectResponse = NextResponse.redirect(
      new URL(ROLE_HOME[role], request.url)
    );
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}
