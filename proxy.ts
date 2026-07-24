import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // api/cron/ e api/n8n/ excluídos: essas rotas se autenticam sozinhas via
    // CRON_SECRET (Bearer token), nunca com sessão de usuário Supabase — sem
    // essa exclusão, o gate "sem usuário → 401" abaixo bloqueava toda chamada
    // antes mesmo da rota checar o CRON_SECRET, inclusive as chamadas legítimas
    // da própria Vercel (para api/cron/) ou n8n (para api/n8n/).
    // Barra final obrigatória: exclui só sub-rotas de /api/cron/** e
    // /api/n8n/**, não qualquer rota futura cujo nome comece com essas letras
    // (ex: um hipotético /api/cron-debug não deve escapar do gate de sessão).
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|api/n8n/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
