# Backend

Rust (`src-tauri/src`). Porta a lógica do MetroFuse (reprodução, provedores, letras, contas) e a valida contra os serviços reais.

## Fluxo de uma reprodução

```
interface ──audio_play(track)──▶ Player.play
                                   │ 1. providers::resolve   → StreamInfo (URL + cabeçalhos, ou lista de segmentos HLS, + loudness do serviço)
                                   │ 2. cache.entry_for + fetch → baixa em segundo plano para um arquivo que cresce
                                   │ 3. espera ~48 KiB → engine.load(abridor de leitor)
                                   ▼
                       thread de decodificação (Symphonia) lê o arquivo EM CRESCIMENTO
                                   ▼  reamostra (cúbica) → buffer (slot) de ~1,5 s
                       callback do cpal: mixagem da transição → equalizador → ganho → saída

interface ──audio_set_next(track)──▶ Player.set_next → segundo decodificador enche o outro slot
        no fim da faixa (ou com crossfade), o callback troca de slot e o motor emite audio:advanced
eventos audio:* (loading, buffering, loaded, playing, paused, position, ended, advanced, error) ◀── todas as janelas
```

## Módulos

| Arquivo | Papel | Origem no MetroFuse |
| --- | --- | --- |
| `providers/youtube.rs` | Busca e resolução do stream via InnerTube; loudness do vídeo | `YouTubeAudioProvider`, `InnerTube`, `YouTubeClient` |
| `providers/ytmusic.rs` | Início, álbuns, playlists, artistas, rádio, Explorar, conta, biblioteca, histórico, curtidas, "marcar como ouvida" | `YouTube.home/album/playlist/artist/next`, `registerPlaybackTracking` |
| `providers/auth.rs` | Sessão do YouTube Music (cookie + `SAPISIDHASH`) | `InnerTube` (cookie) |
| `providers/soundcloud.rs` | `client_id` raspado do site, busca, paradas, HLS (AAC em MP4 fragmentado) | `SoundCloudAudioProvider` |
| `providers/sc_account.rs` | Conta do SoundCloud: perfil, curtidas, playlists, histórico, curtir | (novo) |
| `providers/spotify.rs` | Conta do Spotify: login pela web (`sp_dc`), token do player web (TOTP) e GraphQL interno: biblioteca, playlists, álbuns, artistas, curtidas | `SpotifyCanvasClient` (token web e GraphQL) |
| `providers/deezer.rs` | API pública: busca, paradas, metadados, trecho de 30 s | `DeezerAudioProvider` (só a parte pública) |
| `providers/matcher.rs` | Decide se um resultado é a mesma música | `ProviderFallbackMatcher` |
| `providers/mod.rs` | Escolhe o provedor de cada faixa; correspondência paralela (8 s, cache de 90 s); início das outras fontes | `ProviderMatchSearch` |
| `lastfm.rs` | Last.fm: login, "Tocando agora", scrobble, Loved | `LastFM.kt` |
| `lyrics.rs` | LrcLib (LRC, 5 estratégias) e BetterLyrics (TTML, tempo por palavra e vozes de apoio) | `LrcLib`, `BetterLyrics`, `TTMLParser` |
| `cache.rs` | Cache em disco: download por `Range` ou segmentos, leitura durante o download, retomada, LRU | `PlaybackCacheIndex` + cache do Media3 |
| `preload.rs` | Pré-cache das próximas faixas | `NextTrackPreloadCoordinator` |
| `audio.rs` | Decodificação, reamostragem, dois slots, equalizador, normalização, crossfade/gapless, saída | (Media3/ExoPlayer no Android) |
| `playback.rs` | Une resolver → cache → motor; pré-carrega a próxima faixa | |
| `commands.rs` | Comandos expostos à interface (inclui as janelas de login) | |

## Provedores e áudio

- **YouTube Music:** só clientes que devolvem URL direta **sem PO token** (visionOS, iPadOS, Android VR 1.65 e 1.43, Android Music), em paralelo; vale o primeiro. A CDN exige o `User-Agent` do cliente que gerou a URL (vai em `StreamInfo.headers`). Prefere AAC de 128–256 kbps. Sem decifragem de assinatura nem BotGuard. O loudness (`perceptualLoudnessDb`, ou `loudnessDb − 7`) alimenta a normalização.
- **SoundCloud:** hoje só HLS (AAC em MP4 fragmentado). Faixas `SNIP` (só trecho) são descartadas.
- **Deezer e Spotify:** o áudio completo é protegido (DRM) e **não é obtido**. Tocam por correspondência no YouTube Music/SoundCloud (ordem em *Configurações › Ordem dos provedores*). O MetroFuse usa resolvedores de terceiros e descriptografia para o Deezer; isso **não foi portado**, de propósito.
- **Opus não toca** (o Symphonia não o decodifica).

## Contas

Cada sessão fica num arquivo no diretório de dados do app (permissão `0600`); a senha nunca é guardada.

| Serviço | Login | Arquivo | O que sincroniza |
| --- | --- | --- | --- |
| YouTube Music | janela do Google (cookies lidos do webview) ou cookie colado | `youtube-auth.json` | Início personalizada, curtidas, playlists, álbuns, artistas, histórico (ler) e histórico oficial (escrever, após 30 s ouvidos), curtir |
| SoundCloud | janela do SoundCloud (`oauth_token`) ou token colado | `soundcloud-auth.txt` | curtidas, playlists, histórico, curtir |
| Spotify | janela de login da web (cookie `sp_dc`) ou cookie colado | `spotify-auth.json` | curtidas, playlists, álbuns, artistas, Início, curtir |
| Last.fm | usuário e senha + chave/segredo de API do próprio usuário | `lastfm.json` | scrobble, "Tocando agora", Loved |

**Spotify:** método **não oficial**, como o do MetroFuse. Com o `sp_dc` o app pede um token ao player web (segredo TOTP lido de um gist público + hora do servidor → `open.spotify.com/api/token`) e fala com o **GraphQL interno** (`api-partner.spotify.com/pathfinder/v2/query`), com o hash de cada consulta lido do JS do player web. A API oficial (`api.spotify.com/v1`) **não é usada**: com este tipo de login ela responde sempre 429, pois o limite é do app do Spotify. Consultas usadas: `profileAttributes`, `fetchLibraryTracks`, `libraryV3`, `fetchPlaylist`, `getAlbum`, `queryArtistOverview`, `addToLibrary`/`removeFromLibrary`. Validado com uma conta real (login, curtidas, playlists, álbuns, artistas, Início, curtir e descurtir). **Sem histórico por faixa:** o endpoint antigo (`RecentlyPlayedService/Stream`) responde 404 e o `recents` do player web exige uma lista que só o navegador guarda; a Início mostra "Ouvido recentemente" (o que você abriu por último). Durante um 429 o app não chama o Spotify (o bloqueio fica salvo no arquivo da sessão). Pode quebrar quando o Spotify mudar o site.

**Last.fm:** a chave e o segredo da API vêm de last.fm/api/account/create (ou das variáveis de build `MM_LASTFM_KEY`/`MM_LASTFM_SECRET`).

## Playlists e biblioteca da conta

Comandos genéricos (`provider` = `youtube` ou `spotify`): `playlists_editable`, `playlist_add`, `playlist_remove`, `playlist_move`, `playlist_create`, `playlist_rename`, `playlist_delete`, `library_save` (álbum, playlist ou artista).

| Operação | YouTube Music | Spotify |
| --- | --- | --- |
| Listar playlists editáveis | da biblioteca: id `PL…` com o seu nome como dono | da biblioteca: `canEditItems` |
| Adicionar faixas | `browse/edit_playlist` (`ACTION_ADD_VIDEO`) | `addToPlaylist` (fim da playlist) |
| Remover faixas | `ACTION_REMOVE_VIDEO` (precisa do `setVideoId`) | `removeFromPlaylist` (precisa do `uid`) |
| Reordenar | `ACTION_MOVE_VIDEO_BEFORE` | `moveItemsInPlaylist` |
| Criar / renomear / excluir | `playlist/create`, `ACTION_SET_PLAYLIST_NAME`, `playlist/delete` | **não disponível** (o player web usa um protocolo próprio) |
| Salvar / remover da biblioteca | `like/like` e `like/removelike` (álbum: pelo id `OLAK5uy…` da playlist de áudio) | `addToLibrary` / `removeFromLibrary` |
| Seguir artista | `subscription/subscribe` e `unsubscribe` | `addToLibrary` / `removeFromLibrary` com o artista |

O id da faixa dentro da playlist (`setId` no `TrackInfo`) vem de `playlistItemData.playlistSetVideoId` (YouTube) e do `uid` do item (Spotify). Sem ele, a remoção o procura na própria playlist.

**Validado com contas reais** (cada operação feita e conferida lendo de volta, depois desfeita):
- *YouTube Music:* criar playlist (com a 1ª música), adicionar, mover (a ordem mudou), renomear, remover (sem informar o `setVideoId`: ele é procurado), aparecer em "editáveis", excluir, salvar e remover álbum, salvar e remover playlist de terceiros, seguir e deixar de seguir artista.
- *Spotify:* adicionar e remover faixa numa playlist sua, mover faixa, salvar e remover álbum, seguir e deixar de seguir artista, curtir e descurtir.

**Atraso de leitura:** o YouTube Music leva ~4 s para refletir salvar/seguir nas listas da biblioteca (a leitura logo depois mostra o estado antigo); por isso a interface recarrega a lista alguns segundos depois.

**Não existe no Spotify:** criar, renomear e excluir playlists, e salvar a playlist de outra pessoa (o `addToLibrary` só aceita álbum e artista; o resto usa o protocolo "rootlist" do player, que o MetroFuse também não usa). Histórico por faixa também não.

## Cache e pré-cache

- Cada faixa é um arquivo + um `.json` de metadados em `~/.cache/dev.caduhd4.metromusic/songs`. A chave é `fonte:id` da **fonte do áudio**.
- Passou do limite (`maxSongCache`), descarta o menos usado recentemente, nunca a faixa que toca, a próxima carregada ou a que está sendo lida.
- Pré-cache (`preload`, padrão 3 faixas): só o começo de cada uma (25 s / 17 s / 10 s pela distância, entre 512 KiB e 8/5/3 MiB), **uma por vez**, cancela o que saiu da janela, 3 tentativas com 15 s de intervalo.

## Motor de áudio

- Formatos: AAC/MP4 (inclusive fragmentado), MP3, FLAC, Vorbis, WAV, ALAC.
- A fonte é declarada *não-seekable* de propósito (o demuxer MP4 varreria o arquivo inteiro); a busca é própria (`seek_source`).
- Velocidade é *varispeed* (muda o tom junto).
- **Dois slots** de buffer: o da faixa que toca e o da próxima. Cada um tem seu decodificador e seu loudness.
- **Equalizador:** 10 bandas (31 Hz–16 kHz, Q 1,41, filtros *peaking* do Audio EQ Cookbook) + pré-amplificação, aplicados no callback (a mudança soa na hora).
- **Normalização:** ganho = alvo (−7/−11/−14/−19 LUFS) − loudness da faixa, limitado a −24…+6 dB e suavizado. Sem loudness do serviço, o motor mede enquanto decodifica (BS.1770: ponderação K, blocos de 400 ms, portas de −70 e −10 LU). Um limitador suave evita estalo com ganho positivo.
- **Gapless:** com a próxima carregada, o fim de uma faixa emenda na outra sem silêncio. **Crossfade:** potência constante, 1–12 s; não se aplica entre faixas do mesmo álbum se *Desativar em álbuns sem pausa* estiver ligado.

## Contrato com a interface

Comandos (`invoke`):

- Reprodução: `search_online`, `audio_play(track, start, autoplay, order)` → token, `audio_pause`, `audio_resume`, `audio_seek`, `audio_stop`, `audio_set_volume`, `audio_set_speed`, `audio_set_next(track, order, gaplessPair)`, `audio_advance`, `audio_set_eq(on, gains[10], preamp)`, `audio_set_normalization(on, target)`, `audio_set_crossfade(secs)`.
- Cache: `audio_precache`, `cache_stats`, `cache_clear`, `cache_configure`.
- YouTube Music: `yt_home`, `yt_page`, `yt_radio`, `yt_explore`, `yt_library`, `yt_rate`, `yt_mark_played`, `yt_login_start|cancel|cookie`, `yt_account`, `yt_logout`.
- SoundCloud: `sc_login_start|cancel|token`, `sc_account`, `sc_logout`, `sc_library`, `sc_playlist`, `sc_rate`.
- Spotify: `sp_status`, `sp_login_start|cancel|cookie`, `sp_account`, `sp_logout`, `sp_library`, `sp_page`, `sp_rate`.
- Outros: `other_home(provider)` (paradas do SoundCloud e do Deezer, Início do Spotify), `lyrics_get`, `lastfm_status|login|logout|now_playing|scrobble|love`.

Eventos (os de áudio carregam `token`; a interface ignora os de reproduções antigas):

- `audio:state {state: loading|buffering|playing|paused|error, message}`, `audio:loaded {key, source, codec, bitrate, duration}`, `audio:position {position, duration}` (4×/s), `audio:ended`, `audio:advanced {key, source, codec, bitrate, duration}` (o motor passou sozinho para a próxima).
- Contas: `yt:login`, `sc:login`, `sp:login` `{ok, cancelled, error, account}`.

Do lado da interface: `src/lib/engine.ts` (chamadas), `src/store/player.ts` (`initBackend`, eventos, pré-cache, `syncNext`), `src/lib/account.ts`, `soundcloud.ts`, `spotify.ts`, `lastfm.ts` (sessões e sincronização), `src/lib/catalog.ts` (`registerTrack`: faixas reais entram no mesmo catálogo das de demonstração e são persistidas).

## Testes

```bash
cd src-tauri
cargo test                                                # unitários (matcher, pré-cache, HLS, YouTube, equalizador, loudness, assinatura do Last.fm, Spotify…)
cargo test net_ -- --ignored --nocapture --test-threads=1 # falam com os serviços reais (alguns pedem MM_AUTH_DIR com uma sessão salva)
cargo test net_reproducao -- --ignored --nocapture        # ponta a ponta, com o dispositivo de áudio, em silêncio
cargo test net_transicao -- --ignored --nocapture         # gapless e crossfade de ponta a ponta
```

Fluxo pela interface, dentro do app nativo (volume 0; o resultado sai no log do Vite, linhas `[autotest]`):

```bash
MM_AUTOTEST=1 pnpm tauri dev
```

Build: o `src-tauri/target` passa de 10 GB; limpe com `cargo clean` ao terminar (a primeira compilação depois disso demora).

## Limitações conhecidas

- Last.fm e SoundCloud: o login e a sincronização dependem de uma conta real e ainda não foram validados de ponta a ponta. O Spotify foi validado, menos o histórico por faixa, que não tem fonte.
- Sem downloads offline nem biblioteca local (Baixadas, Arquivos locais, Enviadas).
- Tidal, Qobuz e JioSaavn não têm backend; Deezer não tem login.
- Criar, renomear e excluir playlists só existem no YouTube Music; no Spotify ficam de fora, assim como salvar a playlist de outra pessoa.
- Letras reais só de BetterLyrics e LrcLib; tradução, edição e busca manual de letra são simuladas.
- Podcasts, Ouvir junto, Reconhecer música, Discord Rich Presence e Cast continuam simulados. O assistente AutoEQ gera valores de exemplo e os perfis do equalizador não são salvos.
- O Recap em vídeo 9:16 do YouTube não tem API conhecida; a Retrospectiva monta os slides com os dados dos Recaps reais.
- A raspagem do `client_id` do SoundCloud, os clientes do InnerTube e o fluxo do Spotify podem quebrar quando os serviços mudarem; as constantes vêm do MetroFuse e precisam acompanhá-lo.
- O botão "próxima" recarrega a faixa em vez de usar a pré-carregada. Só testado no Linux.
