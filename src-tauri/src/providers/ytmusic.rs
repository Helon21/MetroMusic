//! Navegação do YouTube Music (InnerTube `browse` e `next`): Início, álbuns, playlists, artistas e rádio.
//! Porte de `YouTube.home/album/playlist/artist/next` e das páginas de `innertube/pages` (MetroFuse),
//! feito de forma tolerante: procura os blocos pelo nome em vez de depender de um caminho fixo,
//! porque o YouTube muda o aninhamento com frequência.

use super::auth;
use super::youtube::{at, big_artwork, context, parse_duration, parse_item, post, visitor_data, WEB_REMIX};
use crate::model::{Res, TrackInfo};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRef {
    /// "album", "playlist", "artist" ou "mix" (rádio/mix: toca por `radio`, não por `browse`)
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub artwork: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection: Option<CollectionRef>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub title: String,
    pub label: Option<String>,
    /// "list" (músicas em grade, como as sugestões rápidas) ou "carousel"
    pub layout: String,
    pub items: Vec<Item>,
    pub more: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Chip {
    pub title: String,
    pub browse_id: String,
    pub params: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HomeFeed {
    pub chips: Vec<Chip>,
    pub sections: Vec<Section>,
    pub continuation: Option<String>,
    pub personalized: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub description: Option<String>,
    pub artwork: Option<String>,
    pub tracks: Vec<TrackInfo>,
    pub sections: Vec<Section>,
    /// Itens de grade (listas da biblioteca: playlists, álbuns, artistas salvos)
    pub items: Vec<Item>,
}

// ───────── Utilidades de JSON

fn runs_text(v: &Value) -> String {
    v.get("runs").and_then(|r| r.as_array()).map(|r| r.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect()).unwrap_or_default()
}

fn first_run(v: &Value) -> Option<String> {
    at(v, "runs.0.text").and_then(|t| t.as_str()).map(str::to_string)
}

fn thumb(r: &Value) -> Option<String> {
    ["thumbnail.musicThumbnailRenderer.thumbnail.thumbnails", "thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails",
     "thumbnail.croppedSquareThumbnailRenderer.thumbnail.thumbnails", "musicThumbnailRenderer.thumbnail.thumbnails",
     "croppedSquareThumbnailRenderer.thumbnail.thumbnails", "thumbnail.thumbnails"]
        .iter()
        .find_map(|p| at(r, p).and_then(|a| a.as_array()).and_then(|a| a.last()).and_then(|t| t.get("url")).and_then(|u| u.as_str()).map(big_artwork))
}

/// Todos os objetos que estão sob a chave `key`, em profundidade, na ordem do documento.
fn collect<'a>(v: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match v {
        Value::Object(m) => { for (k, x) in m { if k == key { out.push(x); } else { collect(x, key, out); } } }
        Value::Array(a) => a.iter().for_each(|x| collect(x, key, out)),
        _ => {}
    }
}

fn find_all<'a>(v: &'a Value, key: &str) -> Vec<&'a Value> { let mut o = vec![]; collect(v, key, &mut o); o }

fn is_explicit(r: &Value) -> bool {
    r.get("badges").and_then(|b| b.as_array()).map_or(false, |b| b.iter().any(|x| at(x, "musicInlineBadgeRenderer.icon.iconType").and_then(|i| i.as_str()) == Some("MUSIC_EXPLICIT_BADGE")))
}

fn artist_names(runs: &Value) -> Vec<String> {
    runs.as_array().into_iter().flatten()
        .filter(|r| at(r, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str()).map_or(false, |b| b.starts_with("UC")))
        .filter_map(|r| r.get("text").and_then(|t| t.as_str()).map(str::to_string)).collect()
}

fn collection(kind: &str, id: &str, title: String, subtitle: String, artwork: Option<String>) -> Item {
    Item { track: None, collection: Some(CollectionRef { kind: kind.into(), id: id.into(), title, subtitle, artwork }) }
}

fn track_item(t: TrackInfo) -> Item { Item { track: Some(t), collection: None } }

// ───────── Itens e seções

/// Cartão de duas linhas: pode ser música, álbum, playlist, artista ou mix.
fn two_row(r: &Value) -> Option<Item> {
    let title = first_run(r.get("title")?)?;
    let nav = r.get("navigationEndpoint")?;
    let sub = r.get("subtitle").cloned().unwrap_or(Value::Null);
    let subtitle = runs_text(&sub);
    let art = thumb(r);
    if let Some(w) = nav.get("watchEndpoint") {
        let vid = w.get("videoId")?.as_str()?.to_string();
        let mut artists = sub.get("runs").map(artist_names).unwrap_or_default();
        if artists.is_empty() {
            // sem links: pega o primeiro trecho que não seja separador nem o tipo ("Song", "Video")
            if let Some(a) = sub.get("runs").and_then(|r| r.as_array()).into_iter().flatten().filter_map(|x| x.get("text").and_then(|t| t.as_str())).map(str::trim)
                .find(|t| !t.is_empty() && *t != "•" && !matches!(*t, "Song" | "Video" | "Música" | "Vídeo")) { artists.push(a.to_string()); }
        }
        if artists.is_empty() { artists.push("Artista desconhecido".into()); }
        return Some(track_item(TrackInfo { provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={vid}")), id: vid, title, artists, artwork_url: art, explicit: is_explicit(r), ..Default::default() }));
    }
    if let Some(b) = nav.get("browseEndpoint") {
        let id = b.get("browseId")?.as_str()?;
        let page_type = at(b, "browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType").and_then(|p| p.as_str()).unwrap_or("");
        let kind = match page_type {
            "MUSIC_PAGE_TYPE_ALBUM" | "MUSIC_PAGE_TYPE_AUDIOBOOK" => "album",
            "MUSIC_PAGE_TYPE_PLAYLIST" => "playlist",
            "MUSIC_PAGE_TYPE_ARTIST" | "MUSIC_PAGE_TYPE_USER_CHANNEL" => "artist",
            _ => return None, // podcasts e afins ainda não têm tela
        };
        return Some(collection(kind, id, title, subtitle, art));
    }
    if let Some(p) = nav.get("watchPlaylistEndpoint").and_then(|w| w.get("playlistId")).and_then(|p| p.as_str()) {
        return Some(collection("mix", p, title, subtitle, art));
    }
    None
}

fn carousel(shelf: &Value) -> Option<Section> {
    let hdr = shelf.get("header")?.get("musicCarouselShelfBasicHeaderRenderer")?;
    let title = first_run(hdr.get("title")?)?;
    let label = hdr.get("strapline").and_then(first_run);
    let more = at(hdr, "moreContentButton.buttonRenderer.navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str()).map(str::to_string);
    let mut items = vec![];
    let mut list = false;
    for c in shelf.get("contents").and_then(|c| c.as_array()).into_iter().flatten() {
        if let Some(r) = c.get("musicTwoRowItemRenderer") { items.extend(two_row(r)); }
        else if let Some(r) = c.get("musicResponsiveListItemRenderer") { if let Some(t) = parse_item(r) { list = true; items.push(track_item(t)); } }
    }
    if items.is_empty() { return None; }
    Some(Section { title, label, layout: if list { "list" } else { "carousel" }.into(), items, more })
}

// ───────── Requisições

async fn browse(body_extra: Value) -> Res<Value> {
    let visitor = visitor_data().await;
    let mut ctx = context(&WEB_REMIX, &visitor);
    if auth::is_logged_in() { if let Some(d) = auth::on_behalf_of() { ctx["user"]["onBehalfOfUser"] = json!(d); } }
    let mut body = json!({ "context": ctx });
    if let (Some(b), Some(extra)) = (body.as_object_mut(), body_extra.as_object()) { for (k, v) in extra { b.insert(k.clone(), v.clone()); } }
    post("browse", &WEB_REMIX, &visitor, body, true).await
}

fn continuation_of(section_list: &Value) -> Option<String> {
    at(section_list, "continuations.0.nextContinuationData.continuation").and_then(|c| c.as_str()).map(str::to_string)
}

/// Início do YouTube Music: personalizada se houver sessão. `chip` filtra por clima; `continuation` traz mais seções.
pub async fn home(chip: Option<(String, Option<String>)>, continuation: Option<String>) -> Res<HomeFeed> {
    let personalized = auth::is_logged_in();
    if let Some(c) = continuation {
        let v = browse(json!({ "continuation": c })).await?;
        let sl = at(&v, "continuationContents.sectionListContinuation").ok_or("a continuação da Início veio vazia")?;
        let sections = sl.get("contents").and_then(|c| c.as_array()).into_iter().flatten().filter_map(|c| c.get("musicCarouselShelfRenderer")).filter_map(carousel).collect();
        return Ok(HomeFeed { chips: vec![], sections, continuation: continuation_of(sl), personalized });
    }
    let (browse_id, params) = chip.unwrap_or(("FEmusic_home".into(), None));
    let v = browse(json!({ "browseId": browse_id, "params": params })).await?;
    let sl = at(&v, "contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer").ok_or("resposta da Início sem seções")?;
    let sections: Vec<Section> = sl.get("contents").and_then(|c| c.as_array()).into_iter().flatten().filter_map(|c| c.get("musicCarouselShelfRenderer")).filter_map(carousel).collect();
    let chips = at(sl, "header.chipCloudRenderer.chips").and_then(|c| c.as_array()).into_iter().flatten().filter_map(|c| {
        let c = c.get("chipCloudChipRenderer")?;
        let b = at(c, "navigationEndpoint.browseEndpoint")?;
        Some(Chip { title: first_run(c.get("text")?)?, browse_id: b.get("browseId")?.as_str()?.to_string(), params: b.get("params").and_then(|p| p.as_str()).map(str::to_string) })
    }).collect();
    Ok(HomeFeed { chips, sections, continuation: continuation_of(sl), personalized })
}

/// Linhas de música de uma prateleira (ou de uma continuação) e o token da próxima parte, se houver.
fn shelf_rows(shelf: &Value) -> (Vec<Value>, Option<String>) {
    let contents = shelf.get("contents").and_then(|c| c.as_array());
    let rows = contents.into_iter().flatten().filter_map(|c| c.get("musicResponsiveListItemRenderer")).cloned().collect();
    let token = continuation_of(shelf).or_else(|| contents.and_then(|c| c.iter().rev().find_map(|i| {
        at(i, "continuationItemRenderer.continuationEndpoint.continuationCommand.token").and_then(|t| t.as_str()).map(str::to_string)
    })));
    (rows, token)
}

const HEADERS: [&str; 5] = ["musicResponsiveHeaderRenderer", "musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer", "musicDetailHeaderRenderer", "musicEditablePlaylistDetailHeaderRenderer"];

fn kind_of(id: &str) -> &'static str {
    if id.starts_with("UC") { "artist" } else if id.starts_with("MPRE") || id.starts_with("OLAK") { "album" } else { "playlist" }
}

/// Faixa de uma linha de lista de álbum/playlist; completa o que a linha não traz (artista, álbum, capa).
fn page_track(r: &Value, album: Option<&str>, fallback_artists: &[String], fallback_art: &Option<String>) -> Option<TrackInfo> {
    let id = at(r, "playlistItemData.videoId").and_then(|v| v.as_str())?.to_string();
    let col = |i: usize| at(r, &format!("flexColumns.{i}.musicResponsiveListItemFlexColumnRenderer.text"));
    let title = first_run(col(0)?)?;
    let mut artists: Vec<String> = (1..4).filter_map(col).flat_map(|c| c.get("runs").map(artist_names).unwrap_or_default()).collect();
    artists.dedup();
    if artists.is_empty() { artists = fallback_artists.to_vec(); }
    if artists.is_empty() { artists.push("Artista desconhecido".into()); }
    let album_name = album.map(str::to_string).or_else(|| (1..4).filter_map(col).find_map(|c| c.get("runs").and_then(|r| r.as_array()).into_iter().flatten().find_map(|run| {
        let b = at(run, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str())?;
        if b.starts_with("MPRE") { run.get("text").and_then(|t| t.as_str()).map(str::to_string) } else { None }
    })));
    let duration = at(r, "fixedColumns.0.musicResponsiveListItemFixedColumnRenderer.text.runs.0.text").or_else(|| at(r, "fixedColumns.0.musicResponsiveListItemFlexColumnRenderer.text.runs.0.text"))
        .and_then(|t| t.as_str()).and_then(parse_duration);
    Some(TrackInfo {
        provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={id}")), id, title, artists, album: album_name, duration_ms: duration,
        artwork_url: thumb(r).or_else(|| fallback_art.clone()), explicit: is_explicit(r), ..Default::default()
    })
}

/// Álbum, playlist, artista ou lista da biblioteca (`browse_id` como veio do cartão).
pub async fn page(browse_id: &str) -> Res<Page> {
    let v = browse(json!({ "browseId": browse_id })).await?;
    let kind = kind_of(browse_id);
    let header = HEADERS.iter().find_map(|k| find_all(&v, k).into_iter().next());
    let (mut title, mut subtitle, mut description, mut artwork, mut strapline) = (String::new(), String::new(), None::<String>, None::<String>, Vec::<String>::new());
    if let Some(h) = header {
        title = h.get("title").and_then(first_run).unwrap_or_default();
        subtitle = h.get("subtitle").map(runs_text).unwrap_or_default();
        description = h.get("description").map(runs_text).filter(|d| !d.is_empty());
        artwork = thumb(h);
        strapline = h.get("straplineTextOne").and_then(|s| s.get("runs")).map(artist_names).unwrap_or_default();
        if strapline.is_empty() { strapline = h.get("subtitle").and_then(|s| s.get("runs")).map(artist_names).unwrap_or_default(); }
    }
    if artwork.is_none() { artwork = at(&v, "background.musicThumbnailRenderer.thumbnail.thumbnails").and_then(|a| a.as_array()).and_then(|a| a.last()).and_then(|t| t.get("url")).and_then(|u| u.as_str()).map(big_artwork); }
    if description.is_none() { description = find_all(&v, "musicDescriptionShelfRenderer").first().and_then(|d| d.get("description")).map(runs_text).filter(|d| !d.is_empty()); }

    // músicas: todas as prateleiras (álbum/playlist) ou só a primeira (artista = "Músicas").
    // Álbuns usam `musicShelfRenderer`; playlists usam `musicPlaylistShelfRenderer`.
    let mut shelves = find_all(&v, "musicShelfRenderer");
    shelves.extend(find_all(&v, "musicPlaylistShelfRenderer"));
    let album = (kind == "album").then_some(title.as_str());
    let mut tracks: Vec<TrackInfo> = vec![];
    for (i, shelf) in shelves.iter().enumerate() {
        if kind == "artist" && i > 0 { break; }
        let (rows, mut next) = shelf_rows(shelf);
        tracks.extend(rows.into_iter().filter_map(|r| page_track(&r, album, &strapline, &artwork)));
        // playlists longas vêm em partes
        let mut guard = 0;
        while let (Some(token), true) = (next.take(), kind != "artist" && guard < 8) {
            guard += 1;
            let more = browse(json!({ "continuation": token })).await?;
            let cont = at(&more, "continuationContents.musicPlaylistShelfContinuation").or_else(|| at(&more, "continuationContents.musicShelfContinuation"));
            let (rows, token) = match cont {
                Some(c) => shelf_rows(c),
                None => match at(&more, "onResponseReceivedActions.0.appendContinuationItemsAction") {
                    Some(a) => shelf_rows(&json!({ "contents": a.get("continuationItems").cloned().unwrap_or(Value::Null) })),
                    None => break,
                },
            };
            tracks.extend(rows.into_iter().filter_map(|r| page_track(&r, album, &strapline, &artwork)));
            next = token;
        }
    }
    let sections = find_all(&v, "musicCarouselShelfRenderer").into_iter().filter_map(carousel).collect();
    let items = find_all(&v, "gridRenderer").into_iter().flat_map(|g| g.get("items").and_then(|i| i.as_array()).into_iter().flatten()).filter_map(|i| i.get("musicTwoRowItemRenderer")).filter_map(two_row).collect();
    Ok(Page { kind: kind.into(), id: browse_id.into(), title, subtitle, description, artwork, tracks, sections, items })
}

/// Fila de "rádio": músicas parecidas com `video_id`, ou o conteúdo de um mix/playlist de reprodução (`playlist_id`).
pub async fn radio(video_id: Option<&str>, playlist_id: Option<&str>) -> Res<Vec<TrackInfo>> {
    let visitor = visitor_data().await;
    let pid = playlist_id.map(str::to_string).or_else(|| video_id.map(|v| format!("RDAMVM{v}")));
    let mut body = json!({
        "context": context(&WEB_REMIX, &visitor), "playlistId": pid, "isAudioOnly": true,
        "tunerSettingValue": "AUTOMIX_SETTING_NORMAL", "enablePersistentPlaylistPanel": true,
    });
    if let Some(v) = video_id { body["videoId"] = json!(v); }
    if playlist_id.is_none() { body["params"] = json!("wAEB"); }
    let v = post("next", &WEB_REMIX, &visitor, body, true).await?;
    let list = at(&v, "contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs.0.tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer.contents")
        .and_then(|c| c.as_array()).ok_or("a rádio veio vazia")?;
    Ok(list.iter().filter_map(|c| {
        let r = c.get("playlistPanelVideoRenderer")?;
        let id = r.get("videoId")?.as_str()?.to_string();
        let title = r.get("title").and_then(first_run)?;
        let byline = r.get("longBylineText").or_else(|| r.get("shortBylineText")).cloned().unwrap_or(Value::Null);
        let mut artists = byline.get("runs").map(artist_names).unwrap_or_default();
        if artists.is_empty() { artists.push(first_run(&byline).unwrap_or_else(|| "Artista desconhecido".into())); }
        let album = byline.get("runs").and_then(|r| r.as_array()).into_iter().flatten().find_map(|run| {
            let b = at(run, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str())?;
            if b.starts_with("MPRE") { run.get("text").and_then(|t| t.as_str()).map(str::to_string) } else { None }
        });
        Some(TrackInfo {
            provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={id}")), id, title, artists, album,
            duration_ms: r.get("lengthText").and_then(first_run).and_then(|t| parse_duration(&t)), artwork_url: thumb(r), explicit: is_explicit(r), ..Default::default()
        })
    }).collect())
}
