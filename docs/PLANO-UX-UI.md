# MetroMusic — Plano de UX/UI

Player de música desktop (Linux, macOS, Windows), offline e online, em Rust + Tauri.
Referência funcional: [MetroFusePlus](https://github.com/caduHD4/MetroFusePlus/tree/fix/youtube-clients-and-preload) (Android, Compose/Material 3).

Este documento cobre a fase atual: **interface completa e navegável com dados simulados**. Nada toca áudio de verdade ainda; o estado de reprodução é um simulador no frontend que o backend Rust vai substituir.

---

## 1. Princípios

1. **Desktop de verdade, não um celular esticado.** O MetroFuse empilha tudo em telas cheias e bottom sheets. No desktop há espaço: navegação, conteúdo, fila/letra e player ficam visíveis ao mesmo tempo.
2. **A música toca sempre à vista.** A barra do player nunca some; fila e letra abrem ao lado sem tirar o usuário de onde está.
3. **Conforto visual.** Fundo escuro neutro levemente tingido (nunca preto puro por padrão), texto em branco suavizado, um único acento de cor, contraste AA no texto.
4. **Movimento com função.** Animação explica de onde veio e para onde vai cada coisa (capa que cresce até o player expandido, painel que desliza). Curtas (120–320 ms), com mola suave, e desligáveis.
5. **Mouse e teclado em pé de igualdade.** Clique direito abre menu de contexto em qualquer item; tudo que importa tem atalho; `Ctrl+K` alcança qualquer tela ou ação.
6. **Nada fica sem estado.** Vazio, carregando (esqueleto), erro e offline têm desenho próprio.

## 2. Estrutura da janela

```
┌──────────────┬────────────────────────────────────────────┬──────────────────┐
│              │ ← →   [ Buscar… Ctrl+K ]   Fonte ▾  ⏱ 📈 👥 ◉ │                  │
│  Barra       ├────────────────────────────────────────────┤  Painel lateral  │
│  lateral     │                                            │  (alternável)    │
│              │            Conteúdo da rota                │                  │
│  Navegação   │            (rola de forma independente)    │  Fila · Letra ·  │
│  Fixados     │                                            │  Detalhes        │
│  Playlists   │                                            │                  │
├──────────────┴────────────────────────────────────────────┴──────────────────┤
│  Capa  Título/Artista  ♥ │  ⇄ ⏮  ▶  ⏭ ↻  ──●────── │ Qualidade  Letra Fila 🔊 ⤢ │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Região | Papel | Comportamento |
| --- | --- | --- |
| Barra lateral (248 px, recolhe para 72 px) | Início, Explorar, Biblioteca, Ouvir junto, Reconhecer; playlists automáticas; playlists do usuário | Recolhe com `Ctrl+B`. Playlists aceitam soltar músicas arrastadas. Clique direito abre o menu da playlist. |
| Barra superior | Voltar/avançar, busca, seletor de fonte da Início, Histórico, Estatísticas, conta | Busca abre sugestões e histórico; `Enter` vai para resultados. |
| Conteúdo | A rota atual | Transição de entrada curta; posição de rolagem lembrada por rota ao voltar. |
| Painel lateral (360 px) | Fila, Letra, Detalhes da faixa | Abre/fecha pelos botões do player; abas no topo. |
| Barra do player (88 px) | Controle permanente | Clique na capa abre o **Tocando agora** em tela cheia. |

**Tocando agora** (tela cheia, `F` ou clique na capa): fundo derivado da capa (desfoque em movimento, gradiente, sólido ou "galáxia"), capa grande à esquerda, letra sincronizada à direita, controles embaixo. Modo "só letra" para karaokê.

**Larguras:** abaixo de 1100 px o painel lateral vira sobreposição; abaixo de 1060 px a barra lateral recolhe sozinha. Mínimo da janela: 920 × 600.

## 3. Mapa de telas (MetroFuse → MetroMusic)

| MetroFuse (Android) | MetroMusic (desktop) | Rota |
| --- | --- | --- |
| Home + seletor de fonte (YouTube Music, TIDAL, Spotify, SoundCloud, Deezer, JioSaavn, Offline) | Início com seletor de fonte na barra superior | `home` |
| Chips de clima, Speed dial, Quick picks, Keep listening, Daily discover, Mixes, Forgotten favorites, Similar to, Community, playlists da conta, podcasts, cartão Wrapped | Mesmas seções, em prateleiras horizontais e grades | `home` |
| Explore, Charts, New releases, Mood & genres, Browse | Explorar com abas + página do gênero | `explore`, `browse/:id` |
| Search (local e online, filtros, sugestões, histórico) | Busca com filtros em chips e alternância Online/Biblioteca | `search/:q` |
| Library (Mix, Playlists, Songs, Albums, Artists, Podcasts; filtros Library/Liked/Downloaded/Uploaded; ordenação; grade/lista) | Biblioteca com as mesmas abas, filtros e ordenações | `library/:tab` |
| Local / Online / Auto / Cache / Top playlist | Uma tela de coleção com variações | `playlist/:id` |
| Album | Coleção em modo álbum (com "Outras versões") | `album/:id` |
| Artist (+ songs, albums, items) | Artista com cabeçalho imersivo, populares, discografia, sobre, semelhantes | `artist/:id` |
| Podcast online, episódios | Coleção em modo podcast | `podcast/:id` |
| History (local/remoto), Spotify listening history | Histórico agrupado por dia | `history` |
| Stats | Estatísticas com período, top músicas/artistas/álbuns | `stats` |
| Wrapped | Retrospectiva em páginas (stories) | `wrapped` |
| Listen Together (+ settings, logs, bloqueados) | Ouvir junto | `together` |
| Recognition (+ history) | Reconhecer música | `recognize` |
| Equalizer + AutoEQ wizard | Equalizador com curva, bandas e assistente | `equalizer` |
| Account, Login | Conta | `account` |
| Settings (todas as subpáginas) | Configurações em duas colunas (categorias + conteúdo) com busca | `settings/:page` |
| Player, MiniPlayer, Queue, Lyrics, PlayerMenu | Barra do player, Tocando agora, painel Fila/Letra/Detalhes | — |
| Bottom sheets de menu (música, álbum, artista, playlist, seleção) | Menus de contexto (clique direito e botão ⋯) e barra de seleção múltipla | — |
| Diálogos (criar/editar playlist, adicionar à playlist, duplicadas, importar M3U/CSV + mapeamento de colunas, exportar, compartilhar, detalhes, editar música, timer de sono, tempo e tom, fonte de áudio, letra: buscar/editar/offset/tradução por IA/compartilhar como imagem, transferência de tempo, erro de reprodução, atualização disponível) | Diálogos modais equivalentes | — |

**Só Android, substituído no desktop:**

| Android | Equivalente desktop |
| --- | --- |
| Widgets, Quick Settings tile | Mini-player (janela compacta sempre no topo), ícone na bandeja |
| Android Auto | — (fora do escopo) |
| Live wallpaper | — |
| Permissão de mídia / scan do MediaStore | Pastas de música monitoradas (Configurações › Biblioteca local) |
| Offload de áudio, bateria, Bluetooth resume | Dispositivo de saída, modo exclusivo, teclas de mídia, MPRIS/SMTC |
| Gestos de swipe | Clique direito, arrastar e soltar, atalhos |
| Google Cast | Mantido como "Transmitir para dispositivo" (mock) |

## 4. Configurações (paridade completa)

Organizadas como no MetroFuse, com as opções só-Android trocadas pelas de desktop.

- **Interface**
  - *Aparência*: modo (claro/escuro/sistema), preto puro, paleta (Dinâmica + 19 cores), fundo do app (tema/galáxia), densidade, aba inicial, tamanho da grade, abas visíveis, capas imersivas, cortar capas, qualidade das capas; player: novo design, fundo (sólido/gradiente/desfoque/desfoque em movimento/galáxia), cor dos botões, estilo do slider (padrão/ondulado/squiggly), alinhamento do texto, esconder capa, rótulo de qualidade, bitrate ao vivo; letra: posição, tamanho, espaçamento, animação palavra a palavra (nenhuma/fade/glow/slide/karaokê/Apple), brilho, letra sob a capa, rolagem automática, trocar ao clicar; reduzir animações.
  - *Desktop* (novo): fechar para a bandeja, iniciar minimizado, mini-player sempre no topo, teclas de mídia, atalhos globais, notificação ao trocar de faixa.
  - *Experimentos*.
- **Player e conteúdo**
  - *Player e áudio*: qualidade, dispositivo de saída, normalização + nível de loudness, pular silêncio (e instantâneo), crossfade (duração, gapless), Automix (estilo, compassos), velocidade/varispeed, fila persistente, carregar mais, conteúdo semelhante, autoplay, embaralhar playlist primeiro, embaralhamento persistente, lembrar shuffle/repeat, evitar duplicadas na fila, pular em erro, parar em erro do provedor, pré-carregar próximas, busca progressiva, timer de sono automático, alarme.
  - *Ordem dos provedores* (arrastar, ligar/desligar) e *Saúde dos provedores* (status e latência).
  - *Conteúdo*: idioma do app, idioma/país do conteúdo, esconder explícito/vídeos/Shorts, tamanho do Meu Top, duração do histórico, quick picks, ordem aleatória da Início, cartão Wrapped, playlists automáticas visíveis, página do artista, proxy, provedores de letra (seleção e prioridade arrastável), romanização.
  - *Tradução de letras por IA*: provedor, URL, chave, modelo, modo, idioma, prompt.
  - *Biblioteca local* (novo): pastas, varredura, formatos.
- **Integrações**: Discord (Rich Presence com prévia), Last.fm, Spotify (Canvas, histórico, curtidas), TIDAL, Qobuz, Deezer, SoundCloud, JioSaavn, Ouvir junto.
- **Privacidade**: pausar/limpar histórico de escuta e de busca, usar login para navegar.
- **Armazenamento e dados**: downloads (pasta, baixar ao curtir, embutir canvas), cache de músicas e imagens (limites, limpar), backup e restauração.
- **Sistema**: atualizações, novidades, sobre.

## 5. Sistema visual

**Cor.** Tudo sai de uma matiz (`--h`) em OKLCH: superfícies ganham um tingimento quase imperceptível dessa matiz e o acento usa a mesma matiz com croma alto. Trocar a paleta, ou ativar o tema **Dinâmico** (matiz da capa atual), recolore o app inteiro com uma transição suave.

| Token | Escuro | Claro | Uso |
| --- | --- | --- | --- |
| `bg` | L 15% | L 97% | fundo da janela |
| `s1` / `s2` / `s3` | L 18 / 22 / 27% | L 100 / 94 / 90% | cartões, hover, pressionado |
| `line` | branco 8% | preto 9% | divisórias finas |
| `t1` / `t2` / `t3` | L 95 / 74 / 56% | L 20 / 42 / 56% | texto primário / secundário / apoio |
| `accent` | L 78% C 0.13 | L 52% C 0.17 | ação primária, estado ativo, progresso |

Preto puro (OLED) zera a luminosidade do `bg`.

**Tipografia.** Geist Variable (embutida, funciona offline). Escala: 12 · 13 · 14 (base) · 16 · 20 · 28 · 44/64 (títulos imersivos). Números tabulares em durações e contadores.

**Forma.** Raios 8 (controles), 12 (cartões), 16 (painéis), círculo (artistas, botões de ícone). Espaçamento em múltiplos de 4. Capas quadradas; artistas redondos.

**Movimento.**

| Situação | Animação | Duração |
| --- | --- | --- |
| Troca de rota | fade + subida de 8 px | 220 ms |
| Abrir Tocando agora | sobe do rodapé, capa cresce | mola (~350 ms) |
| Painel lateral | desliza e o conteúdo se reacomoda | mola |
| Hover em cartão | capa sobe 2 px, botão de tocar aparece | 150 ms |
| Trocar de faixa | capa e textos em crossfade | 250 ms |
| Letra | linha ativa cresce e clareia; palavra a palavra preenche | contínuo |
| Tocando | equalizador animado na linha ativa | contínuo |
| Menus, diálogos, toasts | escala 0.96→1 + fade | 140 ms |

"Reduzir animações" (e `prefers-reduced-motion`) corta tudo para fades instantâneos.

**Capas simuladas.** Como não há catálogo real, cada álbum/artista/playlist recebe uma arte generativa determinística (gradientes a partir de uma semente). O componente `Cover` já aceita `src`, então o backend só precisa entregar a URL.

## 6. Interações

- **Clique** numa faixa: seleciona. **Duplo clique** / `Enter`: toca. Botão ▶ no hover: toca.
- **Clique direito** ou **⋯**: menu de contexto (tocar a seguir, adicionar à fila, iniciar rádio, adicionar à playlist ▸, curtir, baixar, fixar no acesso rápido, ir para artista/álbum, compartilhar, escolher fonte de áudio, editar, detalhes, remover…). Menus equivalentes para álbum, artista, playlist e item da fila.
- **Seleção múltipla**: `Ctrl`/`Shift` + clique; barra flutuante com tocar, embaralhar, a seguir, fila, playlist, curtir, baixar, remover.
- **Arrastar e soltar**: faixas para playlists da barra lateral; reordenar a fila e playlists locais (ordem personalizada).
- **Atalhos**: `Espaço` tocar/pausar · `Ctrl+→/←` próxima/anterior · `→/←` ±5 s · `↑/↓` volume · `M` mudo · `L` curtir · `S` embaralhar · `R` repetir · `F` Tocando agora · `Q` fila · `Y` letra · `Ctrl+K` paleta de comandos · `Ctrl+F` busca · `Ctrl+B` barra lateral · `Ctrl+,` configurações · `Alt+←/→` voltar/avançar · `Esc` fecha o que estiver aberto · `?` lista de atalhos.
- **Feedback**: toasts com "Desfazer" para ações destrutivas leves; confirmação modal só para o irreversível (apagar playlist, limpar cache).

## 7. Estados

| Estado | Tratamento |
| --- | --- |
| Carregando | esqueletos com brilho no formato do conteúdo final |
| Vazio | ilustração simples, uma frase e a ação que resolve |
| Offline | faixa discreta no topo; itens não baixados ficam esmaecidos; a fonte "Offline" mostra só o que está no disco |
| Erro de reprodução | cartão no player com tentar de novo, pular e copiar erro |
| Buffering | anel girando no botão de tocar |

## 8. Arquitetura do frontend

```
src/
  lib/        tipos, catálogo simulado, utilidades, arte generativa
  store/      player (simulador), biblioteca, configurações, UI
  components/ shell (barras, painéis), listas, cartões, menus, diálogos
  pages/      uma por rota
```

- **React 19 + TypeScript + Vite**, Tailwind 4 para estilo, Motion para animação, Zustand para estado, Lucide para ícones.
- Roteador próprio em pilha (voltar/avançar, rolagem por rota) — dispensa dependência e casa com a navegação de app desktop.
- Configurações declaradas como **esquema de dados** e renderizadas por um componente genérico: adicionar uma opção é uma linha.
- Preferências e biblioteca simulada persistem em `localStorage`.

### Contrato com o backend

Todo acesso a dados passa por três pontos, que hoje devolvem mocks:

| Ponto | Hoje | Depois (Rust/Tauri) |
| --- | --- | --- |
| `lib/catalog.ts` | catálogo fictício gerado | `invoke("home_feed")`, `invoke("search")`, `invoke("album")`… por provedor |
| `store/player.ts` | relógio simulado | comandos `play/pause/seek/set_queue` + eventos `position`, `track_changed`, `buffering`, `error` |
| `store/settings.ts` | `localStorage` | arquivo de preferências via comando |

## 9. Fases

1. **Concluída:** shell, todas as telas, player simulado, menus, diálogos, configurações e temas.
2. **Concluída (este documento descreve o resultado):** recursos de sistema.
   - **Barra de título própria.** `decorations: false` no Windows e no Linux, com minimizar/maximizar/fechar desenhados na barra superior (`WindowControls`) e arrasto pelas regiões `data-tauri-drag-region`. No macOS ficam os botões nativos sobrepostos (`tauri.macos.conf.json`, `titleBarStyle: Overlay`) e a barra lateral reserva o espaço deles.
   - **Mini-player em janela separada** (`?mini=1`, 380 × 132, sempre no topo conforme a configuração). Ele não tem estado próprio: a janela principal envia `mm:state` e recebe comandos em `mm:cmd`.
   - **Bandeja do sistema** com Mostrar, Mini-player, Tocar/Pausar, Anterior, Próxima e Sair; dica com a faixa atual; clique esquerdo abre a janela.
   - **Fechar para a bandeja** e **iniciar minimizado**, controlados pelas configurações.
   - **Controles de mídia do sistema** (MPRIS no Linux, SMTC no Windows, Now Playing no macOS) com título, artista, álbum, duração e posição.
   - **Atalhos globais** (`Ctrl+Alt+Espaço` e setas), **notificações** ao trocar de faixa e **iniciar com o sistema**.
   - Fora do Tauri (navegador) tudo isso vira no-op e os eventos passam por `BroadcastChannel`, o que permite testar o mini-player em duas abas.
3. **Próxima:** backend. Motor de áudio, provedores (portando a lógica do MetroFuse), downloads, cache e biblioteca local. Os dois pontos de troca continuam sendo `lib/catalog.ts` e `store/player.ts`.
4. **Depois:** internacionalização (os textos estão em pt-BR direto no código), acessibilidade com leitor de tela, testes automatizados e empacotamento para as três plataformas.
