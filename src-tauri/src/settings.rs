//! Configurações do app em arquivo. Os valores comuns vão para `settings.json`; os segredos (chave da
//! IA, senha do proxy…) vão para `secrets.json`, com permissão `0600`, e nunca para o `localStorage`.
//! A interface mantém uma cópia em memória e chama `settings_save` a cada mudança (com atraso).

use crate::model::Res;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

static DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

pub fn init(dir: PathBuf) { *DIR.lock() = Some(dir); }

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
pub struct Stored {
    /// `false` quando ainda não existe arquivo (primeira execução ou migração do `localStorage`).
    pub exists: bool,
    pub values: Map<String, Value>,
    pub secrets: Map<String, Value>,
}

fn read_map(path: &Path) -> Option<Map<String, Value>> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(&text) { Ok(Value::Object(m)) => Some(m), _ => None }
}

/// Grava por arquivo temporário + renomeação, para um desligamento no meio não corromper o original.
fn write_atomic(path: &Path, map: &Map<String, Value>, private: bool) -> Res<()> {
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    if let Some(dir) = path.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    if private { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)); }
    let _ = private;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn load_from(dir: &Path) -> Stored {
    let values = read_map(&dir.join("settings.json"));
    let secrets = read_map(&dir.join("secrets.json"));
    Stored { exists: values.is_some() || secrets.is_some(), values: values.unwrap_or_default(), secrets: secrets.unwrap_or_default() }
}

pub fn save_to(dir: &Path, values: &Map<String, Value>, secrets: &Map<String, Value>) -> Res<()> {
    write_atomic(&dir.join("settings.json"), values, false)?;
    write_atomic(&dir.join("secrets.json"), secrets, true)
}

/// Configurações gravadas, para os módulos do backend que precisam delas (ex.: proxy do cliente HTTP).
pub fn current() -> Stored { DIR.lock().clone().map(|d| load_from(&d)).unwrap_or_default() }

fn dir() -> Res<PathBuf> { DIR.lock().clone().ok_or_else(|| "pasta de dados indisponível".to_string()) }

#[tauri::command]
pub fn settings_load() -> Res<Stored> { Ok(load_from(&dir()?)) }

#[tauri::command]
pub fn settings_save(values: Map<String, Value>, secrets: Map<String, Value>) -> Res<()> { save_to(&dir()?, &values, &secrets) }

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mm-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn sem_arquivo_nao_existe() {
        let d = tmp("vazio");
        assert!(!load_from(&d).exists);
    }

    #[test]
    fn grava_e_le_de_volta() {
        let d = tmp("ida-volta");
        let v = json!({"palette": "blue", "crossfade": true}).as_object().unwrap().clone();
        let s = json!({"aiKey": "sk-segredo"}).as_object().unwrap().clone();
        save_to(&d, &v, &s).unwrap();
        let got = load_from(&d);
        assert!(got.exists);
        assert_eq!(got.values, v);
        assert_eq!(got.secrets, s);
        // o segredo nunca vai para o arquivo comum
        assert!(!std::fs::read_to_string(d.join("settings.json")).unwrap().contains("sk-segredo"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn segredos_com_permissao_restrita() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("perm");
        save_to(&d, &Map::new(), &json!({"k": 1}).as_object().unwrap().clone()).unwrap();
        let mode = std::fs::metadata(d.join("secrets.json")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn arquivo_corrompido_vira_vazio() {
        let d = tmp("ruim");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("settings.json"), "{ não é json").unwrap();
        let got = load_from(&d);
        assert!(!got.exists && got.values.is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn gravacao_substitui_sem_deixar_temporario() {
        let d = tmp("tmp");
        save_to(&d, &json!({"a": 1}).as_object().unwrap().clone(), &Map::new()).unwrap();
        save_to(&d, &json!({"a": 2}).as_object().unwrap().clone(), &Map::new()).unwrap();
        assert_eq!(load_from(&d).values["a"], 2);
        assert!(!d.join("settings.tmp").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
