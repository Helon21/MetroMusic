//! Discord Rich Presence pelo IPC local do aplicativo do Discord (socket `discord-ipc-N`; named pipe no Windows).
//! Não usa login nem token: o Discord aberto no mesmo computador aceita a atividade de qualquer aplicativo
//! registrado, identificado pelo "ID do aplicativo" (criado em discord.com/developers).
//! Protocolo: quadros `[opcode u32 LE][tamanho u32 LE][JSON]`; opcode 0 = handshake, 1 = comando.

use crate::model::Res;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Presence {
    pub app_id: String,
    /// `playing` · `listening` · `watching` · `competing`
    pub kind: String,
    pub name: Option<String>,
    pub details: Option<String>,
    pub state: Option<String>,
    /// Instantes em milissegundos desde 1970 (convertidos para segundos ao enviar). Com `end_ms` o Discord mostra a barra de progresso.
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    /// Até dois botões `(rótulo, https://…)`.
    pub buttons: Vec<(String, String)>,
}

fn activity_type(kind: &str) -> u8 {
    match kind { "playing" => 0, "watching" => 3, "competing" => 5, _ => 2 }
}

/// O Discord exige de 2 a 128 caracteres nos textos; menos que isso a atividade é rejeitada.
fn text(s: &Option<String>) -> Option<String> {
    let t = s.as_deref()?.trim();
    if t.chars().count() < 2 { return None; }
    Some(t.chars().take(128).collect())
}

pub fn activity_json(p: &Presence) -> Value {
    // status_display_type 1 = mostrar o campo `details` (título) na lista de membros, como o MetroFuse faz
    let mut a = json!({ "type": activity_type(&p.kind), "instance": false, "status_display_type": 1 });
    if let Some(n) = text(&p.name) { a["name"] = json!(n); }
    if let Some(d) = text(&p.details) { a["details"] = json!(d); }
    if let Some(s) = text(&p.state) { a["state"] = json!(s); }
    let mut ts = serde_json::Map::new();
    // o Discord espera segundos; com milissegundos ele recusa a atividade ("Unknown Error")
    if let Some(s) = p.start_ms { ts.insert("start".into(), json!(s / 1000)); }
    if let Some(e) = p.end_ms { ts.insert("end".into(), json!(e / 1000)); }
    if !ts.is_empty() { a["timestamps"] = Value::Object(ts); }
    let mut assets = serde_json::Map::new();
    if let Some(i) = p.large_image.as_deref().filter(|i| !i.is_empty()) { assets.insert("large_image".into(), json!(i)); }
    if let Some(t) = text(&p.large_text) { assets.insert("large_text".into(), json!(t)); }
    if !assets.is_empty() { a["assets"] = Value::Object(assets); }
    // só botões com rótulo e URL https válidos; o Discord aceita no máximo dois
    let buttons: Vec<Value> = p.buttons.iter().filter(|(l, u)| !l.trim().is_empty() && u.starts_with("https://")).take(2)
        .map(|(l, u)| json!({ "label": l.chars().take(32).collect::<String>(), "url": u })).collect();
    if !buttons.is_empty() { a["buttons"] = json!(buttons); }
    a
}

pub fn frame(op: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

pub fn read_frame(r: &mut impl Read) -> Res<(u32, Value)> {
    let mut head = [0u8; 8];
    r.read_exact(&mut head).map_err(|e| format!("o Discord não respondeu: {e}"))?;
    let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 { return Err("resposta do Discord grande demais".into()); }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).map_err(|e| format!("o Discord não respondeu: {e}"))?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Onde o Discord (ou Flatpak/Snap) deixa o socket, em ordem de preferência.
pub fn socket_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    for var in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] { if let Ok(d) = std::env::var(var) { dirs.push(d.into()); } }
    dirs.push("/tmp".into());
    let base = dirs.clone();
    for d in base {
        dirs.push(d.join("app/com.discordapp.Discord"));
        dirs.push(d.join("snap.discord"));
    }
    let mut out = vec![];
    for d in dirs { for n in 0..10 { out.push(d.join(format!("discord-ipc-{n}"))); } }
    out
}

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(unix)]
fn open_stream(path: &std::path::Path) -> std::io::Result<Stream> {
    let s = Stream::connect(path)?;
    s.set_read_timeout(Some(Duration::from_secs(3)))?;
    s.set_write_timeout(Some(Duration::from_secs(5)))?;
    Ok(s)
}
#[cfg(not(unix))]
type Stream = std::fs::File;
#[cfg(not(unix))]
fn open_stream(path: &std::path::Path) -> std::io::Result<Stream> { std::fs::OpenOptions::new().read(true).write(true).open(path) }

#[cfg(unix)]
fn set_read_timeout(s: &Stream, d: Duration) { let _ = s.set_read_timeout(Some(d)); }
#[cfg(not(unix))]
fn set_read_timeout(_: &Stream, _: Duration) {}

pub struct Conn { stream: Stream, pub app_id: String, nonce: u64 }

impl Conn {
    pub fn open(path: &std::path::Path, app_id: &str) -> Res<Conn> {
        let mut stream = open_stream(path).map_err(|e| format!("não achei o Discord aberto: {e}"))?;
        stream.write_all(&frame(0, &json!({ "v": 1, "client_id": app_id }))).map_err(|e| e.to_string())?;
        // Com um ID inexistente o Discord leva ~10 s para recusar (consulta o aplicativo antes de responder).
        set_read_timeout(&stream, Duration::from_secs(20));
        let (op, ready) = read_frame(&mut stream)?;
        // recusa: quadro de fechamento (opcode 2) com {"code":4000,"message":"Invalid Client ID"}, ou evento ERROR
        if op == 2 || ready.get("evt").and_then(|e| e.as_str()) == Some("ERROR") {
            let m = ready.get("message").or_else(|| ready.pointer("/data/message")).and_then(|m| m.as_str()).unwrap_or("recusado");
            return Err(format!("o Discord recusou o ID do aplicativo: {m}"));
        }
        set_read_timeout(&stream, Duration::from_secs(10));
        Ok(Conn { stream, app_id: app_id.to_string(), nonce: 0 })
    }

    /// `None` limpa a atividade.
    pub fn set_activity(&mut self, activity: Option<&Value>) -> Res<()> {
        self.nonce += 1;
        let cmd = json!({ "cmd": "SET_ACTIVITY", "nonce": self.nonce.to_string(), "args": { "pid": std::process::id(), "activity": activity } });
        self.stream.write_all(&frame(1, &cmd)).map_err(|e| e.to_string())?;
        // Sem resposta = o Discord limitou as atualizações (cerca de 5 a cada 20 s); a conexão fica fora de sincronia e é refeita depois.
        let (_, resp) = read_frame(&mut self.stream).map_err(|_| "o Discord não respondeu (limite de atualizações); tentando de novo em instantes".to_string())?;
        if resp.get("evt").and_then(|e| e.as_str()) == Some("ERROR") {
            return Err(format!("o Discord recusou a atividade: {}", resp.pointer("/data/message").and_then(|m| m.as_str()).unwrap_or("erro")));
        }
        Ok(())
    }
}

static CONN: Lazy<Mutex<Option<Conn>>> = Lazy::new(|| Mutex::new(None));

fn connect(app_id: &str) -> Res<Conn> {
    let mut last = "não achei o Discord aberto".to_string();
    for p in socket_candidates() {
        if !p.exists() { continue; }
        match Conn::open(&p, app_id) { Ok(c) => return Ok(c), Err(e) => last = e }
    }
    Err(last)
}

/// Envia (ou, com `None`, limpa) a atividade; reconecta uma vez se o Discord foi reiniciado.
pub fn update(p: Option<&Presence>) -> Res<()> {
    let mut guard = CONN.lock();
    let Some(p) = p else {
        if let Some(c) = guard.as_mut() { if c.set_activity(None).is_err() { *guard = None; } }
        return Ok(());
    };
    if p.app_id.trim().is_empty() { return Err("Informe o ID do aplicativo do Discord (Configurações › Discord › Avançado).".into()); }
    let activity = activity_json(p);
    for attempt in 0..2 {
        if guard.as_ref().map(|c| c.app_id != p.app_id).unwrap_or(true) { *guard = Some(connect(&p.app_id)?); }
        match guard.as_mut().unwrap().set_activity(Some(&activity)) {
            Ok(()) => return Ok(()),
            Err(e) => { *guard = None; if attempt == 1 { return Err(e); } }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn discord_set(presence: Option<Presence>) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || update(presence.as_ref())).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Presence {
        Presence { app_id: "123".into(), kind: "listening".into(), details: Some("Sombra de Papel".into()), state: Some("Kaito Norte".into()), start_ms: Some(1_000_000), end_ms: Some(1_180_000),
            large_image: Some("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg".into()), large_text: Some("Álbum".into()), buttons: vec![("Ouvir".into(), "https://music.youtube.com/watch?v=dQw4w9WgXcQ".into())], ..Default::default() }
    }

    #[test]
    fn atividade_completa() {
        let a = activity_json(&base());
        assert_eq!(a["type"], 2);
        assert_eq!(a["details"], "Sombra de Papel");
        assert_eq!(a["state"], "Kaito Norte");
        // em segundos, não em milissegundos
        assert_eq!((a["timestamps"]["start"].as_u64(), a["timestamps"]["end"].as_u64()), (Some(1000), Some(1180)));
        assert_eq!(a["status_display_type"], 1);
        assert_eq!(a["assets"]["large_image"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
        assert_eq!(a["buttons"][0]["label"], "Ouvir");
    }

    #[test]
    fn tipos_de_atividade() {
        for (k, n) in [("playing", 0), ("listening", 2), ("watching", 3), ("competing", 5), ("qualquer", 2)] {
            assert_eq!(activity_json(&Presence { kind: k.into(), ..Default::default() })["type"], n, "{k}");
        }
    }

    #[test]
    fn regras_do_discord_para_textos_e_botoes() {
        let mut p = base();
        p.details = Some("a".into());                 // menos de 2 caracteres: some
        p.state = Some("x".repeat(300));              // mais de 128: corta
        p.buttons = vec![("Sem url".into(), "http://inseguro".into()), ("".into(), "https://a".into()), ("1".into(), "https://1".into()), ("2".into(), "https://2".into()), ("3".into(), "https://3".into())];
        let a = activity_json(&p);
        assert!(a.get("details").is_none());
        assert_eq!(a["state"].as_str().unwrap().chars().count(), 128);
        let b = a["buttons"].as_array().unwrap();
        assert_eq!(b.len(), 2); // só https, com rótulo, no máximo dois
        assert_eq!(b[0]["label"], "1");
    }

    #[test]
    fn quadro_tem_cabecalho_correto() {
        let f = frame(1, &json!({"a": 1}));
        assert_eq!(&f[0..4], &1u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(f[4..8].try_into().unwrap()) as usize, f.len() - 8);
        let (op, v) = read_frame(&mut &f[..]).unwrap();
        assert_eq!((op, v["a"].as_i64()), (1, Some(1)));
    }

    /// Servidor que imita o Discord: aceita o handshake e a atividade, e guarda o que recebeu.
    #[cfg(unix)]
    #[test]
    fn fala_o_protocolo_com_um_discord_falso() {
        use std::os::unix::net::UnixListener;
        let dir = std::env::temp_dir().join(format!("mm-discord-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("discord-ipc-0");
        let _ = std::fs::remove_file(&path);
        let l = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let (op, hello) = read_frame(&mut s).unwrap();
            assert_eq!(op, 0);
            s.write_all(&frame(1, &json!({"cmd": "DISPATCH", "evt": "READY", "data": {"v": 1}}))).unwrap();
            let mut got = vec![];
            for _ in 0..2 {
                let (op, cmd) = read_frame(&mut s).unwrap();
                assert_eq!(op, 1);
                s.write_all(&frame(1, &json!({"cmd": "SET_ACTIVITY", "evt": null, "nonce": cmd["nonce"]}))).unwrap();
                got.push(cmd);
            }
            (hello, got)
        });
        let mut c = Conn::open(&path, "999").unwrap();
        c.set_activity(Some(&activity_json(&base()))).unwrap();
        c.set_activity(None).unwrap(); // limpar
        let (hello, got) = server.join().unwrap();
        assert_eq!((hello["v"].as_i64(), hello["client_id"].as_str()), (Some(1), Some("999")));
        assert_eq!(got[0]["cmd"], "SET_ACTIVITY");
        assert_eq!(got[0]["args"]["activity"]["details"], "Sombra de Papel");
        assert!(got[1]["args"]["activity"].is_null());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn id_recusado_vira_erro_claro() {
        use std::os::unix::net::UnixListener;
        let dir = std::env::temp_dir().join(format!("mm-discord-err-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("discord-ipc-0");
        let _ = std::fs::remove_file(&path);
        let l = UnixListener::bind(&path).unwrap();
        std::thread::spawn(move || { let (mut s, _) = l.accept().unwrap(); let _ = read_frame(&mut s); let _ = s.write_all(&frame(2, &json!({"code": 4000, "message": "Invalid Client ID"}))); });
        let e = Conn::open(&path, "0").err().unwrap();
        assert!(e.contains("recusou o ID") && e.contains("Invalid Client ID"), "{e}");
        assert!(Conn::open(&dir.join("nao-existe"), "0").err().unwrap().contains("Discord aberto"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Discord de verdade: `MM_DISCORD_APP_ID=<id> cargo test net_discord -- --ignored --nocapture`.
    /// Mostra tocando (com barra de progresso), pausado (sem tempos, com o tempo no texto) e limpa; confira no perfil.
    #[test]
    #[ignore]
    fn net_discord_real() {
        let id = std::env::var("MM_DISCORD_APP_ID").unwrap_or_else(|_| "1569743605659074601".into());
        let now = crate::model::now_ms() as u64;
        let mut p = base(); p.app_id = id;
        p.start_ms = Some(now - 83_000); p.end_ms = Some(now - 83_000 + 180_000);
        update(Some(&p)).expect("tocando enviado");
        println!("DISCORD tocando em 1:23 de 3:00");
        std::thread::sleep(Duration::from_secs(8));
        p.start_ms = None; p.end_ms = None; p.state = Some("⏸ Pausado em 1:31 de 3:00 · Kaito Norte".into());
        update(Some(&p)).expect("pausado enviado");
        println!("DISCORD pausado em 1:31");
        std::thread::sleep(Duration::from_secs(8));
        update(None).expect("atividade limpa");
        println!("DISCORD limpo");
    }
}
