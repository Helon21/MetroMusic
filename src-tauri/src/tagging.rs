//! Gravação de metadados, capa e letra nos arquivos baixados (lofty).

use crate::model::Res;
use lofty::config::WriteOptions;
use lofty::file::{FileType, TaggedFileExt};
use lofty::id3::v2::{Frame, Id3v2Tag, UnsynchronizedTextFrame};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagExt, TagItem, TagType};
use lofty::TextEncoding;
use std::path::Path;

#[derive(Default, Clone, Debug)]
pub struct TagData {
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub track_no: Option<u32>,
    pub cover: Option<Vec<u8>>,
    pub lyrics: Option<String>,
}

fn sniff_mime(data: &[u8]) -> MimeType {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) { MimeType::Png } else { MimeType::Jpeg }
}

/// Grava título, artistas, álbum, número da faixa, capa e letra. Arquivos sem tag ganham uma do tipo apropriado
/// (WAV e AIFF usam ID3v2, que carrega capa e letra).
pub fn write(path: &Path, d: &TagData) -> Res<()> {
    let mut tagged = lofty::read_from_path(path).map_err(|e| format!("não consegui ler o arquivo para gravar as tags: {e}"))?;
    let tag_type = match tagged.file_type() { FileType::Wav | FileType::Aiff => TagType::Id3v2, _ => tagged.primary_tag_type() };
    let mut tag = tagged.remove(tag_type).unwrap_or_else(|| Tag::new(tag_type));
    if !d.title.trim().is_empty() { tag.set_title(d.title.trim().to_string()); }
    if !d.artists.is_empty() { tag.set_artist(d.artists.join("; ")); }
    if let Some(a) = d.album.as_ref().filter(|a| !a.trim().is_empty()) { tag.set_album(a.trim().to_string()); }
    if let Some(n) = d.track_no { tag.set_track(n); }
    if let Some(c) = &d.cover {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(Picture::unchecked(c.clone()).pic_type(PictureType::CoverFront).mime_type(sniff_mime(c)).build());
    }
    let opts = WriteOptions::default();
    match d.lyrics.as_ref().filter(|l| !l.trim().is_empty()) {
        // ID3v2: a letra é um quadro USLT com idioma; o Tag genérico não o grava, então vai direto no ID3v2.
        Some(l) if tag_type == TagType::Id3v2 => {
            let mut id3 = Id3v2Tag::from(tag);
            id3.insert(Frame::UnsynchronizedText(UnsynchronizedTextFrame::new(TextEncoding::UTF8, *b"und", String::new(), l.clone())));
            id3.save_to_path(path, opts).map_err(|e| format!("não consegui gravar as tags: {e}"))
        }
        Some(l) => {
            tag.insert_unchecked(TagItem::new(ItemKey::Lyrics, ItemValue::Text(l.clone())));
            tag.save_to_path(path, opts).map_err(|e| format!("não consegui gravar as tags: {e}"))
        }
        None => tag.save_to_path(path, opts).map_err(|e| format!("não consegui gravar as tags: {e}")),
    }
}
