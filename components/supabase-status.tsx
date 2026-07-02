"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ConnectionState = "checking" | "connected" | "missing-env" | "error";

/**
 * Verifica se o cliente Supabase consegue ser instanciado e responder a
 * uma chamada simples (`auth.getSession()`), sem exigir que exista uma
 * sessão de usuário ativa. Não deve nunca lançar uma exceção não tratada
 * ao renderizar — se as variáveis de ambiente estiverem ausentes ou a
 * chamada falhar, o componente apenas reporta o estado visualmente.
 */
export function SupabaseStatus() {
  const [state, setState] = useState<ConnectionState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function checkConnection() {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.getSession();

        if (cancelled) return;

        setState(error ? "error" : "connected");
      } catch {
        if (cancelled) return;

        // `createClient()` lança quando as env vars não estão configuradas.
        setState("missing-env");
      }
    }

    checkConnection();

    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    state === "checking"
      ? "Supabase: verificando conexão..."
      : state === "connected"
        ? "Supabase: conectado"
        : state === "missing-env"
          ? "Supabase: variáveis de ambiente ausentes"
          : "Supabase: erro ao conectar";

  const dotColor =
    state === "connected"
      ? "bg-primary"
      : state === "checking"
        ? "bg-muted-foreground"
        : "bg-destructive";

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-card-foreground"
      data-testid="supabase-status"
      data-state={state}
    >
      <span
        className={cn("size-2 rounded-full", dotColor)}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
