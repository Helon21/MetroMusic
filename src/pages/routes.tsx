import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { Btn, Empty } from "../components/ui";
import { nav } from "../store/ui";
import { AccountPage, HistoryPage, StatsPage, WrappedPage } from "./Activity";
import { ArtistPage, BrowsePage, ExplorePage, SearchPage } from "./Browse";
import { AlbumPage, PlaylistPage, PodcastPage } from "./Collection";
import Home from "./Home";
import Library from "./Library";
import RemoteCollection from "./RemoteCollection";
import Settings from "./Settings";
import { EqualizerPage, RecognizePage, TogetherPage } from "./Tools";
export { Dialogs } from "../components/Dialogs";

/** Converte a rota ("album/al3_1") na tela correspondente. */
export function renderRoute(route: string): ReactNode {
  const [head, a, b] = route.split("/");
  switch (head) {
    case "home": return <Home />;
    case "explore": return <ExplorePage tab={a} />;
    case "browse": return <BrowsePage id={a} />;
    case "search": return <SearchPage q={decodeURIComponent(a ?? "")} />;
    case "library": return <Library tab={a} />;
    case "playlist": return <PlaylistPage id={a} />;
    case "album": return <AlbumPage id={a} />;
    case "artist": return <ArtistPage id={a} view={b} />;
    case "podcast": return <PodcastPage id={a} />;
    case "yt": return <RemoteCollection key={`${a}/${b}`} kind={a} id={b} />;
    case "history": return <HistoryPage />;
    case "stats": return <StatsPage />;
    case "wrapped": return <WrappedPage />;
    case "account": return <AccountPage />;
    case "together": return <TogetherPage />;
    case "recognize": return <RecognizePage />;
    case "equalizer": return <EqualizerPage />;
    case "settings": return <Settings page={a} />;
  }
  return <Empty icon={<Compass />} title="Página não encontrada" text="Este endereço não leva a lugar nenhum."><Btn onClick={() => nav("home")}>Ir para o início</Btn></Empty>;
}
