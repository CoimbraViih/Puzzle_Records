"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { createArtist, type ArtistFormState } from "./actions";

const initialState: ArtistFormState = undefined;

export function ArtistForm() {
  const [state, formAction, pending] = useActionState(
    createArtist,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="artist-name" className="text-sm text-muted-foreground">
          Nome
        </label>
        <input
          id="artist-name"
          name="name"
          required
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="artist-handle"
          className="text-sm text-muted-foreground"
        >
          @handle
        </label>
        <input
          id="artist-handle"
          name="handle"
          required
          placeholder="@mcstaylon"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar"}
      </Button>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
