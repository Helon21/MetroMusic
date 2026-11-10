//! Importação de playlists: procura cada música (título + artista) nos provedores que tocam por inteiro,
//! com o mesmo critério de correspondência da reprodução.

use crate::model::TrackInfo;
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Emitter;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Wanted { pub title: String, #[serde(default)] pub artist: String, #[serde(default)] pub duration_sec: Option<u64> }

/// Quantas buscas correm ao mesmo tempo (cada uma já consulta os provedores em paralelo).
const PARALLEL: usize = 4;

pub fn to_track(w: &Wanted) -> TrackInfo {
    TrackInfo {
        provider: "import".into(), id: String::new(), title: w.title.trim().to_string(),
        artists: w.artist.split(',').map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect(),
        duration_ms: w.duration_sec.filter(|d| *d > 0).map(|d| d * 1000), ..Default::default()
    }
}

/// Resultado na mesma ordem dos itens; `None` onde nenhum provedor achou a música com certeza.
pub async fn match_all(items: Vec<Wanted>, order: Vec<String>, progress: impl Fn(usize, usize) + Send + Sync + 'static) -> Vec<Option<TrackInfo>> {
    let total = items.len();
    let done = Arc::new(AtomicUsize::new(0));
    let progress = Arc::new(progress);
    let order = Arc::new(order);
    stream::iter(items).map(|w| {
        let (done, progress, order) = (done.clone(), progress.clone(), order.clone());
        async move {
            let found = crate::providers::find_match(&to_track(&w), &order).await;
            progress(done.fetch_add(1, Ordering::SeqCst) + 1, total);
            found
        }
    }).buffered(PARALLEL).collect().await
}

#[tauri::command]
pub async fn import_match(app: tauri::AppHandle, items: Vec<Wanted>, order: Vec<String>) -> Vec<Option<TrackInfo>> {
    match_all(items, order, move |done, total| { let _ = app.emit("import:progress", serde_json::json!({ "done": done, "total": total })); }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_vira_faixa_a_procurar() {
        let t = to_track(&Wanted { title: " Sombra ".into(), artist: "Kaito Norte, Outro".into(), duration_sec: Some(215) });
        assert_eq!((t.title.as_str(), t.artists.clone(), t.duration_ms), ("Sombra", vec!["Kaito Norte".to_string(), "Outro".to_string()], Some(215_000)));
        assert!(to_track(&Wanted { title: "x".into(), artist: " ".into(), duration_sec: Some(0) }).artists.is_empty());
    }

    #[tokio::test]
    async fn sem_provedores_nada_e_encontrado_e_a_ordem_se_mantem() {
        let seen = Arc::new(parking_lot::Mutex::new(vec![]));
        let s2 = seen.clone();
        let items: Vec<Wanted> = (0..6).map(|i| Wanted { title: format!("m{i}"), artist: String::new(), duration_sec: None }).collect();
        let r = match_all(items, vec![], move |d, t| s2.lock().push((d, t))).await;
        assert_eq!(r.len(), 6);
        assert!(r.iter().all(|x| x.is_none()));
        let mut v = seen.lock().clone(); v.sort();
        assert_eq!(v, (1..=6).map(|d| (d, 6)).collect::<Vec<_>>());
    }
}
