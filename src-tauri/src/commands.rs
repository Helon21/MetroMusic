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
