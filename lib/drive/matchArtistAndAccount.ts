import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchResult {
  artistId: string | null;
  socialAccountId: string | null;
  warning: string | null;
}

async function findArtistId(
  supabase: SupabaseClient,
  artistText: string
): Promise<string | null> {
  const { data: byName } = await supabase
    .from("artists")
    .select("id")
    .ilike("name", artistText)
    .limit(1)
    .maybeSingle();
  if (byName?.id) return byName.id;

  const { data: byHandle } = await supabase
    .from("artists")
    .select("id")
    .ilike("handle", artistText)
    .limit(1)
    .maybeSingle();
  return byHandle?.id ?? null;
}

async function findSocialAccountId(
  supabase: SupabaseClient,
  handleText: string
): Promise<string | null> {
  const { data } = await supabase
    .from("social_accounts")
    .select("id")
    .ilike("handle", handleText)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Resolve artista e conta social por nome/handle (texto vindo do JSON de
 * metadado). Sem match não é erro — o post é criado mesmo assim, sem
 * vínculo, com uma mensagem de aviso pra equipe corrigir na fila (nunca
 * falha em silêncio, ver docs/CLAUDE.md).
 */
export async function matchArtistAndAccount(
  supabase: SupabaseClient,
  artistText: string | null,
  socialAccountText: string
): Promise<MatchResult> {
  const warnings: string[] = [];

  let artistId: string | null = null;
  if (artistText) {
    artistId = await findArtistId(supabase, artistText);
    if (!artistId) warnings.push(`artista não encontrado: "${artistText}"`);
  }

  const socialAccountId = await findSocialAccountId(supabase, socialAccountText);
  if (!socialAccountId) {
    warnings.push(`conta social não encontrada: "${socialAccountText}"`);
  }

  return {
    artistId,
    socialAccountId,
    warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}
