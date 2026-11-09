// Backend do MetroMusic. A reprodução em si ainda é simulada no frontend; aqui ficam
// os recursos de sistema da fase 2: bandeja, janela do mini-player, fechar para a
// bandeja e controles de mídia do sistema (MPRIS / SMTC / Now Playing).
//
// Comunicação com a interface:
//   - comandos (invoke): toggle_mini, show_main_window, set_close_to_tray, update_now_playing
//   - evento "mm:cmd" (bandeja, mídia do sistema e mini-player -> janela principal)
//   - evento "mm:state" / "mm:hello" (janela principal <-> mini-player)

mod audio;
mod cache;
mod commands;
mod http;
mod lyrics;
mod model;
mod playback;
mod preload;
mod providers;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::MacosLauncher;

enum MediaMsg {
    Meta { title: String, artist: String, album: String, duration: f64 },
    State { playing: bool, position: f64 },
}

#[derive(Default)]
struct AppState {
    close_to_tray: AtomicBool,
    media: Mutex<Option<Sender<MediaMsg>>>,
    tray: Mutex<Option<(TrayIcon<Wry>, MenuItem<Wry>)>>,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Abre o mini-player ou, se já estiver aberto, fecha. Devolve `true` se ficou aberto.
#[tauri::command]
fn toggle_mini(app: AppHandle, on_top: bool) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("mini") {
        w.close().map_err(|e| e.to_string())?;
        return Ok(false);
    }
    WebviewWindowBuilder::new(&app, "mini", WebviewUrl::App("index.html?mini=1".into()))
        .title("MetroMusic · Mini")
        .inner_size(380.0, 132.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(on_top)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Lê uma variável de ambiente de desenvolvimento (usada pelos testes automáticos da interface).
#[tauri::command]
fn dev_flag(name: String) -> bool {
    cfg!(debug_assertions) && name.starts_with("MM_") && std::env::var(&name).is_ok()
}

#[tauri::command]
fn set_close_to_tray(state: State<AppState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

/// Atualiza dica da bandeja, texto do item Tocar/Pausar e a mídia do sistema.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn update_now_playing(
    state: State<AppState>,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    position: f64,
    playing: bool,
    media: bool,
) {
    // A mídia do sistema vai primeiro: os métodos da bandeja falam com o D-Bus de forma síncrona
    // no Linux e podiam atrasar a atualização do estado em mais de um segundo.
    let tip = if title.is_empty() { "MetroMusic".to_string() } else { format!("{title} — {artist}") };
    if media {
        if let Some(tx) = state.media.lock().unwrap().as_ref() {
            let _ = tx.send(MediaMsg::Meta { title, artist, album, duration });
            let _ = tx.send(MediaMsg::State { playing, position });
        }
    }
    if let Some((tray, toggle)) = state.tray.lock().unwrap().as_ref() {
        let _ = tray.set_tooltip(Some(tip));
        let _ = toggle.set_text(if playing { "Pausar" } else { "Tocar" });
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Mostrar o MetroMusic", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Mini-player", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Tocar", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Anterior", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Próxima", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &mini, &sep1, &toggle, &prev, &next, &sep2, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or("ícone padrão ausente")?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("MetroMusic")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "mini" => {
                let _ = toggle_mini(app.clone(), true);
            }
            "quit" => app.exit(0),
            id @ ("toggle" | "prev" | "next") => {
                let _ = app.emit_to("main", "mm:cmd", json!({ "type": id }));
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    *app.state::<AppState>().tray.lock().unwrap() = Some((tray, toggle));
    Ok(())
}

/// Integra com MPRIS (Linux), SMTC (Windows) e Now Playing (macOS) numa thread própria.
fn setup_media(app: &tauri::App) {
    let handle = app.handle().clone();
    #[cfg(target_os = "windows")]
    let hwnd: Option<usize> = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as usize);
    #[cfg(not(target_os = "windows"))]
    let hwnd: Option<usize> = None;

    let (tx, rx) = channel::<MediaMsg>();
    std::thread::spawn(move || {
        let config = PlatformConfig {
            dbus_name: "metromusic",
            display_name: "MetroMusic",
            hwnd: hwnd.map(|h| h as *mut std::ffi::c_void),
        };
        let mut controls = match MediaControls::new(config) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[mídia] controles do sistema indisponíveis: {e:?}");
                return;
            }
        };
        let events = handle.clone();
        let _ = controls.attach(move |ev| {
            let (kind, value) = match ev {
                MediaControlEvent::Play => ("play", None),
                MediaControlEvent::Pause | MediaControlEvent::Stop => ("pause", None),
                MediaControlEvent::Toggle => ("toggle", None),
                MediaControlEvent::Next => ("next", None),
                MediaControlEvent::Previous => ("prev", None),
                MediaControlEvent::SetPosition(MediaPosition(d)) => ("seek", Some(d.as_secs_f64())),
                _ => return,
            };
            let _ = events.emit_to("main", "mm:cmd", json!({ "type": kind, "value": value }));
        });
        for msg in rx {
            match msg {
                MediaMsg::Meta { title, artist, album, duration } => {
                    let _ = controls.set_metadata(MediaMetadata {
                        title: Some(&title),
                        artist: Some(&artist),
                        album: Some(&album),
                        cover_url: None,
                        duration: Some(Duration::from_secs_f64(duration.max(0.0))),
                    });
                }
                MediaMsg::State { playing, position } => {
                    let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
                    let _ = controls.set_playback(if playing { MediaPlayback::Playing { progress } } else { MediaPlayback::Paused { progress } });
                }
            }
        }
    });
    *app.state::<AppState>().media.lock().unwrap() = Some(tx);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            toggle_mini, show_main_window, set_close_to_tray, update_now_playing, dev_flag,
            commands::search_online, commands::audio_play, commands::audio_pause, commands::audio_resume, commands::audio_seek,
            commands::audio_stop, commands::audio_set_volume, commands::audio_set_speed, commands::audio_precache,
            commands::cache_stats, commands::cache_clear, commands::cache_configure,
            commands::yt_home, commands::yt_page, commands::yt_radio, commands::lyrics_get, commands::yt_login_start, commands::yt_login_cancel, commands::yt_login_cookie, commands::yt_account, commands::yt_logout, commands::yt_library, commands::yt_rate, commands::yt_mark_played,
        ])
        .setup(|app| {
            // Motor de áudio e cache. Os eventos `audio:*` chegam a todas as janelas.
            let cache_dir = app.path().app_cache_dir()?.join("songs");
            let handle = app.handle().clone();
            let emit: audio::Emit = std::sync::Arc::new(move |name, payload| { let _ = handle.emit(name, payload); });
            app.manage(playback::Player::new(cache_dir, 4096, emit));
            // Sessão do YouTube Music guardada de uma execução anterior.
            providers::auth::init(app.path().app_data_dir()?.join("youtube-auth.json"));
            // Sem bandeja (ex.: ambiente sem appindicator) o app segue funcionando; só não esconde a janela.
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("[bandeja] indisponível: {e}");
            }
            setup_media(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let state = window.state::<AppState>();
                    let has_tray = state.tray.lock().unwrap().is_some();
                    if has_tray && state.close_to_tray.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o MetroMusic");
}
