import { Button } from "@/components/ui/button";
import { listArtists } from "@/lib/posts/queries";

import { deleteArtist } from "./actions";
import { ArtistForm } from "./artist-form";

export const dynamic = "force-dynamic";

export default async function ArtistasPage() {
  const artists = await listArtists();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Artistas</h1>

      <ArtistForm />

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">Nome</th>
            <th className="py-2">Handle</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {artists.map((artist) => (
            <tr key={artist.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">{artist.name}</td>
              <td className="py-2 text-foreground">{artist.handle}</td>
              <td className="py-2 text-right">
                <form action={deleteArtist.bind(null, artist.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Excluir
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
