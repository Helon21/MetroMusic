//! Comandos expostos à interface.

use crate::model::{Res, TrackInfo};
use crate::playback::Player;
use crate::providers::{self, ytmusic};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::State;

type P<'a> = State<'a, Arc<Player>>;

#[tauri::command]
pub async fn search_online(provider: String, query: String, limit: Option<usize>) -> Res<Vec<TrackInfo>> {
    providers::search(&provider, &query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub fn audio_play(player: P, track: TrackInfo, start: Option<f64>, autoplay: Option<bool>, order: Vec<String>) -> Res<u64> {
    player.inner().play(track, start.unwrap_or(0.0), autoplay.unwrap_or(true), order)
}
#[tauri::command] pub fn audio_pause(player: P) -> Res<()> { player.pause() }
#[tauri::command] pub fn audio_resume(player: P) -> Res<()> { player.resume() }
#[tauri::command] pub fn audio_seek(player: P, seconds: f64) -> Res<()> { player.seek(seconds) }
#[tauri::command] pub fn audio_stop(player: P) -> Res<()> { player.stop() }
#[tauri::command] pub fn audio_set_volume(player: P, volume: f32) -> Res<()> { player.set_volume(volume) }
#[tauri::command] pub fn audio_set_speed(player: P, speed: f32) -> Res<()> { player.set_speed(speed) }

#[tauri::command] pub fn audio_set_eq(player: P, on: bool, gains: Vec<f32>, preamp: f32) -> Res<()> { player.set_eq(on, &gains, preamp) }
#[tauri::command] pub fn audio_set_normalization(player: P, on: bool, target: f32) -> Res<()> { player.set_normalization(on, target) }
#[tauri::command] pub fn audio_set_crossfade(player: P, secs: f32) -> Res<()> { player.set_crossfade(secs) }
#[tauri::command] pub fn audio_advance(player: P) -> Res<()> { player.advance() }

#[tauri::command]
pub fn audio_precache(player: P, tracks: Vec<TrackInfo>, count: usize, order: Vec<String>) {
    player.inner().precache(tracks, count, order);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats { bytes: u64, entries: usize, limit: u64, enabled: bool }

#[tauri::command]
pub fn cache_stats(player: P) -> CacheStats {
    let s = player.cache.stats();
    CacheStats { bytes: s.bytes, entries: s.entries, limit: s.limit, enabled: player.cache.enabled.load(Ordering::Relaxed) }
}
#[tauri::command]
pub fn cache_clear(player: P) {
    // a faixa que está tocando fica; o resto é apagado
    player.cache.clear(&player.protected());
}
#[tauri::command]
pub fn cache_configure(player: P, limit_mb: Option<u64>, enabled: Option<bool>) {
    if let Some(mb) = limit_mb { player.cache.set_limit_mb(mb); }
    if let Some(e) = enabled { player.cache.enabled.store(e, Ordering::Relaxed); }
    player.cache.trim(&player.protected());
}

// ───────── YouTube Music: Início, páginas e rádio

#[tauri::command]
pub async fn yt_home(chip_browse_id: Option<String>, chip_params: Option<String>, continuation: Option<String>) -> Res<ytmusic::HomeFeed> {
    ytmusic::home(chip_browse_id.map(|b| (b, chip_params)), continuation).await
}

#[tauri::command]
pub async fn yt_page(browse_id: String) -> Res<ytmusic::Page> {
    ytmusic::page(&browse_id).await
}

#[tauri::command]
pub async fn yt_radio(video_id: Option<String>, playlist_id: Option<String>) -> Res<Vec<TrackInfo>> {
    ytmusic::radio(video_id.as_deref(), playlist_id.as_deref()).await
}

// ───────── Letras

#[tauri::command]
pub async fn lyrics_get(track: TrackInfo, order: Vec<String>) -> Res<Option<crate::lyrics::Lyrics>> {
    let supported: Vec<String> = order.into_iter().filter(|p| crate::lyrics::SUPPORTED.contains(&p.as_str())).collect();
    crate::lyrics::get(&track, &supported).await
}

// ───────── Contas

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LOGIN_LABEL: &str = "ytlogin";
const LOGIN_UA: &str = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LoginEvent { ok: bool, cancelled: bool, error: Option<String>, account: Option<ytmusic::AccountInfo> }

/// Aceita a sessão: guarda, confirma com o YouTube e, se não valer, apaga.
async fn finish_login(cookie: &str) -> Res<ytmusic::AccountInfo> {
    let a = providers::auth::from_cookie(cookie)?;
    providers::auth::set(a)?;
    match ytmusic::account_info().await {
        Ok(info) => Ok(info),
        Err(e) => { providers::auth::clear(); Err(e) }
    }
}

/// Abre a janela de login do Google (sessão anônima, sem lembrar nada) e espera os cookies da conta.
/// O resultado chega pelo evento `yt:login`.
#[tauri::command]
pub async fn yt_login_start(app: AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) { let _ = w.set_focus(); return Ok(()); }
    let url = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F";
    let win = WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
        .title("Entrar no YouTube Music").inner_size(520.0, 740.0).center().incognito(true).user_agent(LOGIN_UA)
        .build().map_err(|e| format!("não foi possível abrir a janela de login: {e}"))?;
    let music: tauri::Url = "https://music.youtube.com/".parse().unwrap();
    tauri::async_runtime::spawn(async move {
        let emit = |ev: LoginEvent| { let _ = app.emit("yt:login", ev); };
        let mut idle_after_cookie = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            if app.get_webview_window(LOGIN_LABEL).is_none() { return emit(LoginEvent { ok: false, cancelled: true, error: None, account: None }); }
            #[cfg(debug_assertions)]
            if std::env::var("MM_LOGIN_DEBUG").is_ok() { eprintln!("[login] url={:?}", win.url().map(|u| u.to_string())); }
            let Ok(cookies) = win.cookies_for_url(music.clone()) else { continue };
            let header = cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ");
            if providers::auth::sapisid_of(&header).is_none() { continue; }
            // espera os demais cookies da conta assentarem (SID, LOGIN_INFO…) antes de validar
            idle_after_cookie += 1;
            if idle_after_cookie < 2 { continue; }
            let result = finish_login(&header).await;
            let _ = win.close();
            return emit(match result {
                Ok(info) => LoginEvent { ok: true, cancelled: false, error: None, account: Some(info) },
                Err(e) => LoginEvent { ok: false, cancelled: false, error: Some(e), account: None },
            });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn yt_login_cancel(app: AppHandle) { if let Some(w) = app.get_webview_window(LOGIN_LABEL) { let _ = w.close(); } }

/// Método avançado: o usuário cola o cabeçalho `Cookie` de music.youtube.com.
#[tauri::command]
pub async fn yt_login_cookie(cookie: String) -> Res<ytmusic::AccountInfo> { finish_login(&cookie).await }

/// Conta atual, confirmada com o YouTube. `None` = sem sessão; sessão que expirou é apagada.
#[tauri::command]
pub async fn yt_account() -> Res<Option<ytmusic::AccountInfo>> {
    if !providers::auth::is_logged_in() { return Ok(None); }
    match ytmusic::account_info().await {
        Ok(i) => Ok(Some(i)),
        Err(e) if e.contains("HTTP 401") || e.contains("HTTP 403") || e.contains("não é válida") => { providers::auth::clear(); Ok(None) }
        Err(e) => Err(e), // sem rede: mantém a sessão
    }
}

#[tauri::command]
pub fn yt_logout() { providers::auth::clear(); }

#[tauri::command]
pub async fn yt_library(kind: String) -> Res<ytmusic::Page> { ytmusic::library(&kind).await }

#[tauri::command]
pub async fn yt_rate(video_id: String, like: bool) -> Res<()> { ytmusic::rate(&video_id, like).await }

#[tauri::command]
pub async fn yt_mark_played(video_id: String, played_secs: f64) -> Res<()> { ytmusic::mark_played(&video_id, played_secs).await }

#[tauri::command]
pub async fn yt_explore(browse_id: String, params: Option<String>) -> Res<ytmusic::Explore> { ytmusic::explore(&browse_id, params.as_deref()).await }

// ───────── Last.fm

#[tauri::command]
pub fn lastfm_status() -> crate::lastfm::Status { crate::lastfm::status() }

#[tauri::command]
pub async fn lastfm_login(api_key: Option<String>, secret: Option<String>, username: String, password: String) -> Res<String> {
    crate::lastfm::login(api_key, secret, &username, &password).await
}

#[tauri::command]
pub fn lastfm_logout() { crate::lastfm::logout() }

#[tauri::command]
pub async fn lastfm_now_playing(artist: String, track: String, album: Option<String>, duration: Option<u64>) -> Res<()> {
    crate::lastfm::now_playing(&artist, &track, album.as_deref(), duration).await
}

#[tauri::command]
pub async fn lastfm_scrobble(artist: String, track: String, timestamp: u64, album: Option<String>, duration: Option<u64>) -> Res<()> {
    crate::lastfm::scrobble(&artist, &track, timestamp, album.as_deref(), duration).await
}

#[tauri::command]
pub async fn lastfm_love(artist: String, track: String, love: bool) -> Res<()> { crate::lastfm::love(&artist, &track, love).await }

// ───────── SoundCloud (conta)

const SC_LABEL: &str = "sclogin";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScLoginEvent { ok: bool, cancelled: bool, error: Option<String>, account: Option<providers::sc_account::Me> }

async fn finish_sc_login(raw: &str) -> Res<providers::sc_account::Me> {
    providers::sc_account::set_token(raw)?;
    match providers::sc_account::me().await { Ok(m) => Ok(m), Err(e) => { providers::sc_account::clear(); Err(e) } }
}

/// Abre a página de login do SoundCloud (sessão anônima) e espera o cookie `oauth_token`.
#[tauri::command]
pub async fn sc_login_start(app: AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window(SC_LABEL) { let _ = w.set_focus(); return Ok(()); }
    let win = WebviewWindowBuilder::new(&app, SC_LABEL, WebviewUrl::External("https://soundcloud.com/signin".parse().map_err(|e| format!("{e}"))?))
        .title("Entrar no SoundCloud").inner_size(520.0, 740.0).center().incognito(true).user_agent(LOGIN_UA)
        .build().map_err(|e| format!("não foi possível abrir a janela de login: {e}"))?;
    let site: tauri::Url = "https://soundcloud.com/".parse().unwrap();
    tauri::async_runtime::spawn(async move {
        let emit = |ev: ScLoginEvent| { let _ = app.emit("sc:login", ev); };
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            if app.get_webview_window(SC_LABEL).is_none() { return emit(ScLoginEvent { ok: false, cancelled: true, error: None, account: None }); }
            let Ok(cookies) = win.cookies_for_url(site.clone()) else { continue };
            let Some(tok) = cookies.iter().find(|c| c.name() == "oauth_token").map(|c| c.value().to_string()) else { continue };
            let result = finish_sc_login(&tok).await;
            let _ = win.close();
            return emit(match result {
                Ok(m) => ScLoginEvent { ok: true, cancelled: false, error: None, account: Some(m) },
                Err(e) => ScLoginEvent { ok: false, cancelled: false, error: Some(e), account: None },
            });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn sc_login_cancel(app: AppHandle) { if let Some(w) = app.get_webview_window(SC_LABEL) { let _ = w.close(); } }

#[tauri::command]
pub async fn sc_login_token(token: String) -> Res<providers::sc_account::Me> { finish_sc_login(&token).await }

#[tauri::command]
pub async fn sc_account() -> Res<Option<providers::sc_account::Me>> {
    if !providers::sc_account::is_logged_in() { return Ok(None); }
    match providers::sc_account::me().await {
        Ok(m) => Ok(Some(m)),
        Err(e) if e.contains("HTTP 401") || e.contains("HTTP 403") || e.contains("não é válida") => { providers::sc_account::clear(); Ok(None) }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn sc_logout() { providers::sc_account::clear() }

#[tauri::command]
pub async fn sc_library(kind: String) -> Res<ytmusic::Page> { providers::sc_account::library(&kind).await }

#[tauri::command]
pub async fn sc_playlist(id: String) -> Res<ytmusic::Page> { providers::sc_account::playlist(&id).await }

#[tauri::command]
pub async fn sc_rate(track_id: String, like: bool) -> Res<()> { providers::sc_account::rate(&track_id, like).await }

#[tauri::command]
pub async fn other_home(provider: String) -> Res<Vec<ytmusic::Section>> { providers::other_home(&provider).await }

// ───────── Spotify (conta)

const SP_LABEL: &str = "splogin";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpLoginEvent { ok: bool, cancelled: bool, error: Option<String>, account: Option<providers::spotify::Me> }

#[tauri::command]
pub fn sp_status() -> providers::spotify::Status { providers::spotify::status() }

/// Abre o login oficial do Spotify (PKCE). O retorno para `http://127.0.0.1:8899/callback` é interceptado
/// na própria janela, sem servidor local. O resultado chega pelo evento `sp:login`.
#[tauri::command]
pub async fn sp_login_start(app: AppHandle, client_id: Option<String>) -> Res<()> {
    if let Some(w) = app.get_webview_window(SP_LABEL) { let _ = w.set_focus(); return Ok(()); }
    let pkce = providers::spotify::begin(client_id)?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let tx = std::sync::Mutex::new(tx);
    let win = WebviewWindowBuilder::new(&app, SP_LABEL, WebviewUrl::External(pkce.url.parse().map_err(|e| format!("{e}"))?))
        .title("Entrar no Spotify").inner_size(520.0, 760.0).center().incognito(true).user_agent(LOGIN_UA)
        .on_navigation(move |url| {
            if url.as_str().starts_with(providers::spotify::REDIRECT) {
                let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
                let r = match (q.get("code"), q.get("error")) {
                    (Some(c), _) => Ok(c.clone()),
                    (_, Some(e)) => Err(if e == "access_denied" { "você negou o acesso no Spotify".to_string() } else { format!("o Spotify recusou o login ({e})") }),
                    _ => Err("resposta de login inesperada".to_string()),
                };
                if let Ok(t) = tx.lock() { let _ = t.send(r); }
                return false; // não carrega a página de retorno
            }
            true
        })
        .build().map_err(|e| format!("não foi possível abrir a janela de login: {e}"))?;
    let verifier = pkce.verifier;
    tauri::async_runtime::spawn(async move {
        let emit = |ev: SpLoginEvent| { let _ = app.emit("sp:login", ev); };
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            match rx.try_recv() {
                Ok(Ok(code)) => {
                    let _ = win.close();
                    return emit(match providers::spotify::finish(&code, &verifier).await {
                        Ok(m) => SpLoginEvent { ok: true, cancelled: false, error: None, account: Some(m) },
                        Err(e) => SpLoginEvent { ok: false, cancelled: false, error: Some(e), account: None },
                    });
                }
                Ok(Err(e)) => { let _ = win.close(); return emit(SpLoginEvent { ok: false, cancelled: false, error: Some(e), account: None }); }
                Err(_) => {}
            }
            if app.get_webview_window(SP_LABEL).is_none() { return emit(SpLoginEvent { ok: false, cancelled: true, error: None, account: None }); }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn sp_login_cancel(app: AppHandle) { if let Some(w) = app.get_webview_window(SP_LABEL) { let _ = w.close(); } }

#[tauri::command]
pub async fn sp_account() -> Res<Option<providers::spotify::Me>> {
    if !providers::spotify::is_logged_in() { return Ok(None); }
    match providers::spotify::me().await {
        Ok(m) => Ok(Some(m)),
        Err(e) if e.contains("HTTP 401") || e.contains("HTTP 403") || e.contains("não é válida") => { providers::spotify::logout(); Ok(None) }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn sp_logout() { providers::spotify::logout() }

#[tauri::command]
pub async fn sp_library(kind: String) -> Res<ytmusic::Page> { providers::spotify::library(&kind).await }

#[tauri::command]
pub async fn sp_page(id: String) -> Res<ytmusic::Page> { providers::spotify::page(&id).await }

#[tauri::command]
pub async fn sp_rate(track_id: String, like: bool) -> Res<()> { providers::spotify::rate(&track_id, like).await }
