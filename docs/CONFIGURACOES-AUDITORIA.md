# Auditoria e andamento das Configurações

Roteiro para deixar **todas** as Configurações funcionando de verdade, com o ponto de partida no MetroFuse para cada item pendente.

- Referência: [MetroFusePlus, branch `fix/youtube-clients-and-preload`](https://github.com/caduHD4/MetroFusePlus/tree/fix/youtube-clients-and-preload) (commit `9ba9f5a6`). Caminhos abaixo relativos a `app/src/main/kotlin/com/metrolist/music/`.
- Telas de origem no MetroFuse: `ui/screens/settings/*.kt`. Chaves: `constants/PreferenceKeys.kt`.
- No MetroMusic: esquema em `src/lib/settingsSchema.ts`, telas e blocos em `src/pages/Settings.tsx`, estado em `src/store/settings.ts`.

Legenda: ✅ funciona e foi validado · 🟡 funciona com limite · 🔜 "Em breve" (aparece desativado, com selo) · ⛔ indisponível por decisão do projeto.

## Decisões tomadas

- **Áudio protegido (TIDAL, Qobuz, Deezer): ⛔ indisponível.** As três páginas mostram o aviso, têm os controles travados, aparecem com selo na lista de integrações e na ordem dos provedores, e saem da verificação de saúde. Para reativar mais tarde: remover `unavailable` da página em `settingsSchema.ts` e o provedor de `UNAVAILABLE_PROVIDERS`.
- **Idiomas da interface: só pt-BR e en**, com estrutura para acrescentar qualquer outro (ver "Como acrescentar um idioma").
- **Opções só do Android** (modo exclusivo, dispositivo de saída, ordem "Deezer primeiro") foram **removidas** do esquema.

## O que foi feito nesta rodada

| Etapa | Item | Como foi validado |
| --- | --- | --- |
| 1 | Itens sem implementação ganharam o selo **Em breve** e ficam desativados (lista em `NOT_IMPLEMENTED`); removidos os números inventados da barra de armazenamento, o aviso falso "0.2.0 disponível", a verificação de atualização falsa, os botões que só mostravam toast e o login de Discord | Playwright (páginas Discord, Armazenamento, Deezer, ordem dos provedores) |
| 2 | **Configurações em arquivo** (`settings.json`) e **segredos separados** (`secrets.json`, permissão `0600`: chave da IA e senha do proxy); migração do `localStorage` na primeira execução | `cargo test settings::` (5 testes: ida e volta, segredo fora do arquivo comum, permissão 0600, arquivo corrompido, gravação atômica) |
| — | **Idiomas pt-BR e en** em toda a tela de Configurações (menu, páginas, seções, itens, opções, avisos) | `node scripts/i18n-extract.mjs` (0 textos sem tradução) + Playwright trocando para en |
| 3 | `cropAlbumArt`, `artworkQuality` (reescreve o tamanho da URL da capa) | `scripts/tests/art.test.mjs` |
| 3 | `hideShorts` (heurística: música do YouTube de até 60 s) | tipagem; heurística documentada |
| 3 | `historyDuration`: a faixa só entra no histórico depois do tempo realmente ouvido | lógica em `initHistoryTracker` (tipagem; sem teste automatizado ainda) |
| 3 | `autoSkipOnError`, `stopOnProviderError`, `expConfirmSkip` (pular após falha, com limite de 5 seguidas) | tipagem |
| 3 | `noLoadMoreOnRepeat`, `shufflePlaylistFirst` (mistura a rádio no aleatório) | tipagem |
| 3 | Timer de sono: `sleepStopAfterSong` e `sleepFadeOut` (o volume cai no último minuto), **sono automático** (`sleepAuto/Repeat/Start`) e **alarmes** que de fato disparam | `scripts/tests/schedule.test.mjs` (dias da semana, próxima ocorrência, disparo uma vez por dia) |
| 3 | `contentLanguage` / `contentCountry` (`hl`/`gl` do InnerTube) e `useLoginForBrowse` | `cargo test prefs::` + **`net_conteudo_idioma_e_pais`** (Início real em pt-BR, en e es traz seções traduzidas e faixas com título e artista) |
| 4 | **Proxy** HTTP e SOCKS5, com usuário e senha (lido ao abrir o app; reiniciar para mudar) | `cargo test http::` (validação do endereço; requisição passa por um proxy local com `Proxy-Authorization` correto) |
| 4 | **Saúde dos provedores** real (latência medida, "alcançável" quando o serviço responde recusando) | `cargo test health::` + **`net_saude_dos_provedores`** (YouTube 204 ms, SoundCloud 375 ms, Deezer 366 ms, JioSaavn 1248 ms) |
| 5 | `audioQuality` no YouTube Music (low = 48 kbps HE-AAC, high/max = 129 kbps AAC, que é o que o serviço oferece) e `expKeepCacheOnQuality` | `cargo test youtube::` + **`net_qualidade_do_audio`** |
| 6 | **Backup e restauração** de verdade (playlists, curtidas, histórico, contagens, pastas, configurações; sem segredos nem sessões; valida versão e formato) | `scripts/tests/backup.test.mjs` (5) + ida e volta com as stores reais no Playwright |
| 8 | **Discord Rich Presence** por IPC local, sem login e com o ID do app MetroMusic embutido (`1569743605659074601`, público). Tocando: barra de progresso do Discord; **pausado: sem barra e com o texto "⏸ Pausado em 1:23 de 3:00"**; some do perfil após 10 min de pausa. Só reenvia quando algo muda (faixa, pausa/retomada, salto de posição), no máximo uma vez a cada 5 s (o Discord para de responder acima de ~5 por 20 s). Tempos vão em **segundos** (em ms o Discord recusa) | `cargo test discord::` (servidor falso) + `scripts/tests/discord.test.mjs` (6) + **teste real com o seu Discord**: tocando → pausado → limpo (`cargo test net_discord -- --ignored --nocapture`) |
| 9 | **Romanização**: japonês (kana), coreano, cirílico (ru, uk, be, ky, sr, bg, mk), hindi, punjabi; "como texto principal" e "linha a linha" | `scripts/tests/romanize.test.mjs` (6) |
| 9 | **Tradução por IA** (OpenRouter, OpenAI, Perplexity, xAI, Mistral, personalizado, Claude, Gemini, DeepL; modos tradução/transcrição; prompt próprio; blocos de 60 linhas) | `cargo test ai::` (9 testes, incluindo servidor local de ponta a ponta e erros HTTP) |
| 8 | **Qualidade do SoundCloud** (`soundcloudQuality`: MP3 128, AAC 96, AAC 160; cai na taxa mais próxima se a faixa não tiver a pedida) | `cargo test soundcloud::` (escolha do transcoding) + `prefs::` |
| 8 | **Letras do KuGou** (provedor `kugou`, API pública; descarta as linhas de crédito do começo) | `cargo test lyrics::` + **`net_letras`** (Blinding Lights: 45 linhas sincronizadas) |
| 8 | **Curtidas do Spotify** (`spotifyLikes`, liga e desliga a sincronização; antes dependia de `ytSync`) | tipagem; a escrita real já havia sido validada com conta (commit 0eef703) |
| 9 | **Romanização do chinês** (hanzi → pinyin com tons, `pinyin-pro` carregado só quando o chinês está ligado; kanji em letra japonesa não são tocados) | `scripts/tests/romanize.test.mjs` (7) |
| 9 | `expProviderTimeout` (20 s por tentativa, ligado por padrão) e `expDiagnostics` (registra ordem, formato, taxa e tempo no log) | `cargo test providers::tests` (limite de tempo) |
| 9 | `lyricsHighRefresh`: desligado limita a animação da letra a 60 quadros/s; ligado segue a taxa da tela | tipagem |
| 10 | **Manter a tela ligada** (`keepAwake`): só com o Tocando agora aberto e a música tocando; inibidor do logind/Windows/macOS (`keepawake`) | **`net_inibidor_aparece_no_sistema`** (aparece em `systemd-inhibit --list` e some ao desligar) |
| 10 | **Abrir links** (`openLinks`): cole um link do YouTube Music/YouTube ou do Spotify na busca: abre playlist, álbum ou artista; faixa do YouTube toca com o rádio dela | `scripts/tests/links.test.mjs` (4) + **`net_radio_comeca_pela_faixa_do_link`** |
| 10 | **Atualizações** (`autoUpdateCheck`, `updateNotifications`, `updateChannel`, botão): consulta as Releases do GitHub (estável ou beta, semver), avisa e abre a página da versão | `cargo test update::` (7, inclui comparação `beta.2 < beta.10`) + **`net_releases_do_github`** |
| 10 | **Idioma do app**: barra lateral, topo, player, menus, avisos, botões e estados vazios trocam ao vivo (pt-BR/en) | Playwright em `en` |
| — | **Escolher fonte de áudio** (menu da faixa): lista só os resultados válidos de cada fonte (título, artista, duração, tempo da busca), pelo mesmo matcher da reprodução; escolher troca a fonte na hora, na posição atual, e vale também para a fila e o pré-carregamento. Antes eram números fixos e a escolha não fazia nada | `cargo test matcher::` (ranking só com válidos) + **`net_fontes_de_audio_da_mesma_musica`** + Playwright (lista e troca) |
| 6 | **Downloads reais** (`downloadFolder`, `writeTags`, `embedLyrics`, `autoDownloadOnLike`, apagar um ou todos): baixa a faixa inteira pelo mesmo cache de áudio, salva como `Artista - Título.ext` na pasta escolhida (nunca sobrescreve: `(2)`), grava título, artistas, álbum, capa e letra (LRC quando sincronizada). Música baixada passa a tocar do arquivo, sem internet. Ao abrir, some da lista o que foi apagado por fora. Apagar só mexe em áudio dentro da pasta de downloads | `cargo test downloads::` (8, servidor local) + **`net_download_real_com_tags_e_letra`** (YouTube Music: `.m4a` de 3,1 MB com tags, capa e 37 linhas de letra sincronizada, lido de volta) |
| 6 | **Cache de imagens** (`maxImageCache`, limpar): as capas são guardadas em disco com limite de tamanho (descarta as mais antigas); a primeira vez mostra a da rede, as seguintes vêm do disco. Armazenamento mostra o uso real | `cargo test images::` (3: reaproveita, recusa o que não é imagem, limite) |
| 6 | **Importar M3U e CSV** e **importar por link** (playlist/álbum do YouTube Music ou Spotify): lê os arquivos, procura cada música nos provedores com o critério da reprodução e mostra o que não achou (fica de fora, sem palpite). M3U com caminhos locais usa os arquivos | `scripts/tests/importers.test.mjs` (3) + `cargo test importer::` (2) + **`net_importacao_acha_as_musicas`** + Playwright (fluxo M3U) |
| 6 | **Transferência de tempo**: passa a contagem e o histórico de uma música para outra | Playwright (contagem e histórico) |
| 7 | **Biblioteca local** (`folders`, `scanLocal`, `minDuration`, `watchFolders`, `scanOnStart`, `readEmbeddedLyrics`, `preferEmbeddedArt`): seletor de pastas, varredura recursiva com tags (lofty), capa embutida ou da pasta (`cover.jpg`…), letra do `.lrc` ao lado ou da tag, vigia de mudanças, índice em disco (aparece na hora ao abrir), toca os arquivos pelo motor. Conta o que foi pulado (Opus/AIFF/WMA, curtos, ilegíveis) | `cargo test local::` (9, arquivos WAV gerados com tags e capa; inclui o vigia de pastas com arquivos criados e apagados de verdade) + Playwright (varredura e faixas registradas) |
| 8 | **Ouvir junto** (`ltServer`, `ltCustomServer`, `ltUsername`, `ltAutoJoin`, `ltAutoSuggest`, `ltSyncVolume`): cliente real do servidor do MetroFuse/Metrolist (protobuf sobre WebSocket, com gzip). Criar/entrar na sala, aprovar ou recusar pedidos, anfitrião transmite faixa/play/pause/seek/fila/volume, convidados seguem e carregam antes do play, sugestões, transferir anfitrião, remover, bloquear e reconexão com o token da sessão. Só faixas do YouTube Music entram na sala (o servidor compartilha ids do YouTube) | `scripts/tests/lt-protocol.test.mjs` (6) + **`pnpm test:net`** contra o servidor real (13 passos, dois clientes) + Playwright com um cliente de verdade do outro lado, nos dois sentidos (convidado e anfitrião) |
| 8 | **Spotify**: letra (provedor `spotify`, `color-lyrics`), busca (`searchDesktop`), Canvas (`canvaz`, protobuf) e o vídeo sobre a capa (`animatedCovers`, `spotifyCanvas`) e no fundo (`expCoverFade`). Faixas de outros serviços são casadas com a do Spotify pelo critério da reprodução | `cargo test spotify::` (letra, protobuf do Canvas e busca em formatos de resposta) + Playwright (vídeo na capa e no fundo, e desligado). **A resposta real do Spotify ainda não foi conferida com a sua sessão** |
| 9 | **Experimentos visuais**: "Letras MetroMusic" (desligado = letra clássica), "Linha de letra suave" (3 linhas, brilho que cresce), galáxia adaptativa e espelhada (cores e brilho lidos da capa), dissolver a capa animada no fundo | `scripts/tests/coverTone.test.mjs` (4) + Playwright (opacidade 0,6 → 0,77 conforme a capa; camadas espelhada e de cor ligam e desligam) |
| 9 | **Bitrate ao vivo** (`liveBitrate`): o motor mede o que lê do arquivo e o rótulo de FLAC/MP3/Vorbis acompanha | `cargo test audio::` (janela de 1 s) + `scripts/tests/liveBitrate.test.mjs` (4). Corrigido junto: o Discord mostrava "129000 kbps" (bits/s) nos detalhes de reprodução |
| 10 | **Atualização automática** (plugin oficial do Tauri, pacotes assinados, GitHub Releases, `main` = canal estável): aviso com o changelog da release, "Atualizar" baixa, troca os arquivos e reinicia, sem assistente de instalação; pular versão; verificar manualmente | `scripts/tests/releaseNotes.test.mjs` (4) + Playwright (aviso e progresso). **`net_assinatura_da_release`**: a release v0.1.0 publicada traz `latest.json` com notas e assinaturas que conferem com a chave do app (e um arquivo adulterado é recusado); o AppImage da release abre no Linux. O passo final (instalar a 0.1.0 e atualizar para uma 0.1.1) só dá para conferir quando a próxima versão for publicada |
| — | **Boas-vindas no primeiro uso**: mostra como conectar YouTube Music, Spotify e Discord; some depois de fechada ou se já houver conta conectada | Playwright (aparece, "Entrar" abre o login e fechar volta para ela, "Pular" não reaparece) |
| — | **Compartilhar**: link real de cada serviço (nada de domínio inventado), link universal (song.link), copiar, WhatsApp, Telegram, e-mail, código QR e sala do Ouvir junto; arquivo local e playlist sua explicam que não há link (a playlist vira lista de texto) | `scripts/tests/shareLinks.test.mjs` (5) + `cargo test links::` + Playwright |
| — | **Capa grande do Tocando agora** busca a miniatura de até 1280×720 do YouTube (cai para 640×480 e 480×360 quando o vídeo não tem a maior; o placeholder cinza de 120×90 é rejeitado). As capas pequenas ficam como antes | `scripts/tests/art.test.mjs` (6) + Playwright com um vídeo que tem e outro que não tem a versão grande |
| — | **Cursor de mãozinha** em tudo o que é clicável (botões ativos, links, controles, sliders); texto e botões desativados mantêm a seta | Playwright (37 de 37 botões ativos) |

Suítes: `pnpm test` roda `node --test scripts/tests/*.test.mjs` (59 testes) e `cargo test` (89 testes). Testes de rede ficam em `cargo test net_ -- --ignored`.

**Pendente de validação com algo que só você tem:**
- **Tradução por IA:** falta uma chave de API; a lógica está validada contra servidores falsos, mas não contra um provedor real.
- **Tudo no app nativo:** as telas foram verificadas no navegador (com o Tauri simulado). O fluxo completo no app nativo (`pnpm tauri dev`) ainda não foi exercitado nesta rodada.

## Como acrescentar um idioma

1. Crie `src/i18n/locales/<código>.json` (ex.: `es.json`), com `{"Aparência": "Apariencia", …}`: a chave é o texto em pt-BR.
2. Registre em `src/i18n/index.ts` (`LOCALES`) e em `APP_LANGS` (`src/lib/settingsSchema.ts`).
3. `node scripts/i18n-extract.mjs --write` cria no arquivo as chaves que faltam (vazias); `node scripts/i18n-add.mjs <código>` aceita pares `pt ⇒ tradução` pela entrada padrão. Texto sem tradução cai no pt-BR.

**Limite atual:** o `t()` cobre a tela de Configurações (inclusive o menu lateral). O resto da interface (barra lateral, player, diálogos, Início…) ainda tem texto fixo em pt-BR; é o próximo passo do idioma do app (`appLanguage` já resolve o idioma efetivo, inclusive "Padrão do sistema").

## O que continua pendente (🔜), por etapa do plano

**Etapa 5, áudio**
- `skipSilence`, `skipSilenceInstant`: `playback/audio/SilenceDetectorAudioProcessor.kt` (162 linhas): limiar de amplitude e duração mínima; no `audio.rs`, detectar no callback e avançar a leitura.
- `automix`, `automixStyle`, `automixBars`: `playback/audio/AutomixAnalyzerAudioProcessor.kt` (498), `utils/mix/{AutomixIntroSniffer,CamelotMixing,MixMetadataResolver,TrackStructureLearner}.kt` (BPM, tom Camelot, estrutura).
- `liveBitrate`: `playback/LiveFlacBitrateDataSource.kt`; o motor já informa o bitrate ao carregar, falta atualizar durante a faixa.
- Equalizador: perfis não são salvos e o AutoEQ gera valores de exemplo (`eq/EqualizerService.kt`, `eq/data/EQProfileRepository.kt`).

**Etapas 6 e 7**: feitas (ver a tabela acima). O que sobra delas:
- `downloadQuality` segue "Em breve": os downloads usam a mesma qualidade da reprodução ("Qualidade do áudio"); no YouTube Music "alta" e "máxima" são o mesmo AAC.
- Arquivos **Opus, AIFF e WMA** não tocam (o decodificador não os lê); a varredura os conta e avisa.
- Downloads de faixas do SoundCloud em HLS gravam o áudio, mas as tags podem não caber no formato fragmentado (o app avisa no log e mantém o arquivo).

**O que ainda está "Em breve"** (aparece desativado, com selo)
- **Spotify**: `spotifyHistory` e `spotifyHistoryGlobal` (gravariam reproduções na sua conta pelo canal de telemetria do Spotify: foi decisão deixar de fora por mexer no histórico e nas recomendações da conta); `canvasDownload` e `canvasPriority` (dependem da arte animada da Apple).
- **Apple Music**: `artistMotion` e a arte animada da Apple (precisam de um token extraído do site, frágil).
- **JioSaavn**: `jioQuality` e `jioLanguage`. A busca e o início funcionam no backend, mas a CDN responde 403 ao baixar o áudio (ver `providers/jiosaavn.rs`), então o provedor não está ligado à reprodução.
- **Áudio**: `skipSilence`, `skipSilenceInstant`, `automix*`; `downloadQuality` (os downloads usam a mesma qualidade da reprodução).
- **Discord**: `discordStatus`, `discordPreferSpotify`, `discordCanvas*` (o Rich Presence local não controla o status da conta nem mostra vídeo).
- **Opus, AIFF e WMA** não tocam (o decodificador não os lê).
- **Provedores de letra sem backend**: Apple Music, Musixmatch, Deezer, QQ Music, BiniLyrics e LyricsPlus (testados: Cloudflare, espelhos fora do ar, tokens).
- **Kanji** em letra japonesa não é convertido (só kana).
- **Idioma do app**: os textos escritos dentro de cada tela (saudação do Início, diálogos, Biblioteca, Conta, Estatísticas…) ainda estão só em português; basta passar cada texto por `tr("…")` e acrescentar o par em `en.json` (em desenvolvimento, `window.__i18nMiss` lista o que falta).
- **Spotify ao vivo**: letra, busca e Canvas foram escritos e testados com respostas de exemplo; falta conferir a resposta real com a sua sessão.

## Limites conhecidos do que foi feito

- **Proxy:** vale após reiniciar o app (o cliente HTTP é criado uma vez). Só afeta as chamadas feitas pelo Rust; imagens de capa carregadas direto pelo webview não passam por ele.
- **`hideShorts`:** o YouTube Music não marca Shorts; usa-se a duração (≤ 60 s) em faixas do YouTube, o que pode esconder uma música muito curta.
- **`contentLanguage`:** muda as respostas do YouTube Music (títulos de seções, por exemplo). Padrão agora é "Padrão do sistema" (antes era sempre inglês).
- **Romanização:** coreano sem assimilação entre sílabas (`좋아` → `jota`, não `joa`); japonês sem leitura de kanji; partículas は/へ saem como `ha`/`he`.
- **Alarme e sono automático:** só disparam com o app aberto (a bandeja mantém a janela viva); não acordam o computador.
- **Falhas seguidas:** com "pular em caso de erro" ligado, o app pula até 5 faixas seguidas que falham e então para.
