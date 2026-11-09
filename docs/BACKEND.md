# Backend de áudio

Rust (`src-tauri/src`). Porta a lógica de reprodução do MetroFuse e a valida contra os serviços reais.

## Fluxo de uma reprodução

```
interface ──audio_play(track)──▶ Player.play
                                   │ 1. providers::resolve   → StreamInfo (URL + cabeçalhos, ou lista de segmentos HLS)
                                   │ 2. cache.entry_for + fetch → baixa em segundo plano para um arquivo que cresce
                                   │ 3. espera ~48 KiB → engine.load(abridor de leitor)
                                   ▼
                       thread de decodificação (Symphonia) lê o arquivo EM CRESCIMENTO
                                   ▼  reamostra (cúbica) → buffer de ~1,5 s
                       callback do cpal consome o buffer ──▶ saída de áudio
eventos audio:* (loading, buffering, loaded, playing, paused, position, ended, error) ◀── todas as janelas
```

## Módulos

| Arquivo | Papel | Origem no MetroFuse |
| --- | --- | --- |
| `providers/youtube.rs` | Busca no YouTube Music e resolução do stream via InnerTube | `YouTubeAudioProvider`, `InnerTube`, `YouTubeClient` |
| `providers/soundcloud.rs` | `client_id` raspado do site, busca, HLS (AAC em MP4 fragmentado) | `SoundCloudAudioProvider` |
| `providers/deezer.rs` | API pública: busca, metadados, trecho de 30 s | `DeezerAudioProvider` (só a parte pública) |
| `providers/matcher.rs` | Decide se um resultado é a mesma música | `ProviderFallbackMatcher` |
| `providers/mod.rs` | Escolhe o provedor de cada faixa; busca paralela de correspondência (8 s, cache de 90 s) | `ProviderMatchSearch` |
| `cache.rs` | Cache em disco: download por `Range` ou por segmentos, leitura durante o download, retomada, LRU | `PlaybackCacheIndex` + cache do Media3 |
| `preload.rs` | Pré-cache das próximas faixas | `NextTrackPreloadCoordinator` |
| `audio.rs` | Decodificação, reamostragem, saída, busca, pausa sem estalo | (Media3/ExoPlayer no Android) |
| `playback.rs` | Une resolver → cache → motor | |
| `lyrics.rs` | Letras: LrcLib (LRC, 5 estratégias de busca) e BetterLyrics (TTML com tempo por palavra e vozes de apoio) | `LrcLib`, `BetterLyrics`, `TTMLParser` |
| `commands.rs` | Comandos expostos à interface | |

### YouTube Music
Só entram clientes que devolvem URL direta **sem PO token**: visionOS, iPadOS, Android VR (1.65 e 1.43) e Android Music, disparados em paralelo (vale o primeiro). A CDN exige o `User-Agent` do cliente que gerou a URL, então ele viaja em `StreamInfo.headers`. Prefere AAC (m4a) de 128–256 kbps e descarta formatos de prévia. Não há decifragem de assinatura nem BotGuard.

### Deezer
A API pública dá busca, metadados e o trecho de 30 s. **O áudio completo é protegido e não é obtido aqui.** O MetroFuse o obtém por resolvedores de terceiros e/ou pela descriptografia local (Blowfish `BF_CBC_STRIPE`); isso **não foi portado** de propósito, porque contorna a proteção de conteúdo do serviço. Para tocar uma faixa do Deezer por inteiro, o app procura a mesma música no YouTube Music e no SoundCloud (a ordem vem de *Configurações › Ordem dos provedores*); sem correspondência, toca o trecho de 30 s.

### Cache e pré-cache
- Cada faixa é um arquivo + um `.json` de metadados em `~/.cache/dev.caduhd4.metromusic/songs`. A chave é `fonte:id` da **fonte do áudio** (uma faixa do Deezer tocada via YouTube compartilha o arquivo do YouTube).
- Passou do limite (`maxSongCache`), descarta o menos usado recentemente, nunca o que está tocando ou sendo lido.
- Pré-cache (`preload`, padrão 3 faixas): só o começo de cada uma (25 s / 17 s / 10 s pela distância na fila, entre 512 KiB e 8/5/3 MiB), **uma por vez**, cancela o que saiu da janela, 3 tentativas com 15 s de intervalo. Ao passar a tocar, o download continua de onde parou.

### Motor de áudio
- Formatos: AAC/MP4 (inclusive fragmentado), MP3, FLAC, Vorbis, WAV, ALAC. **Opus não** (o Symphonia não o decodifica).
- O fonte é declarado *não-seekable* de propósito: o demuxer MP4 exige o tamanho total e varre o arquivo inteiro quando é seekable, o que obrigaria a esperar o download completo. A busca é própria (`seek_source`): reabre o arquivo em cache, pula pacotes sem decodificar e começa um pacote antes para aquecer o decodificador.
- Velocidade é *varispeed* (muda o tom junto).

## Contrato com a interface

Comandos (`invoke`): `search_online(provider, query, limit)`, `audio_play(track, start, autoplay, order)` → token, `audio_pause`, `audio_resume`, `audio_seek(seconds)`, `audio_stop`, `audio_set_volume`, `audio_set_speed`, `audio_precache(tracks, count, order)`, `cache_stats`, `cache_clear`, `cache_configure(limitMb, enabled)`.

Eventos (todos carregam `token`; a interface ignora os de reproduções antigas): `audio:state {state: loading|buffering|playing|paused|error, message}`, `audio:loaded {key, source, codec, bitrate, duration}`, `audio:position {position, duration}` (4×/s), `audio:ended`.

Do lado da interface: `src/lib/engine.ts` (chamadas), `src/store/player.ts` (`initBackend`, eventos, pré-cache), `src/lib/catalog.ts` (`registerTrack`: faixas reais entram no mesmo catálogo das de demonstração e são persistidas).

## Testes

```bash
cd src-tauri
cargo test                                                # unitários (matcher, política de pré-cache, HLS, YouTube)
cargo test net_ -- --ignored --nocapture --test-threads=1 # falam com os serviços reais
cargo test net_reproducao -- --ignored --nocapture        # ponta a ponta, com o dispositivo de áudio, em silêncio
```

Fluxo pela interface, dentro do app nativo (volume 0; o resultado sai no log do Vite, linhas `[autotest]`):

```bash
MM_AUTOTEST=1 pnpm tauri dev
```

## Limitações conhecidas
- Sem gapless, crossfade, normalização nem equalizador no motor (as telas existem, o áudio ainda não as aplica).
- Sem login nas contas: só catálogo público.
- Tidal, Qobuz, JioSaavn e Spotify não têm backend.
- A raspagem do `client_id` do SoundCloud e os clientes do InnerTube podem quebrar quando os serviços mudarem; as constantes vêm do MetroFuse e precisam acompanhá-lo.
- Letras reais só de BetterLyrics e LrcLib; os outros provedores da lista (Apple, Musixmatch, QQ, KuGou…) não foram portados. Letras de faixas de demonstração continuam simuladas; tradução, edição e busca manual ainda são simuladas.
- Contas e histórico ainda são simulados.
