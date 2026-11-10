//! Mantém a tela ligada e o computador acordado enquanto o Tocando agora está aberto (Configurações › Sistema).
//! No Linux usa o inibidor do systemd/logind; no Windows e no macOS, as chamadas próprias do sistema.

use crate::model::Res;
use once_cell::sync::Lazy;
use parking_lot::Mutex;

static HOLD: Lazy<Mutex<Option<keepawake::KeepAwake>>> = Lazy::new(|| Mutex::new(None));

pub fn set(on: bool) -> Res<()> {
    let mut g = HOLD.lock();
    if !on { *g = None; return Ok(()); } // soltar o objeto devolve o controle ao sistema
    if g.is_some() { return Ok(()); }
    let k = keepawake::Builder::default()
        .display(true).idle(true).sleep(false)
        .reason("Tocando agora aberto").app_name("MetroMusic").app_reverse_domain("dev.caduhd4.metromusic")
        .create().map_err(|e| format!("não consegui manter a tela ligada: {e}"))?;
    *g = Some(k);
    Ok(())
}

pub fn active() -> bool { HOLD.lock().is_some() }

#[tauri::command]
pub fn keep_awake_set(on: bool) -> Res<()> { set(on) }

#[cfg(test)]
mod tests {
    use super::*;

    /// Precisa de uma sessão do sistema (logind no Linux); por isso roda só com `--ignored`.
    #[test]
    #[ignore]
    fn net_inibidor_aparece_no_sistema() {
        set(true).expect("ligar");
        assert!(active());
        std::thread::sleep(std::time::Duration::from_millis(500));
        let out = String::from_utf8_lossy(&std::process::Command::new("systemd-inhibit").arg("--list").output().unwrap().stdout).to_string();
        println!("{out}");
        let listed = out.contains("MetroMusic");
        set(false).unwrap();
        assert!(!active());
        assert!(listed, "o inibidor do MetroMusic deveria aparecer em systemd-inhibit --list");
        std::thread::sleep(std::time::Duration::from_millis(500));
        let after = String::from_utf8_lossy(&std::process::Command::new("systemd-inhibit").arg("--list").output().unwrap().stdout).to_string();
        assert!(!after.contains("MetroMusic"), "o inibidor deveria sumir ao desligar");
    }
}
