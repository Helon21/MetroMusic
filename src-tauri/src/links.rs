//! Abrir endereços no navegador (ou no app padrão) do sistema: compartilhar por WhatsApp, Telegram e e-mail.

use crate::model::Res;

/// Só `https` e `mailto`: nunca `file:`, `javascript:` nem programas locais.
pub fn allowed(url: &str) -> bool {
    let u = url.trim();
    u.len() <= 4000 && !u.contains(['\n', '\r', '\0']) && (u.starts_with("https://") || u.starts_with("mailto:"))
}

#[tauri::command]
pub fn open_url(url: String) -> Res<()> {
    if !allowed(&url) { return Err("só endereços https e e-mail podem ser abertos".into()); }
    open::that(url.trim()).map_err(|e| format!("não consegui abrir: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_https_e_mailto() {
        assert!(allowed("https://music.youtube.com/watch?v=abc"));
        assert!(allowed("https://wa.me/?text=oi%20mundo"));
        assert!(allowed("mailto:?subject=Oi&body=https%3A%2F%2Fx"));
        for ruim in ["http://x", "file:///etc/passwd", "javascript:alert(1)", "ftp://x", "/usr/bin/xterm", "", "https://x\nfile:///etc/passwd", "data:text/html,x"] {
            assert!(!allowed(ruim), "{ruim:?}");
        }
        assert!(!allowed(&format!("https://x/{}", "a".repeat(5000))));
        assert!(open_url("file:///etc/passwd".into()).is_err());
    }
}
