// Esquema declarativo das configurações. Cada item vira um controle em
// pages/Settings.tsx; os padrões alimentam store/settings.ts.

type Opt = [value: string, label: string];
/** `soon`: o item ainda não tem implementação; aparece desativado com o selo "Em breve". */
export type Item = (
  | { t: "toggle"; k: string; label: string; desc?: string; def: boolean; dep?: string }
  | { t: "select"; k: string; label: string; desc?: string; def: string; options: Opt[]; dep?: string }
  | { t: "slider"; k: string; label: string; desc?: string; def: number; min: number; max: number; step: number; unit?: string; dep?: string }
  | { t: "text"; k: string; label: string; desc?: string; def: string; placeholder?: string; secret?: boolean; multiline?: boolean; dep?: string }
  | { t: "order"; k: string; label?: string; desc?: string; def: string[]; names: Record<string, string>; offKey?: string }
  | { t: "action"; label: string; desc?: string; button: string; action: string; danger?: boolean }
  | { t: "link"; label: string; desc?: string; to: string }
  | { t: "note"; text: string; tone?: "info" | "warn" }
  | { t: "custom"; id: string }
) & { soon?: boolean };
export interface Section { title?: string; items: Item[] }
export interface Page { id: string; title: string; desc: string; group: string; sections: Section[]; parent?: string; /** Motivo pelo qual a página inteira está indisponível; os controles ficam desativados. */ unavailable?: string }

const tg = (k: string, label: string, def: boolean, desc?: string, dep?: string): Item => ({ t: "toggle", k, label, def, desc, dep });
const sel = (k: string, label: string, def: string, options: Opt[], desc?: string, dep?: string): Item => ({ t: "select", k, label, def, options, desc, dep });
const sl = (k: string, label: string, def: number, min: number, max: number, step: number, unit?: string, desc?: string, dep?: string): Item => ({ t: "slider", k, label, def, min, max, step, unit, desc, dep });
const tx = (k: string, label: string, placeholder = "", desc?: string, extra: Partial<Extract<Item, { t: "text" }>> = {}): Item => ({ t: "text", k, label, def: "", placeholder, desc, ...extra });
const act = (label: string, button: string, action: string, desc?: string, danger?: boolean): Item => ({ t: "action", label, button, action, desc, danger });
const note = (text: string, tone: "info" | "warn" = "info"): Item => ({ t: "note", text, tone });
/** Marca itens (ou chaves) ainda não implementados. */
export const soon = (...items: Item[]): Item[] => items.map((i) => ({ ...i, soon: true }));
const custom = (id: string): Item => ({ t: "custom", id });
const link = (label: string, to: string, desc?: string): Item => ({ t: "link", label, to, desc });

export const AUDIO_PROVIDERS: Record<string, string> = { deezer: "Deezer", tidal: "TIDAL", qobuz: "Qobuz", youtube: "YouTube Music", soundcloud: "SoundCloud", jiosaavn: "JioSaavn", offline: "Arquivos locais e downloads" };
export const LYRICS_PROVIDERS: Record<string, string> = { better: "Better Lyrics (sílaba a sílaba)", apple: "Apple Music (Paxsenix)", lrclib: "LrcLib", musixmatch: "Musixmatch", deezer: "Deezer", spotify: "Spotify", qq: "QQ Music", kugou: "KuGou", bini: "BiniLyrics", plus: "LyricsPlus", youtube: "YouTube Music (não sincronizada)" };
export const PALETTES: [string, string, number, number][] = [
  ["dynamic", "Dinâmica", -1, 1], ["crimson", "Carmesim", 20, 1], ["rose", "Rosa", 0, 1], ["purple", "Roxo", 320, 1], ["deep_purple", "Violeta", 295, 1],
  ["indigo", "Índigo", 275, 1], ["blue", "Azul", 255, 1], ["sky", "Azul-céu", 235, 1], ["cyan", "Ciano", 205, 1], ["teal", "Verde-azulado", 185, 1],
  ["green", "Verde", 150, 1], ["light_green", "Verde-claro", 135, 1], ["lime", "Lima", 120, 1], ["yellow", "Amarelo", 100, 1], ["amber", "Âmbar", 80, 1],
  ["orange", "Laranja", 60, 1], ["deep_orange", "Laranja-escuro", 40, 1], ["brown", "Marrom", 55, 0.4], ["grey", "Cinza", 260, 0], ["blue_grey", "Cinza-azulado", 240, 0.3],
];
/** Serviços cujo áudio completo é protegido: sem suporte por decisão do projeto (ver docs/BACKEND.md). */
export const UNAVAILABLE_PROVIDERS = ["deezer", "tidal", "qobuz"];
const PROTECTED = "O áudio completo deste serviço é protegido e o MetroMusic ainda não tem suporte a ele. Os controles abaixo estão desativados e não têm efeito.";
/** Idiomas da interface: para acrescentar um, crie src/i18n/locales/<código>.json e inclua-o aqui. */
export const APP_LANGS: Opt[] = [["system", "Padrão do sistema"], ["pt-BR", "Português (Brasil)"], ["en", "English"]];
const LANGS: Opt[] = [["system", "Padrão do sistema"], ["pt-BR", "Português (Brasil)"], ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["ja", "日本語"]];
const ROMAN = ["Japonês", "Coreano", "Chinês", "Hindi", "Punjabi", "Russo", "Ucraniano", "Bielorrusso", "Quirguiz", "Sérvio", "Búlgaro", "Macedônio"];

export const PAGES: Page[] = [
  // ───────── Interface
  { id: "appearance", title: "Aparência", desc: "Tema, cores, player e letras", group: "Interface", sections: [
    { title: "Tema e cores", items: [
      custom("themeMode"),
      tg("pureBlack", "Preto puro", false, "Fundo totalmente preto, ideal para telas OLED"),
      custom("palette"),
      sel("appBackground", "Fundo do app", "theme", [["theme", "Cor do tema"], ["galaxy", "Galáxia"]], "A galáxia desenha um céu estrelado estático atrás do conteúdo"),
    ] },
    { title: "Layout", items: [
      sel("density", "Densidade", "comfortable", [["compact", "Compacta"], ["comfortable", "Confortável"], ["spacious", "Espaçosa"]]),
      sel("defaultTab", "Tela inicial", "home", [["home", "Início"], ["explore", "Explorar"], ["library/playlists", "Biblioteca"]]),
      sel("defaultLibTab", "Aba padrão da biblioteca", "playlists", [["mix", "Tudo"], ["playlists", "Playlists"], ["songs", "Músicas"], ["albums", "Álbuns"], ["artists", "Artistas"], ["podcasts", "Podcasts"]]),
      sel("gridSize", "Tamanho da grade", "medium", [["small", "Pequeno"], ["medium", "Médio"], ["big", "Grande"]]),
      tg("showTogetherInSidebar", "Ouvir junto na barra lateral", true, "Desligado, o atalho fica só na barra superior"),
      tg("immersiveHeader", "Capas imersivas", true, "Fundo desfocado com a capa em playlists, álbuns e artistas"),
      tg("cropAlbumArt", "Cortar capas", true, "Força proporção quadrada cortando miniaturas de vídeo"),
      sel("artworkQuality", "Qualidade das capas", "1200", [["544", "544 px"], ["1200", "1200 px"], ["2000", "2000 px"], ["4000", "4000 px (máxima)"]]),
      tg("reduceMotion", "Reduzir animações", false, "Troca transições por fades rápidos"),
    ] },
    { title: "Player", items: [
      sel("playerBackground", "Fundo do Tocando agora", "movingBlur", [["solid", "Sólido"], ["gradient", "Gradiente"], ["blur", "Desfoque"], ["movingBlur", "Desfoque em movimento"], ["galaxy", "Galáxia"], ["galaxyBlur", "Galáxia com desfoque"]]),
      custom("perfStatus"),
      sel("visualPerformance", "Desempenho visual", "auto", [["auto", "Automático (recomendado)"], ["full", "Completo"], ["low", "Leve"]], "Automático liga o modo leve sozinho em PCs sem placa de vídeo ou quando o app fica lento. Leve desliga desfoques, sombras grandes, animações decorativas e vídeos de fundo."),
      sel("playerButtons", "Cor dos botões do player", "default", [["default", "Padrão"], ["primary", "Cor primária"], ["tertiary", "Cor terciária"]]),
      sel("sliderStyle", "Estilo da barra de progresso", "default", [["default", "Padrão"], ["wavy", "Ondulada"], ["squiggly", "Rabiscada"], ["slim", "Fina"]]),
      sel("playerTextAlign", "Alinhamento do texto no player", "left", [["left", "Esquerda"], ["center", "Centro"]]),
      tg("hidePlayerThumbnail", "Esconder a capa no player", false, "Mostra o logo do app no lugar da capa"),
      tg("legacyQualityLabel", "Qualidade abaixo dos controles", false, "Mostra o formato de áudio sob o botão de tocar em vez do selo no topo"),
      tg("liveBitrate", "Bitrate ao vivo", true, "Atualiza o rótulo de bitrate em áudio de taxa variável"),
      tg("animatedCovers", "Capas animadas (Canvas)", true, "Mostra o vídeo em loop do Spotify Canvas sobre a capa quando a faixa tiver um (precisa da conta do Spotify)"),
      sel("miniPlayerBackground", "Fundo da barra do player", "tinted", [["tinted", "Tingido pela capa"], ["theme", "Cor do tema"], ["transparent", "Translúcido"]]),
    ] },
    { title: "Letras", items: [
      sel("lyricsPosition", "Posição do texto", "left", [["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"], ["sided", "Por voz (dueto)"]]),
      sl("lyricsSize", "Tamanho do texto", 28, 18, 44, 1, "px"),
      sl("lyricsSpacing", "Espaçamento entre linhas", 1.3, 1, 2, 0.05, "×"),
      sel("lyricsAnimation", "Animação palavra a palavra", "karaoke", [["none", "Nenhuma"], ["fade", "Fade"], ["glow", "Brilho"], ["slide", "Deslizar"], ["karaoke", "Karaokê"], ["apple", "Estilo Apple Music"]]),
      tg("lyricsGlow", "Brilho na linha ativa", true, "Adiciona um brilho suave e um leve salto à linha cantada"),
      tg("lyricsBlurInactive", "Desfocar linhas distantes", true),
      tg("lyricsUnderCover", "Letra sob a capa", true, "Mostra a linha atual abaixo da capa no Tocando agora"),
      tg("lyricsAutoScroll", "Rolagem automática", true),
      tg("lyricsClickSeek", "Clicar numa linha pula para ela", true),
      tg("lyricsIntervalIndicator", "Indicador de intervalo", true, "Mostra pontos animados em trechos instrumentais longos"),
      tg("lyricsAgentPositioning", "Respeitar posição das vozes", true, "Alinha vocais de apoio de forma diferente da voz principal"),
      link("Romanização", "settings/romanization", "Transliterar letras em outros alfabetos"),
    ] },
  ] },
  { id: "desktop", title: "Área de trabalho", desc: "Janela, bandeja e atalhos", group: "Interface", sections: [
    { title: "Janela", items: [
      tg("closeToTray", "Fechar para a bandeja", true, "O botão de fechar mantém a música tocando em segundo plano"),
      tg("startMinimized", "Iniciar minimizado", false),
      tg("launchAtLogin", "Abrir ao iniciar o sistema", false),
      tg("miniOnTop", "Mini-player sempre no topo", true),
      tg("keepAwake", "Manter a tela ligada no Tocando agora", false),
    ] },
    { title: "Integração com o sistema", items: [
      tg("mediaKeys", "Teclas de mídia", true, "Tocar/pausar, próxima e anterior pelo teclado ou fone. Com os controles de mídia do sistema ligados, é o próprio sistema que entrega as teclas"),
      tg("systemMedia", "Controles de mídia do sistema", true, "MPRIS no Linux, Now Playing no macOS, SMTC no Windows"),
      tg("trackNotifications", "Notificar ao trocar de faixa", false),
      tg("openLinks", "Abrir links de música compatíveis", true, "Cole um link do YouTube Music ou do Spotify na busca para abrir no MetroMusic"),
      tg("globalShortcuts", "Atalhos globais", false, "Funcionam mesmo com a janela sem foco"),
    ] },
    { title: "Atalhos de teclado", items: [custom("shortcuts")] },
  ] },
  { id: "experiments", title: "Experimentos", desc: "Ideias inacabadas atrás de chaves", group: "Interface", sections: [
    { items: [note("Recursos experimentais podem mudar ou sumir. Ative por sua conta.", "warn")] },
    { title: "Player", items: [
      tg("expMetroLyrics", "Letras MetroMusic", true, "Renderizador próprio com movimento por palavra, brilho, desfoque e pontos de pausa musical"),
      tg("expSmoothInline", "Linha de letra suave sob a capa", true, "Mostra só a linha atual, com até três linhas e brilho temporizado"),
      tg("expCoverFade", "Dissolver a capa animada no fundo", false, "Usa a arte animada alta como pano de fundo do player"),
      tg("expGalaxyAdaptive", "Transparência adaptativa na galáxia", false, "Capa clara deixa as estrelas mais discretas; capa escura, mais visíveis"),
      tg("expGalaxyMirrored", "Cores espelhadas na galáxia", false, "Tinge o desfoque com várias cores da capa mantendo o fundo escuro"),
      tg("lyricsHighRefresh", "Letras a 120 fps", false, "Em telas de taxa alta, anima a letra na taxa da tela; desligado limita a 60 quadros por segundo"),
    ] },
    { title: "Confiabilidade da reprodução", items: [
      tg("expProviderTimeout", "Limitar tentativas por provedor", true, "Desiste de um provedor após 20 s e passa para o próximo"),
      tg("expConfirmSkip", "Perguntar antes de pular após falha", false, "Quando todas as fontes falham, para e deixa você tentar de novo ou pular"),
      tg("expDiagnostics", "Diagnóstico detalhado de reprodução", false, "Registra ordem, duração e resultado de cada tentativa no log"),
      tg("expKeepCacheOnQuality", "Preferir cache após trocar a qualidade", true),
      act("Simular erro de reprodução", "Simular", "simulateError", "Mostra como o player reage quando nenhuma fonte responde"),
      act("Simular travamento do app", "Simular", "simulateCrash", "Mostra a tela de relatório de erro"),
    ] },
  ] },

  // ───────── Player e conteúdo
  { id: "player", title: "Player e áudio", desc: "Qualidade, transições, fila e timer", group: "Player e conteúdo", sections: [
    { title: "Áudio", items: [
      sel("audioQuality", "Qualidade do áudio", "max", [["auto", "Automática"], ["low", "Baixa"], ["high", "Alta"], ["max", "Máxima possível"]]),
      tg("normalization", "Normalização de volume", true),
      sel("loudnessLevel", "Nível de loudness", "-14", [["-7", "Agressivo (−7 dB)"], ["-11", "Alto (−11 dB)"], ["-14", "Equilibrado (−14 dB)"], ["-19", "Suave (−19 dB)"]], undefined, "normalization"),
      tg("skipSilence", "Pular silêncio", false, "Avança rápido por trechos silenciosos"),
      tg("skipSilenceInstant", "Pular silêncio instantaneamente", false, "Salta em vez de acelerar", "skipSilence"),
      link("Equalizador", "equalizer", "Perfis paramétricos e assistente AutoEQ"),
    ] },
    { title: "Transições", items: [
      tg("crossfade", "Crossfade", false, "A música atual some enquanto a próxima entra"),
      sl("crossfadeDuration", "Duração do crossfade", 5, 1, 12, 1, "s", undefined, "crossfade"),
      tg("crossfadeGapless", "Desativar em álbuns sem pausa", true, "Não aplica crossfade em álbuns feitos para tocar contínuos", "crossfade"),
      tg("automix", "Automix", false, "Transições estilo DJ com casamento de tempo, tom e batida"),
      sel("automixStyle", "Estilo de mixagem", "fade", [["fade", "Fade — crossfade clássico"], ["quick", "Corte rápido — troca estilo rádio"], ["bass", "Troca de grave — passagem techno"], ["filter", "Saída com filtro"], ["vocal", "Vocal — mantém as vozes claras"], ["punch", "Impacto — curto e direto"], ["ethereal", "Etéreo — longo e sonhador"]], undefined, "automix"),
      sl("automixBars", "Duração da transição", 8, 2, 32, 2, "compassos", undefined, "automix"),
    ] },
    { title: "Velocidade", items: [
      tg("varispeed", "Varispeed", false, "Liga o tom à velocidade, como numa fita acelerada"),
      tg("seekAddUp", "Busca progressiva", false, "Cada salto seguido soma 5 segundos a mais"),
    ] },
    { title: "Fila", items: [
      tg("persistentQueue", "Fila persistente", true, "Restaura a última fila ao abrir o app"),
      tg("autoLoadMore", "Carregar mais músicas", true, "Adiciona músicas ao chegar no fim da fila"),
      tg("similarContent", "Conteúdo semelhante", true, "Continua com músicas parecidas quando a fila acaba"),
      tg("noLoadMoreOnRepeat", "Não carregar mais em repetir tudo", true),
      tg("autoplay", "Reprodução automática", true, "Toca a próxima música quando a atual termina"),
      tg("shufflePlaylistFirst", "Embaralhar a playlist primeiro", true, "Toca tudo da playlist ou álbum antes de passar ao conteúdo semelhante"),
      tg("persistentShuffle", "Embaralhamento persistente", false, "Mantém o aleatório ao iniciar novas músicas ou playlists"),
      tg("rememberShuffleRepeat", "Lembrar aleatório e repetir", true),
      tg("preventDuplicates", "Evitar duplicadas na fila", true, "Uma faixa já na fila é movida em vez de adicionada de novo"),
      sel("preload", "Pré-carregar próximas faixas", "3", [["0", "Desativado"], ["1", "1 faixa"], ["2", "2 faixas"], ["3", "3 faixas"], ["5", "5 faixas"], ["10", "10 faixas"]], "Baixa o começo das próximas faixas da fila para o intervalo entre músicas sumir"),
    ] },
    { title: "Erros", items: [
      tg("autoSkipOnError", "Pular para a próxima em caso de erro", true),
      tg("stopOnProviderError", "Parar no erro do provedor", false, "Só para depuração: mostra o primeiro erro em vez de tentar outra fonte"),
    ] },
    { title: "Timer de sono", items: [
      sl("sleepDefault", "Duração padrão", 30, 5, 120, 5, "min"),
      tg("sleepStopAfterSong", "Esperar a música atual terminar", true),
      tg("sleepFadeOut", "Diminuir o volume no último minuto", true),
      tg("sleepAuto", "Timer de sono automático", false, "Inicia sozinho num horário definido"),
      sel("sleepRepeat", "Repetir", "daily", [["daily", "Todos os dias"], ["weekdays", "Segunda a sexta"], ["weekends", "Sábado e domingo"]], undefined, "sleepAuto"),
      tx("sleepStart", "Início", "23:00", undefined, { dep: "sleepAuto", def: "23:00" }),
    ] },
    { title: "Alarme", items: [custom("alarms")] },
  ] },
  { id: "provider_order", title: "Ordem dos provedores", desc: "Em que ordem tentar cada fonte de áudio", group: "Player e conteúdo", sections: [
    { items: [
      note("Arraste para cima os provedores que devem ser tentados primeiro. Desligue um provedor para pulá-lo. Os que exigem conta só entram depois de configurados em Integrações."),
      { t: "order", k: "providerOrder", def: ["offline", "deezer", "tidal", "qobuz", "youtube", "soundcloud", "jiosaavn"], names: AUDIO_PROVIDERS, offKey: "providerOff" },
      act("Restaurar a ordem padrão", "Restaurar", "resetProviderOrder"),
    ] },
  ] },
  { id: "provider_health", title: "Saúde dos provedores", desc: "Disponibilidade e latência de cada serviço", group: "Player e conteúdo", sections: [
    { items: [note("Verificações leves das APIs e dos resolvedores. Nenhuma música é baixada."), custom("providerHealth")] },
  ] },
  { id: "content", title: "Conteúdo", desc: "Idioma, filtros, início e letras", group: "Player e conteúdo", sections: [
    { title: "Geral", items: [
      sel("appLanguage", "Idioma do app", "system", APP_LANGS, "Mudar o idioma recarrega os textos na hora"),
      sel("contentLanguage", "Idioma do conteúdo", "system", LANGS),
      sel("contentCountry", "País do conteúdo", "BR", [["system", "Padrão do sistema"], ["BR", "Brasil"], ["US", "Estados Unidos"], ["PT", "Portugal"], ["GB", "Reino Unido"], ["JP", "Japão"], ["DE", "Alemanha"]]),
      tg("hideExplicit", "Esconder conteúdo explícito", false),
      tg("hideVideoSongs", "Esconder músicas em vídeo", false),
      tg("hideShorts", "Esconder Shorts", true),
    ] },
    { title: "Início", items: [
      sel("quickPicks", "Sugestões rápidas", "quick", [["quick", "Com base no que você mais ouve"], ["last", "Com base na última música ouvida"]]),
      tg("randomizeHome", "Ordem aleatória das seções", false, "Reordena as seções com prioridades ponderadas a cada abertura"),
      tg("showWrapped", "Mostrar o cartão da Retrospectiva", true),
      sl("topLength", "Tamanho da lista Meu Top", 50, 10, 200, 10, "músicas"),
      sl("historyDuration", "Considerar histórico de", 30, 1, 100, 1, "s", "Tempo mínimo ouvido para a música entrar no histórico"),
    ] },
    { title: "Playlists automáticas", items: [
      tg("showLiked", "Curtidas", true), tg("showDownloaded", "Baixadas", true), tg("showLocal", "Arquivos locais", true),
      tg("showTop", "Meu Top", true), tg("showCached", "Em cache", true), tg("showUploaded", "Enviadas", false),
      tg("showMostStats", "Mais ouvidas da semana e do mês", true, "Cria playlists a partir das estatísticas"),
    ] },
    { title: "Página do artista", items: [
      tg("artistDescription", "Mostrar descrição", true), tg("artistSubscribers", "Mostrar inscritos", true), tg("artistListeners", "Mostrar ouvintes mensais", true),
      tg("artistMotion", "Fundos animados do Apple Music", true, "Usa vídeos de capa em páginas de artista compatíveis"),
    ] },
    { title: "Letras", items: [
      link("Provedores de letra", "settings/lyrics_providers", "Quais usar e em que prioridade"),
      link("Romanização", "settings/romanization", "Transliterar japonês, coreano, cirílico e outros"),
      link("Tradução por IA", "settings/ai", "Traduzir ou transcrever letras com um modelo de linguagem"),
    ] },
    { title: "Proxy", items: [
      tg("proxyEnabled", "Usar proxy", false),
      sel("proxyType", "Tipo", "http", [["http", "HTTP"], ["socks", "SOCKS5"]], undefined, "proxyEnabled"),
      tx("proxyUrl", "Endereço", "host:porta", undefined, { dep: "proxyEnabled" }),
      tg("proxyAuth", "Autenticação", false, undefined, "proxyEnabled"),
      tx("proxyUser", "Usuário", "", undefined, { dep: "proxyAuth" }),
      tx("proxyPass", "Senha", "", undefined, { dep: "proxyAuth", secret: true }),
      note("É preciso reiniciar o app para o proxy entrar em vigor."),
    ] },
  ] },
  { id: "lyrics_providers", parent: "content", title: "Provedores de letra", desc: "Seleção e prioridade", group: "Player e conteúdo", sections: [
    { items: [
      note("Arraste para reordenar. Quanto mais alto, maior a prioridade. A letra do YouTube Music entra sozinha quando nenhuma outra fonte responde e normalmente não é sincronizada."),
      { t: "order", k: "lyricsOrder", def: Object.keys(LYRICS_PROVIDERS), names: LYRICS_PROVIDERS, offKey: "lyricsOff" },
    ] },
  ] },
  { id: "romanization", parent: "content", title: "Romanização", desc: "Transliteração de letras", group: "Player e conteúdo", sections: [
    { items: [
      tg("romanizeAsMain", "Mostrar a romanização como texto principal", false),
      ...ROMAN.map((l, i) => tg(`romanize_${i}`, `Romanizar ${l.toLowerCase()}`, i < 2)),
      tg("romanizeLineByLine", "Detectar idioma linha a linha", false, "Experimental: o cirílico é detectado por linha em vez da música inteira"),
    ] },
  ] },
  { id: "ai", parent: "content", title: "Tradução de letras por IA", desc: "Provedor, modelo e idioma", group: "Player e conteúdo", sections: [
    { title: "Credenciais", items: [
      sel("aiProvider", "Provedor", "openrouter", [["openrouter", "OpenRouter"], ["openai", "OpenAI"], ["claude", "Claude"], ["gemini", "Gemini"], ["perplexity", "Perplexity"], ["xai", "xAI"], ["mistral", "Mistral"], ["deepl", "DeepL"], ["custom", "Personalizado (compatível com OpenAI)"]]),
      tx("aiBaseUrl", "URL base", "https://openrouter.ai/api/v1"),
      tx("aiKey", "Chave da API", "Cole a chave aqui", "A chave fica só neste computador", { secret: true }),
      tx("aiModel", "Modelo", "ex.: claude-haiku-5-5"),
    ] },
    { title: "Tradução", items: [
      sel("aiMode", "Modo", "literal", [["literal", "Tradução — traduz o sentido"], ["transcribed", "Transcrição — converte a pronúncia"]]),
      sel("aiTarget", "Idioma de destino", "pt-BR", LANGS.slice(1)),
      sel("aiFormality", "Formalidade (DeepL)", "default", [["default", "Padrão"], ["more", "Mais formal"], ["less", "Menos formal"]]),
      tx("aiPrompt", "Prompt de sistema", "Use {lineCount} para o número de linhas a traduzir", "Vazio usa o prompt padrão", { multiline: true }),
      act("Restaurar o prompt padrão", "Restaurar", "resetAiPrompt"),
    ] },
  ] },
  { id: "local", title: "Biblioteca local", desc: "Pastas de música no computador", group: "Player e conteúdo", sections: [
    { title: "Pastas", items: [custom("folders")] },
    { title: "Varredura", items: [
      tg("watchFolders", "Monitorar alterações", true, "Atualiza a biblioteca quando arquivos entram ou saem das pastas"),
      tg("scanOnStart", "Varrer ao iniciar", false),
      sl("minDuration", "Ignorar arquivos menores que", 30, 0, 120, 5, "s"),
      tg("readEmbeddedLyrics", "Ler letras embutidas e arquivos .lrc", true),
      tg("preferEmbeddedArt", "Preferir a capa embutida no arquivo", true),
      act("Varrer agora", "Varrer", "scanLocal", "Formatos: FLAC, MP3, M4A, AAC, OGG, WAV"),
    ] },
  ] },

  // ───────── Integrações
  { id: "integrations", title: "Integrações", desc: "Contas e serviços conectados", group: "Contas", sections: [{ items: [custom("integrations")] }] },
  { id: "discord", parent: "integrations", title: "Discord", desc: "Rich Presence", group: "Contas", sections: [
    { items: [custom("discordPreview"), custom("discordStatus"), note("Não precisa entrar nem configurar nada: o MetroMusic fala com o Discord aberto neste computador. Funciona com o Discord de desktop, não com o do navegador.")] },
    { title: "Presença", items: [
      tg("discordRpc", "Ativar Rich Presence", true),
      sel("discordActivity", "Tipo de atividade", "listening", [["playing", "Jogando"], ["listening", "Ouvindo"], ["watching", "Assistindo"], ["competing", "Competindo"]]),
      tg("discordUseDetails", "Destacar o título da música", true, "Mostra o título em destaque em vez do artista"),
      tg("discordShowProvider", "Mostrar o provedor de áudio", false),
      tg("discordPlaybackDetails", "Mostrar detalhes de reprodução", false, "Bitrate e taxa de amostragem"),
    ] },
    { title: "Avançado", items: [
      tg("discordAdvanced", "Modo avançado", false),
      tx("discordAppId", "ID de outro aplicativo (opcional)", "Vazio usa o do MetroMusic", "Só para quem registrou um aplicativo próprio no Discord", { dep: "discordAdvanced" }),
      tx("discordName", "Nome da atividade", "MetroMusic", "Vazio usa o padrão", { dep: "discordAdvanced" }),
      tx("discordBtn1", "Botão 1", "Ouvir no YouTube Music", "Variáveis: {song_name}, {artist_name}, {album_name}. O link é o da faixa no serviço de origem", { dep: "discordAdvanced" }),
      tx("discordBtn2", "Botão 2", "Conhecer o MetroMusic", "Só aparece se a URL do botão 2 também estiver preenchida", { dep: "discordAdvanced" }),
      tx("discordBtn2Url", "URL do botão 2", "https://…", "Precisa começar com https://", { dep: "discordAdvanced" }),
    ] },
    { title: "Em breve", items: soon(
      sel("discordStatus", "Status", "online", [["online", "Disponível"], ["idle", "Ausente"], ["dnd", "Não perturbe"]], "O Rich Presence local não controla o status da conta"),
      tg("discordPreferSpotify", "Preferir a presença do Spotify", false, "Esconde a presença do MetroMusic quando o histórico do Spotify controla a música atual"),
      tg("discordCanvas", "Arte animada", false, "Usa a capa animada no Discord quando houver"),
      sel("discordCanvasQuality", "Qualidade da arte animada", "normal", [["low", "Baixa — 448 px, 15 fps, 6 s"], ["normal", "Normal — 448 px, 20 fps, 10 s"], ["high", "Alta — 512 px, 25 fps, 15 s"]], undefined, "discordCanvas"),
    ) },
  ] },
  { id: "lastfm", parent: "integrations", title: "Last.fm", desc: "Scrobbling", group: "Contas", sections: [
    { items: [custom("login:lastfm")] },
    { title: "Scrobbling", items: [
      tg("lastfmScrobble", "Ativar scrobbling", true),
      tg("lastfmNowPlaying", "Enviar o status Tocando agora", true),
      tg("lastfmLikes", "Sincronizar curtidas", false, "Marca como Loved no Last.fm o que você curte aqui"),
      sl("scrobbleMinDuration", "Scrobble em músicas maiores que", 30, 10, 60, 5, "s"),
      sl("scrobblePercent", "Atraso do scrobble", 50, 30, 95, 5, "%"),
      sl("scrobbleMinutes", "Atraso máximo", 4, 1, 8, 1, "min"),
    ] },
  ] },
  { id: "spotify", parent: "integrations", title: "Spotify", desc: "Canvas, início personalizado e histórico", group: "Contas", sections: [
    { items: [custom("login:spotify")] },
    { title: "Canvas", items: [
      tg("spotifyCanvas", "Ativar Spotify Canvas", true, "Mostra o vídeo em loop quando a música tiver um"),
      sel("canvasPriority", "Prioridade da arte animada", "apple", [["apple", "Preferir Apple Music"], ["spotify", "Preferir Spotify"]]),
      sel("canvasDownload", "Embutir arte animada nos downloads", "off", [["off", "Não embutir"], ["spotify", "Spotify Canvas"], ["apple", "Capas animadas da Apple"], ["both", "Ambos"]], "A maioria dos players não lê esse dado"),
    ] },
    { title: "Sincronização", items: [
      tg("spotifyHistory", "Sincronizar histórico de escuta", false, "Experimental: associa o que você toca às faixas do Spotify"),
      tg("spotifyHistoryGlobal", "Usar o histórico globalmente", false, "Também associa reprodução de outras fontes", "spotifyHistory"),
      tg("spotifyLikes", "Sincronizar curtidas", true, "Adiciona e remove das suas Músicas Curtidas do Spotify"),
      tg("spotifyLyrics", "Letras do Spotify", true),
    ] },
  ] },
  { id: "tidal", parent: "integrations", unavailable: PROTECTED, title: "TIDAL", desc: "Áudio lossless e capas", group: "Contas", sections: [
    { items: [custom("login:tidal")] },
    { title: "Reprodução", items: [
      sel("tidalQuality", "Qualidade", "hires", [["aac", "AAC 320 kbps"], ["flac", "FLAC / 16-bit"], ["hires", "Hi-Res / 24-bit"]]),
      tg("tidalArtwork", "Capas em alta qualidade", true, "Usa a arte do TIDAL no player quando não houver capa animada"),
      tg("tidalAnimated", "Capas animadas do TIDAL", true),
      tx("tidalEndpoints", "Endpoints do resolvedor", "https://exemplo.com", "Uma URL por linha, tentadas em ordem", { multiline: true }),
    ] },
  ] },
  { id: "qobuz", parent: "integrations", unavailable: PROTECTED, title: "Qobuz", desc: "Áudio Hi-Res", group: "Contas", sections: [
    { items: [
      tx("qobuzCountry", "País", "BR", "Código de 2 letras usado nas requisições (ex.: US, FR, GB)"),
      tx("qobuzInstances", "Instâncias personalizadas", "https://qobuz.exemplo.com", "Uma URL por linha, tentadas em ordem", { multiline: true }),
    ] },
  ] },
  { id: "deezer", parent: "integrations", unavailable: PROTECTED, title: "Deezer", desc: "Reprodução principal e letras", group: "Contas", sections: [
    { items: [custom("login:deezer")] },
    { title: "Reprodução", items: [
      sel("deezerQuality", "Qualidade", "flac", [["flac", "FLAC"], ["320", "MP3 320 kbps"], ["128", "MP3 128 kbps"]]),
      tg("deezerUseAccount", "Tocar pela sua conta", true, "Usa a sua sessão em vez do resolvedor compartilhado e volta ao resolvedor se falhar"),
      tg("deezerFast", "Carregamento rápido", true, "Agrupa as tentativas de qualidade para começar mais depressa"),
      tg("deezerLyrics", "Letras do Deezer", true, "Sincronizadas palavra a palavra; exige login"),
      tx("deezerResolver", "URL do resolvedor", "https://…/get_url", "Endpoint compatível com dzmedia"),
    ] },
    { title: "Proxy", items: [
      sel("deezerProxy", "Modo", "direct", [["direct", "Conexão direta"], ["free", "Proxy regional gratuito"], ["custom", "URL personalizada"]]),
      tx("deezerProxyUrl", "Proxy personalizado", "proxy.exemplo.com:3128"),
      note("Proxies gratuitos são mantidos pela comunidade e podem cair a qualquer momento.", "warn"),
    ] },
  ] },
  { id: "soundcloud", parent: "integrations", title: "SoundCloud", desc: "Catálogo independente", group: "Contas", sections: [
    { items: [custom("login:soundcloud"), sel("soundcloudQuality", "Qualidade", "aac160", [["mp3", "MP3 128 kbps"], ["aac96", "AAC 96 kbps"], ["aac160", "AAC 160 kbps (alta)"]])] },
  ] },
  { id: "jiosaavn", parent: "integrations", title: "JioSaavn", desc: "Sem necessidade de login", group: "Contas", sections: [
    { items: [
      sel("jioQuality", "Qualidade", "320", [["320", "Alta (320 kbps)"], ["160", "Média (160 kbps)"], ["96", "Economia de dados (96 kbps)"], ["48", "Mínima (48 kbps)"]]),
      sel("jioLanguage", "Idioma do início", "english", [["english", "Inglês"], ["hindi", "Hindi"], ["punjabi", "Punjabi"], ["tamil", "Tâmil"]]),
    ] },
  ] },
  { id: "together_settings", parent: "integrations", title: "Ouvir junto", desc: "Servidor, nome e aprovações", group: "Contas", sections: [
    { title: "Conexão", items: [
      sel("ltServer", "Servidor", "meowery", [["meowery", "The Meowery (Polônia)"], ["custom", "Personalizado"]], "O mesmo servidor do MetroFuse e do Metrolist: as salas são compatíveis"),
      tx("ltCustomServer", "URL do servidor", "wss://…"),
      tx("ltUsername", "Nome de usuário", "Como os outros veem você", undefined, { def: "Ouvinte" }),
    ] },
    { title: "Sala", items: [
      tg("ltAutoJoin", "Aprovar entradas automaticamente", false),
      tg("ltAutoSuggest", "Aprovar sugestões automaticamente", false, "Sugestões dos convidados vão direto para a fila"),
      tg("ltSyncVolume", "Sincronizar o volume do anfitrião", false),
    ] },
    { title: "Depuração", items: [custom("ltBlocked"), custom("ltLogs")] },
  ] },

  // ───────── Privacidade / dados
  { id: "privacy", title: "Privacidade", desc: "Históricos e uso da conta", group: "Dados", sections: [
    { title: "Histórico de escuta", items: [tg("pauseHistory", "Pausar o histórico de escuta", false), act("Limpar o histórico de escuta", "Limpar", "clearHistory", undefined, true)] },
    { title: "Histórico de busca", items: [tg("pauseSearchHistory", "Pausar o histórico de busca", false), act("Limpar o histórico de busca", "Limpar", "clearSearchHistory", undefined, true)] },
    { title: "Conta", items: [
      tg("useLoginForBrowse", "Usar o login para navegar", true, "Influencia as recomendações e libera conteúdo exclusivo da conta"),
      tg("ytSync", "Sincronizar com a conta automaticamente", true, "Curtidas, playlists e inscrições"),
    ] },
  ] },
  { id: "storage", title: "Armazenamento", desc: "Downloads e cache", group: "Dados", sections: [
    { items: [custom("storage")] },
    { title: "Downloads", items: [
      tx("downloadFolder", "Pasta de downloads", "", undefined, { def: "~/Música/MetroMusic" }),
      sel("downloadQuality", "Qualidade dos downloads", "max", [["high", "Alta"], ["max", "Máxima possível"]]),
      tg("autoDownloadOnLike", "Baixar ao curtir", false),
      tg("writeTags", "Gravar metadados e capa no arquivo", true),
      tg("embedLyrics", "Embutir a letra no arquivo", true),
      act("Apagar todos os downloads", "Apagar", "clearDownloads", undefined, true),
    ] },
    { title: "Cache de músicas", items: [
      tg("songCache", "Guardar músicas em cache", true, "Acelera a reprodução de músicas já ouvidas"),
      sel("maxSongCache", "Tamanho máximo", "4096", [["512", "512 MB"], ["1024", "1 GB"], ["4096", "4 GB"], ["8192", "8 GB"], ["-1", "Sem limite"]]),
      act("Limpar o cache de músicas", "Limpar", "clearSongCache", undefined, true),
    ] },
    { title: "Cache de imagens", items: [
      sel("maxImageCache", "Tamanho máximo", "1024", [["256", "256 MB"], ["512", "512 MB"], ["1024", "1 GB"], ["-1", "Sem limite"]]),
      act("Limpar o cache de imagens", "Limpar", "clearImageCache", undefined, true),
    ] },
  ] },
  { id: "backup", title: "Backup e restauração", desc: "Salvar e recuperar seus dados", group: "Dados", sections: [
    { items: [
      act("Criar backup", "Salvar arquivo…", "backup", "Playlists, curtidas, histórico, estatísticas e configurações"),
      act("Restaurar backup", "Escolher arquivo…", "restore", "Substitui os dados atuais pelos do arquivo"),
      act("Importar playlist M3U", "Importar…", "importM3u"),
      act("Importar playlist CSV", "Importar…", "importCsv", "Exportações do Spotify, Apple Music e similares"),
      act("Transferência de tempo", "Abrir…", "timeTransfer", "Move o tempo de escuta de uma música para outra"),
    ] },
  ] },

  // ───────── Sistema
  { id: "updater", title: "Atualizações", desc: "Versão e novidades", group: "Sistema", sections: [
    { items: [
      custom("updater"),
      tg("autoUpdateCheck", "Procurar atualizações automaticamente", true),
      tg("updateNotifications", "Mostrar o aviso de nova versão", true, "A verificação manual continua disponível"),
    ] },
    { title: "Novidades", items: [custom("changelog")] },
  ] },
  { id: "about", title: "Sobre", desc: "Versão, créditos e licença", group: "Sistema", sections: [{ items: [custom("about")] }] },
];

/**
 * Itens que ainda não têm implementação: aparecem desativados com o selo "Em breve".
 * Chave do controle (`k`), id da ação (`action`) ou id do bloco personalizado (`custom`). Ao implementar um, tire-o daqui.
 * `node scripts/i18n-extract.mjs --unused` (ou o varredor de chaves) mostra o que ainda não é lido por nada.
 */
export const NOT_IMPLEMENTED = [
  // aparência / experimentos
  "artistMotion",
  // player
  "skipSilence", "skipSilenceInstant", "automix", "automixStyle", "automixBars",
  // armazenamento
  "downloadQuality",
  // integrações
  "canvasPriority", "canvasDownload", "spotifyHistory", "spotifyHistoryGlobal",
  "jioQuality", "jioLanguage",
];
for (const p of PAGES) for (const sec of p.sections) for (const it of sec.items) {
  const id = "k" in it ? it.k : it.t === "action" ? it.action : it.t === "custom" ? it.id : "";
  if (id && NOT_IMPLEMENTED.includes(id)) it.soon = true;
}

/** Equalizador (a tela própria edita estes valores; não aparecem na lista de configurações). */
const EQ_DEFAULTS = { eqOn: true, eqPreamp: 0, eq31: 0, eq62: 0, eq125: 0, eq250: 0, eq500: 0, eq1k: 0, eq2k: 0, eq4k: 0, eq8k: 0, eq16k: 0 };
export const DEFAULTS: Record<string, any> = { ...EQ_DEFAULTS, themeMode: "dark", palette: "deep_purple", providerOff: [], lyricsOff: ["qq", "kugou"], alarms: [] };
for (const p of PAGES) for (const s of p.sections) for (const it of s.items) if ("k" in it) DEFAULTS[it.k] = it.def;
