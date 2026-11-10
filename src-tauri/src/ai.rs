//! Tradução de letras por IA. A chave fica no arquivo de segredos e a chamada sai do Rust (sem CORS).
//! Provedores: compatíveis com OpenAI (OpenRouter, OpenAI, Perplexity, xAI, Mistral, personalizado), Claude, Gemini e DeepL.
//! Origem no MetroFuse: `LyricsTranslationHelper.kt` e `api/{OpenRouter,Mistral,DeepL}Service.kt`.

use crate::http::CLIENT;
use crate::model::Res;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub provider: String, pub base_url: String, pub key: String, pub model: String,
    /// `literal` traduz o sentido; `transcribed` converte a pronúncia para o alfabeto do destino.
    pub mode: String,
    /// Código do idioma de destino (`pt-BR`, `en`…).
    pub target: String,
    pub formality: String, pub prompt: String,
}

pub const DEFAULT_PROMPT: &str = "You translate song lyrics. Translate each of the {lineCount} lines the user sends into the target language, keeping the meaning, tone and rhythm. Keep the same order and exactly {lineCount} lines. Reply with ONLY a JSON array of {lineCount} strings and nothing else.";
const TRANSCRIBE_PROMPT: &str = "You transcribe song lyrics. Write each of the {lineCount} lines the user sends the way it is pronounced, using the writing system of the target language, without translating the meaning. Keep the same order and exactly {lineCount} lines. Reply with ONLY a JSON array of {lineCount} strings and nothing else.";
/// Linhas por pedido: letras longas são divididas para respeitar o limite de resposta dos modelos.
pub const CHUNK: usize = 60;

pub fn language_name(code: &str) -> &'static str {
    match code.split('-').next().unwrap_or("") {
        "pt" => "Brazilian Portuguese", "en" => "English", "es" => "Spanish", "fr" => "French", "de" => "German", "ja" => "Japanese", _ => "English",
    }
}

fn default_base(provider: &str) -> &'static str {
    match provider {
        "openrouter" => "https://openrouter.ai/api/v1", "openai" => "https://api.openai.com/v1", "perplexity" => "https://api.perplexity.ai",
        "xai" => "https://api.x.ai/v1", "mistral" => "https://api.mistral.ai/v1", "claude" => "https://api.anthropic.com/v1", _ => "",
    }
}

fn system_prompt(cfg: &Config, n: usize) -> String {
    let base = if !cfg.prompt.trim().is_empty() { cfg.prompt.as_str() } else if cfg.mode == "transcribed" { TRANSCRIBE_PROMPT } else { DEFAULT_PROMPT };
    format!("{} Target language: {}.", base.replace("{lineCount}", &n.to_string()), language_name(&cfg.target))
}

/// Pedido HTTP pronto: URL, cabeçalhos extras e corpo JSON.
#[derive(Debug)]
pub struct Req { pub url: String, pub headers: Vec<(String, String)>, pub body: Value }

pub fn build_request(cfg: &Config, lines: &[String]) -> Res<Req> {
    if cfg.key.trim().is_empty() { return Err("Informe a chave da API em Configurações › Tradução por IA.".into()); }
    let p = cfg.provider.as_str();
    let base = if cfg.base_url.trim().is_empty() { default_base(p).to_string() } else { cfg.base_url.trim().trim_end_matches('/').to_string() };
    let sys = system_prompt(cfg, lines.len());
    let user = serde_json::to_string(lines).map_err(|e| e.to_string())?;
    match p {
        "deepl" => {
            let host = if cfg.key.ends_with(":fx") { "https://api-free.deepl.com" } else { "https://api.deepl.com" };
            let url = if cfg.base_url.trim().is_empty() { format!("{host}/v2/translate") } else { format!("{base}/v2/translate") };
            let mut body = json!({ "text": lines, "target_lang": deepl_lang(&cfg.target) });
            match cfg.formality.as_str() { "more" => body["formality"] = json!("prefer_more"), "less" => body["formality"] = json!("prefer_less"), _ => {} }
            Ok(Req { url, headers: vec![("Authorization".into(), format!("DeepL-Auth-Key {}", cfg.key))], body })
        }
        "claude" => {
            if cfg.model.trim().is_empty() { return Err("Informe o modelo (ex.: claude-haiku-5-5).".into()); }
            Ok(Req { url: format!("{base}/messages"), headers: vec![("x-api-key".into(), cfg.key.clone()), ("anthropic-version".into(), "2023-06-01".into())],
                body: json!({ "model": cfg.model, "max_tokens": 4096, "system": sys, "messages": [{ "role": "user", "content": user }] }) })
        }
        "gemini" => {
            if cfg.model.trim().is_empty() { return Err("Informe o modelo (ex.: gemini-2.5-flash).".into()); }
            let root = if cfg.base_url.trim().is_empty() { "https://generativelanguage.googleapis.com/v1beta".to_string() } else { base };
            Ok(Req { url: format!("{root}/models/{}:generateContent", cfg.model), headers: vec![("x-goog-api-key".into(), cfg.key.clone())],
                body: json!({ "systemInstruction": { "parts": [{ "text": sys }] }, "contents": [{ "role": "user", "parts": [{ "text": user }] }] }) })
        }
        _ => {
            if base.is_empty() { return Err("Informe a URL base do provedor personalizado.".into()); }
            if cfg.model.trim().is_empty() { return Err("Informe o modelo do provedor.".into()); }
            Ok(Req { url: format!("{base}/chat/completions"), headers: vec![("Authorization".into(), format!("Bearer {}", cfg.key))],
                body: json!({ "model": cfg.model, "temperature": 0.2, "messages": [{ "role": "system", "content": sys }, { "role": "user", "content": user }] }) })
        }
    }
}

fn deepl_lang(code: &str) -> String {
    match code { "pt-BR" => "PT-BR".into(), "pt" => "PT-PT".into(), "en" => "EN-US".into(), c => c.split('-').next().unwrap_or("EN").to_ascii_uppercase() }
}

/// Tira cercas de código e acha o primeiro array JSON no texto do modelo.
pub fn extract_array(text: &str) -> Option<Vec<String>> {
    let t = text.trim();
    let start = t.find('[')?; let end = t.rfind(']')?;
    if end < start { return None; }
    let v: Value = serde_json::from_str(&t[start..=end]).ok()?;
    v.as_array()?.iter().map(|x| x.as_str().map(str::to_string)).collect()
}

/// Lê a resposta de cada tipo de provedor e devolve exatamente `n` linhas.
pub fn parse_response(cfg: &Config, resp: &Value, n: usize) -> Res<Vec<String>> {
    let lines: Option<Vec<String>> = match cfg.provider.as_str() {
        "deepl" => resp.get("translations").and_then(|t| t.as_array()).map(|a| a.iter().map(|x| x.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string()).collect()),
        "claude" => resp.pointer("/content/0/text").and_then(|t| t.as_str()).and_then(extract_array),
        "gemini" => resp.pointer("/candidates/0/content/parts/0/text").and_then(|t| t.as_str()).and_then(extract_array),
        _ => resp.pointer("/choices/0/message/content").and_then(|t| t.as_str()).and_then(extract_array),
    };
    let lines = lines.ok_or_else(|| {
        let msg = resp.pointer("/error/message").and_then(|m| m.as_str()).or_else(|| resp.get("message").and_then(|m| m.as_str()));
        msg.map(|m| format!("o provedor respondeu: {m}")).unwrap_or_else(|| "a resposta do modelo não veio no formato esperado".into())
    })?;
    if lines.len() != n { return Err(format!("o modelo devolveu {} linhas em vez de {n}", lines.len())); }
    Ok(lines)
}

async fn call(cfg: &Config, lines: &[String]) -> Res<Vec<String>> {
    let req = build_request(cfg, lines)?;
    let mut r = CLIENT.post(&req.url).timeout(std::time::Duration::from_secs(90)).json(&req.body);
    for (k, v) in &req.headers { r = r.header(k, v); }
    let resp = r.send().await.map_err(|e| format!("sem conexão com o provedor: {e}"))?;
    let status = resp.status();
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let m = json.pointer("/error/message").and_then(|m| m.as_str()).or_else(|| json.get("message").and_then(|m| m.as_str())).unwrap_or("");
        return Err(match status.as_u16() { 401 | 403 => format!("chave recusada pelo provedor (HTTP {status}) {m}"), 429 => format!("limite do provedor atingido (HTTP 429) {m}"), _ => format!("o provedor respondeu HTTP {status} {m}") }.trim().to_string());
    }
    parse_response(cfg, &json, lines.len())
}

/// Traduz todas as linhas, em blocos de `CHUNK`. Linhas vazias não vão ao modelo e voltam vazias.
pub async fn translate(cfg: &Config, lines: &[String]) -> Res<Vec<String>> {
    let idx: Vec<usize> = lines.iter().enumerate().filter(|(_, l)| !l.trim().is_empty()).map(|(i, _)| i).collect();
    let mut out = vec![String::new(); lines.len()];
    for chunk in idx.chunks(CHUNK) {
        let part: Vec<String> = chunk.iter().map(|&i| lines[i].clone()).collect();
        let done = call(cfg, &part).await?;
        for (&i, t) in chunk.iter().zip(done) { out[i] = t; }
    }
    Ok(out)
}

#[tauri::command]
pub async fn ai_translate(config: Config, lines: Vec<String>) -> Res<Vec<String>> { translate(&config, &lines).await }

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn cfg(p: &str) -> Config { Config { provider: p.into(), key: "k".into(), model: "m".into(), target: "pt-BR".into(), mode: "literal".into(), ..Default::default() } }
    fn lines() -> Vec<String> { vec!["hello".into(), "world".into()] }

    #[test]
    fn extrai_array_de_texto_sujo() {
        assert_eq!(extract_array("[\"a\",\"b\"]").unwrap(), vec!["a", "b"]);
        assert_eq!(extract_array("Claro!\n```json\n[\"a\", \"b\"]\n```").unwrap(), vec!["a", "b"]);
        assert!(extract_array("sem array").is_none());
        assert!(extract_array("[1, 2]").is_none());
    }

    #[test]
    fn pedido_compativel_com_openai() {
        let r = build_request(&cfg("openrouter"), &lines()).unwrap();
        assert_eq!(r.url, "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(r.headers[0], ("Authorization".into(), "Bearer k".into()));
        let sys = r.body["messages"][0]["content"].as_str().unwrap();
        assert!(sys.contains("2 lines") && sys.contains("Brazilian Portuguese") && !sys.contains("{lineCount}"));
        assert_eq!(r.body["messages"][1]["content"], "[\"hello\",\"world\"]");
        // URL base própria e prompt personalizado
        let mut c = cfg("custom"); c.base_url = "http://localhost:1234/v1/".into(); c.prompt = "Traduza {lineCount} linhas.".into();
        let r = build_request(&c, &lines()).unwrap();
        assert_eq!(r.url, "http://localhost:1234/v1/chat/completions");
        assert!(r.body["messages"][0]["content"].as_str().unwrap().starts_with("Traduza 2 linhas."));
    }

    #[test]
    fn modo_transcricao_usa_o_prompt_de_pronuncia() {
        let mut c = cfg("openai"); c.mode = "transcribed".into();
        assert!(build_request(&c, &lines()).unwrap().body["messages"][0]["content"].as_str().unwrap().contains("pronounced"));
    }

    #[test]
    fn claude_gemini_e_deepl() {
        let r = build_request(&cfg("claude"), &lines()).unwrap();
        assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
        assert!(r.headers.iter().any(|h| h.0 == "anthropic-version"));
        assert!(r.body["system"].as_str().unwrap().contains("2 lines"));
        let r = build_request(&cfg("gemini"), &lines()).unwrap();
        assert_eq!(r.url, "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent");
        let mut d = cfg("deepl"); d.key = "abc:fx".into(); d.formality = "more".into();
        let r = build_request(&d, &lines()).unwrap();
        assert_eq!(r.url, "https://api-free.deepl.com/v2/translate");
        assert_eq!((r.body["target_lang"].as_str().unwrap(), r.body["formality"].as_str().unwrap()), ("PT-BR", "prefer_more"));
        d.key = "pago".into();
        assert_eq!(build_request(&d, &lines()).unwrap().url, "https://api.deepl.com/v2/translate");
    }

    #[test]
    fn configuracao_incompleta_da_erro_claro() {
        let mut c = cfg("openai"); c.key = " ".into();
        assert!(build_request(&c, &lines()).unwrap_err().contains("chave"));
        let mut c = cfg("openai"); c.model = "".into();
        assert!(build_request(&c, &lines()).unwrap_err().contains("modelo"));
        let mut c = cfg("custom"); c.base_url = "".into();
        assert!(build_request(&c, &lines()).unwrap_err().contains("URL base"));
    }

    #[test]
    fn le_respostas_de_cada_provedor() {
        let oa = json!({"choices": [{"message": {"content": "[\"olá\",\"mundo\"]"}}]});
        assert_eq!(parse_response(&cfg("openai"), &oa, 2).unwrap(), vec!["olá", "mundo"]);
        let cl = json!({"content": [{"type": "text", "text": "```json\n[\"olá\",\"mundo\"]\n```"}]});
        assert_eq!(parse_response(&cfg("claude"), &cl, 2).unwrap(), vec!["olá", "mundo"]);
        let ge = json!({"candidates": [{"content": {"parts": [{"text": "[\"olá\",\"mundo\"]"}]}}]});
        assert_eq!(parse_response(&cfg("gemini"), &ge, 2).unwrap(), vec!["olá", "mundo"]);
        let dl = json!({"translations": [{"text": "olá"}, {"text": "mundo"}]});
        assert_eq!(parse_response(&cfg("deepl"), &dl, 2).unwrap(), vec!["olá", "mundo"]);
        // quantidade errada e erro do provedor
        assert!(parse_response(&cfg("openai"), &oa, 3).unwrap_err().contains("2 linhas em vez de 3"));
        assert!(parse_response(&cfg("openai"), &json!({"error": {"message": "cota"}}), 2).unwrap_err().contains("cota"));
    }

    /// Servidor local que responde como um provedor compatível com OpenAI, para testar o fluxo inteiro.
    async fn fake_openai(handler: fn(usize) -> (u16, String)) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            let mut n = 0usize;
            loop {
                let Ok((mut s, _)) = l.accept().await else { break };
                let mut buf = vec![0u8; 65536]; let mut got = 0;
                loop { let k = s.read(&mut buf[got..]).await.unwrap_or(0); got += k; if k == 0 || String::from_utf8_lossy(&buf[..got]).contains("\r\n\r\n") && got > 200 { break; } }
                let (code, body) = handler(n); n += 1;
                let _ = s.write_all(format!("HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn traduz_ponta_a_ponta_pulando_linhas_vazias() {
        let base = fake_openai(|_| (200, json!({"choices": [{"message": {"content": "[\"UM\",\"DOIS\"]"}}]}).to_string())).await;
        let mut c = cfg("custom"); c.base_url = base;
        let out = translate(&c, &["one".into(), "".into(), "two".into()]).await.unwrap();
        assert_eq!(out, vec!["UM", "", "DOIS"]);
    }

    #[tokio::test]
    async fn erros_http_viram_mensagens_em_portugues() {
        let base = fake_openai(|_| (401, json!({"error": {"message": "bad key"}}).to_string())).await;
        let mut c = cfg("custom"); c.base_url = base;
        let e = translate(&c, &["x".into()]).await.unwrap_err();
        assert!(e.contains("chave recusada") && e.contains("bad key"), "{e}");
        let base = fake_openai(|_| (429, "{}".into())).await;
        let mut c = cfg("custom"); c.base_url = base;
        assert!(translate(&c, &["x".into()]).await.unwrap_err().contains("limite"));
    }

    #[tokio::test]
    async fn letra_longa_vai_em_blocos() {
        // cada resposta devolve o número certo de linhas para o bloco pedido: 60 + 15
        let base = fake_openai(|n| { let k = if n == 0 { 60 } else { 15 }; (200, json!({"choices": [{"message": {"content": serde_json::to_string(&vec!["t"; k]).unwrap()}}]}).to_string()) }).await;
        let mut c = cfg("custom"); c.base_url = base;
        let lines: Vec<String> = (0..75).map(|i| format!("linha {i}")).collect();
        let out = translate(&c, &lines).await.unwrap();
        assert_eq!(out.len(), 75);
        assert!(out.iter().all(|l| l == "t"));
    }
}
