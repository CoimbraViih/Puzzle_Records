import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SupabaseStatus } from "@/components/supabase-status";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-foreground">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center">
        <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
          M0 — Scaffolding
        </span>

        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Agente IA Puzzle Records
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Agente de IA para automação de redes sociais. Este é o estágio
            inicial de scaffolding do projeto.
          </p>
        </div>

        <SupabaseStatus />

        <Button
          variant="default"
          size="default"
          nativeButton={false}
          render={<Link href="/login" />}
        >
          Começar
        </Button>
      </main>
    </div>
  );
}
