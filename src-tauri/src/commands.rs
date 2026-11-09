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
