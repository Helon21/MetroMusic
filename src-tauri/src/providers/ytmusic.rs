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

/// Primeiro canal de artista (`UC…`) e primeiro álbum (`MPRE…`) com link entre os trechos dados.
fn link_ids<'a>(runs: impl Iterator<Item = &'a Value>) -> (Option<String>, Option<String>) {
    let (mut artist, mut album) = (None, None);
    for run in runs {
        let Some(b) = at(run, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str()) else { continue };
        if b.starts_with("UC") && artist.is_none() { artist = Some(b.to_string()); }
        if b.starts_with("MPRE") && album.is_none() { album = Some(b.to_string()); }
    }
    (artist, album)
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
        let (artist_id, album_id) = link_ids(sub.get("runs").and_then(|r| r.as_array()).into_iter().flatten());
        return Some(track_item(TrackInfo { provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={vid}")), id: vid, title, artists, artwork_url: art, explicit: is_explicit(r), artist_id, album_id, ..Default::default() }));
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
        else if let Some(r) = c.get("musicResponsiveListItemRenderer") {
            if let Some(t) = parse_item(r) { list = true; items.push(track_item(t)); }
            else if let Some(a) = artist_row(r) { items.push(a); }
        }
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

/// Próxima parte de uma lista longa. As listas da conta (curtidas, histórico) só respondem de verdade
/// quando o token também vai na URL (`ctoken`, `continuation`, `type=next`); só no corpo a resposta vem vazia.
async fn browse_more(token: &str) -> Res<Value> {
    let visitor = visitor_data().await;
    let mut ctx = context(&WEB_REMIX, &visitor);
    if auth::is_logged_in() { if let Some(d) = auth::on_behalf_of() { ctx["user"]["onBehalfOfUser"] = json!(d); } }
    let t = urlencoding::encode(token);
    let endpoint = format!("browse?ctoken={t}&continuation={t}&type=next");
    post(&endpoint, &WEB_REMIX, &visitor, json!({ "context": ctx, "continuation": token }), true).await
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
    let (artist_id, album_id) = link_ids((1..4).filter_map(col).flat_map(|c| c.get("runs").and_then(|r| r.as_array()).into_iter().flatten()));
    Some(TrackInfo {
        provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={id}")), id, title, artists, album: album_name, duration_ms: duration,
        artwork_url: thumb(r).or_else(|| fallback_art.clone()), explicit: is_explicit(r), artist_id, album_id, ..Default::default()
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
        while let (Some(token), true) = (next.take(), kind != "artist" && guard < 120) {
            guard += 1;
            let more = browse_more(&token).await?;
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
    if kind == "album" { for t in tracks.iter_mut() { t.album_id.get_or_insert_with(|| browse_id.to_string()); } }
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
        let (artist_id, album_id) = link_ids(byline.get("runs").and_then(|r| r.as_array()).into_iter().flatten());
        Some(TrackInfo {
            provider: "youtube".into(), url: Some(format!("https://music.youtube.com/watch?v={id}")), id, title, artists, album, artist_id, album_id,
            duration_ms: r.get("lengthText").and_then(first_run).and_then(|t| parse_duration(&t)), artwork_url: thumb(r), explicit: is_explicit(r), ..Default::default()
        })
    }).collect())
}

// ───────── Explorar

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub title: String,
    pub browse_id: String,
    pub params: Option<String>,
    /// Cor do bloco, "#rrggbb"
    pub color: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TileGroup { pub title: String, pub tiles: Vec<Tile> }

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Explore { pub title: String, pub sections: Vec<Section>, pub groups: Vec<TileGroup> }

fn tiles_of(items: &[Value]) -> Vec<Tile> {
    items.iter().filter_map(|i| i.get("musicNavigationButtonRenderer")).filter_map(|b| {
        let title = b.get("buttonText").map(runs_text).filter(|t| !t.is_empty())?;
        let e = at(b, "clickCommand.browseEndpoint")?;
        let color = at(b, "solid.leftStripeColor").and_then(|c| c.as_u64()).map(|c| format!("#{:06x}", c & 0xFF_FFFF));
        Some(Tile { title, browse_id: e.get("browseId")?.as_str()?.to_string(), params: e.get("params").and_then(|p| p.as_str()).map(str::to_string), color })
    }).collect()
}

/// Páginas de Explorar: início, lançamentos, paradas, climas e gêneros (e a página de cada clima).
/// Devolve prateleiras (músicas, álbuns, playlists, vídeos) e/ou grupos de blocos de navegação.
pub async fn explore(browse_id: &str, params: Option<&str>) -> Res<Explore> {
    let mut body = json!({ "browseId": browse_id });
    if let Some(p) = params { body["params"] = json!(p); }
    let v = browse(body).await?;
    let mut out = Explore { title: at(&v, "header.musicHeaderRenderer.title").map(runs_text).unwrap_or_default(), ..Default::default() };
    // carrosséis: cartões, listas de músicas ou blocos de navegação
    for shelf in find_all(&v, "musicCarouselShelfRenderer") {
        let contents = shelf.get("contents").and_then(|c| c.as_array()).cloned().unwrap_or_default();
        let tiles = tiles_of(&contents);
        if !tiles.is_empty() {
            let title = at(shelf, "header.musicCarouselShelfBasicHeaderRenderer.title").and_then(first_run).unwrap_or_default();
            out.groups.push(TileGroup { title, tiles });
        } else if let Some(sec) = carousel(shelf) { out.sections.push(sec); }
    }
    // listas (ex.: "Músicas em alta" nas paradas)
    for shelf in find_all(&v, "musicShelfRenderer") {
        let title = shelf.get("title").map(runs_text).unwrap_or_default();
        let items: Vec<Item> = shelf_rows(shelf).0.iter().filter_map(|r| page_track(r, None, &[], &None).or_else(|| parse_item(r))).map(track_item).collect();
        if !items.is_empty() { out.sections.push(Section { title, label: None, layout: "list".into(), items, more: None }); }
    }
    // grades: cartões (lançamentos, vídeos) ou blocos de navegação (climas e gêneros)
    for grid in find_all(&v, "gridRenderer") {
        let list = grid.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        let title = at(grid, "header.gridHeaderRenderer.title").map(runs_text).unwrap_or_default();
        let tiles = tiles_of(&list);
        if !tiles.is_empty() { out.groups.push(TileGroup { title, tiles }); continue; }
        let items: Vec<Item> = list.iter().filter_map(|i| i.get("musicTwoRowItemRenderer")).filter_map(two_row).collect();
        if !items.is_empty() { out.sections.push(Section { title, label: None, layout: "grid".into(), items, more: None }); }
    }
    if out.sections.is_empty() && out.groups.is_empty() { return Err("o YouTube Music não devolveu conteúdo para esta página".into()); }
    Ok(out)
}

// ───────── Conta, biblioteca, histórico e curtidas (exigem sessão)

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub name: String,
    pub email: Option<String>,
    pub handle: Option<String>,
    pub avatar: Option<String>,
}

fn need_login() -> Res<()> { if auth::is_logged_in() { Ok(()) } else { Err("entre na sua conta do YouTube Music primeiro".into()) } }

/// Nome, e-mail e foto da conta ativa (`account/account_menu`). Falha se a sessão não for válida.
pub async fn account_info() -> Res<AccountInfo> {
    need_login()?;
    let visitor = visitor_data().await;
    let v = post("account/account_menu", &WEB_REMIX, &visitor, json!({ "context": context(&WEB_REMIX, &visitor) }), true).await?;
    let h = find_all(&v, "activeAccountHeaderRenderer").into_iter().next().ok_or("a sessão não é válida (o YouTube não reconheceu a conta); entre de novo")?;
    let text = |k: &str| h.get(k).map(runs_text).filter(|t| !t.is_empty());
    Ok(AccountInfo {
        name: text("accountName").ok_or("a conta não tem nome")?,
        email: text("email"), handle: text("channelHandle"),
        avatar: at(h, "accountPhoto.thumbnails").and_then(|a| a.as_array()).and_then(|a| a.last()).and_then(|t| t.get("url")).and_then(|u| u.as_str()).map(str::to_string),
    })
}

/// Linha de lista que representa um artista (canal `UC…`), como na biblioteca e nas paradas.
fn artist_row(r: &Value) -> Option<Item> {
    let id = at(r, "navigationEndpoint.browseEndpoint.browseId").and_then(|b| b.as_str())?.to_string();
    if !id.starts_with("UC") { return None; }
    let col = |i: usize| at(r, &format!("flexColumns.{i}.musicResponsiveListItemFlexColumnRenderer.text"));
    let title = first_run(col(0)?)?;
    let subtitle = col(1).map(runs_text).unwrap_or_default();
    Some(collection("artist", &id, title, subtitle, thumb(r)))
}

/// Artistas que o usuário segue: linhas de lista com `browseId` de canal.
fn artist_rows(v: &Value) -> Vec<Item> {
    let mut shelves = find_all(v, "musicShelfRenderer");
    shelves.extend(find_all(v, "musicPlaylistShelfRenderer"));
    shelves.iter().flat_map(|s| shelf_rows(s).0).filter_map(|r| artist_row(&r)).collect()
}

/// Seções do histórico (uma por dia: "Hoje", "Ontem"...).
async fn history_sections() -> Res<Vec<Section>> {
    let v = browse(json!({ "browseId": "FEmusic_history" })).await?;
    let mut out = vec![];
    let mut next = None;
    for shelf in find_all(&v, "musicShelfRenderer") {
        let title = shelf.get("title").map(runs_text).unwrap_or_default();
        let (rows, token) = shelf_rows(shelf);
        if token.is_some() { next = token; }
        let items: Vec<Item> = rows.iter().filter_map(|r| page_track(r, None, &[], &None)).map(track_item).collect();
        if !items.is_empty() { out.push(Section { title, label: None, layout: "list".into(), items, more: None }); }
    }
    // dias mais antigos vêm em partes; cada parte traz um ou mais dias
    let mut guard = 0;
    while let (Some(token), true) = (next.take(), guard < 40) {
        guard += 1;
        let more = browse_more(&token).await?;
        let Some(c) = at(&more, "continuationContents.musicShelfContinuation").or_else(|| at(&more, "continuationContents.sectionListContinuation")) else { break };
        let shelves = find_all(c, "musicShelfRenderer");
        let mut groups: Vec<&Value> = if shelves.is_empty() { vec![c] } else { shelves };
        for shelf in groups.drain(..) {
            let title = shelf.get("title").map(runs_text).unwrap_or_default();
            let (rows, token) = shelf_rows(shelf);
            if token.is_some() { next = token; }
            let items: Vec<Item> = rows.iter().filter_map(|r| page_track(r, None, &[], &None)).map(track_item).collect();
            if items.is_empty() { continue; }
            match out.last_mut() { Some(last) if title.is_empty() || last.title == title => last.items.extend(items), _ => out.push(Section { title, label: None, layout: "list".into(), items, more: None }) }
        }
        if next.is_none() { next = continuation_of(c); }
    }
    Ok(out)
}

/// Biblioteca da conta: "songs" (curtidas), "playlists", "albums", "artists" ou "history".
pub async fn library(kind: &str) -> Res<Page> {
    need_login()?;
    match kind {
        // "VLLM" é a playlist de curtidas como playlist comum: pagina até o fim (FEmusic_liked_videos para na 1ª parte)
        "songs" => page("VLLM").await.map(|mut p| { p.kind = "songs".into(); p }),
        "playlists" => page("FEmusic_liked_playlists").await.map(|mut p| { p.kind = "playlists".into(); p }),
        "albums" => page("FEmusic_liked_albums").await.map(|mut p| { p.kind = "albums".into(); p }),
        "artists" => {
            let v = browse(json!({ "browseId": "FEmusic_library_corpus_artists" })).await?;
            Ok(Page { kind: "artists".into(), id: "artists".into(), items: artist_rows(&v), ..Default::default() })
        }
        "history" => Ok(Page { kind: "history".into(), id: "history".into(), sections: history_sections().await?, ..Default::default() }),
        _ => Err(format!("biblioteca desconhecida: {kind}")),
    }
}

/// Curtir / descurtir uma música na conta.
pub async fn rate(video_id: &str, like: bool) -> Res<()> {
    need_login()?;
    let visitor = visitor_data().await;
    let body = json!({ "context": context(&WEB_REMIX, &visitor), "target": { "videoId": video_id } });
    post(if like { "like/like" } else { "like/removelike" }, &WEB_REMIX, &visitor, body, true).await.map(|_| ())
}

fn nonce() -> String {
    use std::hash::{BuildHasher, Hasher};
    const A: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(crate::model::now_ms());
    let mut x = h.finish();
    (0..16).map(|_| { let c = A[(x & 63) as usize] as char; x = x.rotate_right(6) ^ x.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 7; c }).collect()
}

fn fmt_time(x: f64) -> String { let s = format!("{x:.2}"); s.trim_end_matches('0').trim_end_matches('.').to_string() }

/// Registra a reprodução no histórico oficial do YouTube Music ("marcar como assistido").
/// Porte de `registerPlaybackTracking` do MetroFuse: o player autenticado (WEB_REMIX) devolve as URLs de
/// rastreio; chamá-las com o mesmo `cpn` faz a música entrar no histórico da conta.
pub async fn mark_played(video_id: &str, played_secs: f64) -> Res<()> {
    need_login()?;
    let visitor = visitor_data().await;
    let body = json!({ "context": context(&WEB_REMIX, &visitor), "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true });
    let v = post("player", &WEB_REMIX, &visitor, body, true).await?;
    let base = |k: &str| at(&v, &format!("playbackTracking.{k}.baseUrl")).and_then(|u| u.as_str()).map(str::to_string);
    let playback = base("videostatsPlaybackUrl").ok_or("o YouTube não devolveu a URL de rastreio de reprodução")?;
    let watch = base("videostatsWatchtimeUrl").ok_or("o YouTube não devolveu a URL de rastreio de tempo assistido")?;
    let len = playback.split(['?', '&']).find_map(|p| p.strip_prefix("len=")).and_then(|l| l.parse::<f64>().ok()).unwrap_or(played_secs.max(1.5));
    let until = fmt_time((len - 1.0).max(0.5));
    let cpn = nonce();
    let call = |url: String, extra: Vec<(&'static str, String)>| {
        let cpn = cpn.clone(); let visitor = visitor.clone(); let until = until.clone();
        async move {
            let now = crate::model::now_ms().to_string();
            let mut q: Vec<(&str, String)> = vec![("ver", "2".into()), ("c", "WEB_REMIX".into()), ("cpn", cpn), ("cmt", until), ("el", "detailpage".into())];
            q.extend(extra);
            let mut req = crate::http::CLIENT.get(&url).header("User-Agent", WEB_REMIX.ua).header("Referer", "https://music.youtube.com/").header("Origin", "https://music.youtube.com")
                .header("X-Goog-Event-Time", &now).header("X-Goog-Request-Time", &now);
            if let Some(vd) = visitor { req = req.header("X-Goog-Visitor-Id", vd); }
            for (k, val) in auth::headers() { req = req.header(k, val); }
            // parâmetros repetidos na URL base são substituídos pelos nossos
            let mut u = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
            let keep: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| !q.iter().any(|(qk, _)| qk == k)).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
            u.query_pairs_mut().clear().extend_pairs(keep).extend_pairs(q.iter().map(|(k, v)| (*k, v.as_str())));
            let resp = req.build().map(|mut r| { *r.url_mut() = u; r }).map_err(|e| e.to_string())?;
            let r = crate::http::CLIENT.execute(resp).await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok(()) } else { Err(format!("rastreio HTTP {}", r.status())) }
        }
    };
    call(playback, vec![]).await?;
    call(watch, vec![("st", "0".into()), ("et", until.clone())]).await
}

#[cfg(test)]
pub async fn debug_raw(id: &str) -> Value { browse(json!({ "browseId": id })).await.unwrap() }
#[cfg(test)]
pub async fn debug_raw_cont(token: &str) -> Value { browse_more(token).await.unwrap() }

#[cfg(test)]
pub async fn debug_try(id: &str) -> Res<Value> { browse(json!({ "browseId": id })).await }
