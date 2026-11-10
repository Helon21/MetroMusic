import {
  Activity, AlarmClock, AlignCenter, AlignLeft, ArrowDownToLine, ArrowDownUp, ArrowLeftRight, AudioLines, Ban, Bell, Blend, Bot, Bug, Check, CircleDot, CircleUser, Clock, Coffee, Command, Contrast,
  Copy, Cpu, Crop, Database, Dices, Disc3, Download, Droplets, Ellipsis, Eye, EyeOff, FastForward, FileSpreadsheet, FileText, Film, Folder, FolderOpen, FolderSearch, Gamepad2, Gauge, GitBranch, Gift,
  Globe, HardDrive, Headphones, Heart, History, House, Image, Images, Info, KeyRound, Keyboard, Languages, Layers, LayoutGrid, Library, Link, ListEnd, ListFilter, ListMusic, ListOrdered, ListPlus, ListStart,
  Lock, LogIn, MapPin, MessageCircle, MessageSquare, MicVocal, Minimize2, MonitorSpeaker, Moon, MousePointerClick, Music, Network, Orbit, Palette, PanelBottom, Pause, Percent, PictureInPicture2, Play,
  Plug, Power, Radio, RefreshCw, Repeat, Repeat1, RotateCcw, Rows3, Scale, ScrollText, Search, Server, Settings, Shuffle, ShieldAlert, SkipForward, SlidersHorizontal, Smartphone, Sparkles, Sun, Tag,
  Timer, ToggleRight, Trash2, TrendingUp, Trophy, TriangleAlert, Type, Upload, Users, Video, Volume1, Volume2, Waypoints, Wand2, Wind, Zap,
  type LucideIcon,
} from "lucide-react";
import type { Item } from "./settingsSchema";

/** Um ícone por opção (chave, ação ou destino do link) para dar referência visual às listas longas. */
const BY_KEY: Record<string, LucideIcon> = {
  // aparência
  pureBlack: Contrast, appBackground: Sparkles, density: Rows3, defaultTab: House, defaultLibTab: Library, gridSize: LayoutGrid, showTogetherInSidebar: Users, immersiveHeader: Image,
  cropAlbumArt: Crop, artworkQuality: Images, reduceMotion: Wind, playerBackground: Layers, playerButtons: Palette, sliderStyle: SlidersHorizontal, playerTextAlign: AlignLeft,
  hidePlayerThumbnail: EyeOff, legacyQualityLabel: Tag, liveBitrate: Activity, animatedCovers: Film, miniPlayerBackground: PanelBottom, lyricsPosition: AlignCenter, lyricsSize: Type,
  lyricsSpacing: ArrowDownUp, lyricsAnimation: Wand2, lyricsGlow: Sun, lyricsBlurInactive: Droplets, lyricsUnderCover: ListEnd, lyricsAutoScroll: ArrowDownUp, lyricsClickSeek: MousePointerClick,
  lyricsIntervalIndicator: Ellipsis, lyricsAgentPositioning: MicVocal, "settings/romanization": Languages, "settings/lyrics_providers": ScrollText, "settings/ai": Bot, equalizer: SlidersHorizontal,
  // área de trabalho
  closeToTray: Minimize2, startMinimized: EyeOff, launchAtLogin: Power, miniOnTop: PictureInPicture2, keepAwake: Coffee, mediaKeys: Keyboard, systemMedia: MonitorSpeaker,
  trackNotifications: Bell, openLinks: Link, globalShortcuts: Command,
  // experimentos
  expMetroLyrics: Music, expSmoothInline: ListEnd, expCoverFade: Film, expGalaxyAdaptive: Orbit, expGalaxyMirrored: Orbit, lyricsHighRefresh: Gauge, expProviderTimeout: Timer,
  expConfirmSkip: Pause, expDiagnostics: Bug, expKeepCacheOnQuality: Database, simulateError: TriangleAlert, simulateCrash: ShieldAlert,
  // player e áudio
  audioQuality: AudioLines, normalization: Volume2, loudnessLevel: Gauge, skipSilence: FastForward, skipSilenceInstant: SkipForward,
  crossfade: Blend, crossfadeDuration: Timer, crossfadeGapless: Disc3, automix: Wand2, automixStyle: Palette, automixBars: Timer, varispeed: Gauge, seekAddUp: FastForward,
  persistentQueue: ListMusic, autoLoadMore: ListPlus, similarContent: Radio, noLoadMoreOnRepeat: Repeat, autoplay: Play, shufflePlaylistFirst: Shuffle, persistentShuffle: Shuffle,
  rememberShuffleRepeat: Repeat1, preventDuplicates: Copy, preload: Download, autoSkipOnError: SkipForward, stopOnProviderError: Ban, sleepDefault: Moon, sleepStopAfterSong: ListEnd,
  sleepFadeOut: Volume1, sleepAuto: Clock, sleepRepeat: Repeat, sleepStart: AlarmClock, resetProviderOrder: RotateCcw,
  // conteúdo
  appLanguage: Languages, contentLanguage: Globe, contentCountry: MapPin, hideExplicit: EyeOff, hideVideoSongs: Video, hideShorts: Smartphone, quickPicks: Zap, randomizeHome: Dices,
  showWrapped: Gift, topLength: TrendingUp, historyDuration: History, showLiked: Heart, showDownloaded: ArrowDownToLine, showLocal: FolderOpen, showTop: TrendingUp, showCached: HardDrive,
  showUploaded: Upload, showMostStats: Trophy, artistDescription: FileText, artistSubscribers: Users, artistListeners: Headphones, artistMotion: Film,
  proxyEnabled: Network, proxyType: Waypoints, proxyUrl: Link, proxyAuth: KeyRound, proxyUser: CircleUser, proxyPass: Lock,
  // romanização
  romanizeAsMain: Type, romanizeLineByLine: ListOrdered,
  // IA
  aiProvider: Bot, aiBaseUrl: Link, aiKey: KeyRound, aiModel: Cpu, aiMode: Wand2, aiTarget: Languages, aiFormality: Scale, aiPrompt: MessageSquare, resetAiPrompt: RotateCcw,
  // biblioteca local
  watchFolders: Eye, scanOnStart: FolderSearch, minDuration: Timer, readEmbeddedLyrics: FileText, preferEmbeddedArt: Image, scanLocal: FolderSearch,
  // integrações
  discordRpc: MessageCircle, discordStatus: CircleDot, discordActivity: Gamepad2, discordUseDetails: Type, discordShowProvider: Waypoints, discordPlaybackDetails: Info, discordPreferSpotify: Music,
  discordAdvanced: Settings, discordName: Tag, discordBtn1: MousePointerClick, discordBtn2: MousePointerClick, discordCanvas: Film, discordCanvasQuality: Gauge,
  lastfmScrobble: Radio, lastfmNowPlaying: Play, lastfmLikes: Heart, scrobbleMinDuration: Timer, scrobblePercent: Percent, scrobbleMinutes: Clock,
  spotifyCanvas: Film, canvasPriority: ListOrdered, canvasDownload: Download, spotifyHistory: History, spotifyHistoryGlobal: Globe, spotifyLikes: Heart, spotifyLyrics: MicVocal,
  tidalQuality: AudioLines, tidalArtwork: Image, tidalAnimated: Film, tidalEndpoints: Server, qobuzCountry: MapPin, qobuzInstances: Server,
  deezerQuality: AudioLines, deezerUseAccount: CircleUser, deezerFast: Zap, deezerLyrics: MicVocal, deezerResolver: Link, deezerProxy: Network, deezerProxyUrl: Link,
  soundcloudQuality: AudioLines, jioQuality: AudioLines, jioLanguage: Languages,
  ltServer: Server, ltCustomServer: Link, ltUsername: CircleUser, ltAutoJoin: Check, ltAutoSuggest: ListPlus, ltSyncVolume: Volume2,
  // privacidade, armazenamento e dados
  pauseHistory: Pause, clearHistory: Trash2, pauseSearchHistory: Search, clearSearchHistory: Trash2, useLoginForBrowse: LogIn, ytSync: RefreshCw,
  downloadFolder: FolderOpen, downloadQuality: AudioLines, autoDownloadOnLike: Heart, writeTags: Tag, embedLyrics: FileText, clearDownloads: Trash2, songCache: HardDrive, maxSongCache: Database,
  clearSongCache: Trash2, maxImageCache: Database, clearImageCache: Trash2,
  backup: Download, restore: Upload, importM3u: FileText, importCsv: FileSpreadsheet, timeTransfer: ArrowLeftRight,
  // sistema
  autoUpdateCheck: RefreshCw, updateNotifications: Bell,
};

const FALLBACK: Record<string, LucideIcon> = { toggle: ToggleRight, select: ListFilter, slider: SlidersHorizontal, text: Settings, action: Plug, link: Folder, order: ListOrdered };

export function iconFor(item: Item): LucideIcon | null {
  if (item.t === "note" || item.t === "custom" || item.t === "order") return null;
  const key = "k" in item ? item.k : item.t === "action" ? item.action : item.to;
  if (/^romanize_\d+$/.test(key)) return Languages;
  return BY_KEY[key] ?? FALLBACK[item.t] ?? null;
}
