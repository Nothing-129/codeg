//! Grok sidebar titles: first-line heuristic, then a locale-matched CLI refine.
//!
//! Grok's own `generated_title` is English-biased and lives in a separate
//! prompt from `~/.grok/AGENTS.md`, so we do not use it. New chats get the
//! first user line immediately; a low-effort `grok -p` then replaces that
//! with a short title in the app UI language. Manual rename (`title_locked`)
//! always wins.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use sea_orm::DatabaseConnection;

use crate::db::service::conversation_service;
use crate::models::system::{AppLocale, LanguageMode, SystemLanguageSettings};
use crate::models::{ContentBlock, MessageTurn, TurnRole};
use crate::parsers::fold_reference_links;
use crate::web::event_bridge::EventEmitter;

const HEURISTIC_MAX_CHARS: usize = 28;
const LLM_TITLE_MAX_CHARS: usize = 32;
const LLM_SNIPPET_MAX_CHARS: usize = 400;
const LLM_TIMEOUT: Duration = Duration::from_secs(45);
const TITLE_SCRATCH_DIR_NAME: &str = "grok-title-scratch";

const PLACEHOLDERS: &[&str] = &[
    "New chat",
    "新会话",
    "新对话",
    "新對話",
    "Untitled",
    "未命名",
    "New conversation",
    "新建会话",
    "(Untitled)",
];

/// Locales we write a dedicated title prompt for. Mirrors `AppLocale`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleLocale {
    En,
    Zh,
    ZhTw,
    Ja,
    Ko,
    Es,
    De,
    Fr,
    Pt,
    Ar,
}

impl TitleLocale {
    pub fn from_app_locale(locale: AppLocale) -> Self {
        match locale {
            AppLocale::En => TitleLocale::En,
            AppLocale::ZhCn => TitleLocale::Zh,
            AppLocale::ZhTw => TitleLocale::ZhTw,
            AppLocale::Ja => TitleLocale::Ja,
            AppLocale::Ko => TitleLocale::Ko,
            AppLocale::Es => TitleLocale::Es,
            AppLocale::De => TitleLocale::De,
            AppLocale::Fr => TitleLocale::Fr,
            AppLocale::Pt => TitleLocale::Pt,
            AppLocale::Ar => TitleLocale::Ar,
        }
    }

    /// Map a BCP-47 / POSIX language tag to a title locale.
    pub fn from_lang_tag(raw: &str) -> Option<Self> {
        let bare = raw
            .trim()
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .replace('_', "-");
        if bare.is_empty() || bare == "c" || bare == "posix" {
            return None;
        }
        let primary = bare.split('-').next().unwrap_or("");
        match primary {
            "zh" => {
                let trad = bare
                    .split('-')
                    .any(|p| p == "hant" || p == "tw" || p == "hk" || p == "mo");
                Some(if trad {
                    TitleLocale::ZhTw
                } else {
                    TitleLocale::Zh
                })
            }
            "en" => Some(TitleLocale::En),
            "ja" => Some(TitleLocale::Ja),
            "ko" => Some(TitleLocale::Ko),
            "es" => Some(TitleLocale::Es),
            "de" => Some(TitleLocale::De),
            "fr" => Some(TitleLocale::Fr),
            "pt" => Some(TitleLocale::Pt),
            "ar" => Some(TitleLocale::Ar),
            _ => None,
        }
    }
}

pub fn is_placeholder_title(title: &str) -> bool {
    let t = title.trim();
    t.is_empty() || PLACEHOLDERS.iter().any(|p| p.eq_ignore_ascii_case(t))
}

/// True when `cwd` is the isolated directory used for headless title jobs.
/// Those sessions must never appear in the sidebar.
pub fn is_grok_title_scratch_cwd(cwd: &str) -> bool {
    Path::new(cwd)
        .file_name()
        .is_some_and(|name| name == TITLE_SCRATCH_DIR_NAME)
}

/// The title-refine prompt itself, if it leaked into a session file.
pub fn is_title_refine_prompt(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("为下面这条用户消息起一个简短会话标题")
        || t.starts_with("為下面這則使用者訊息起一個簡短對話標題")
        || t.starts_with("Write a short session title for the user message")
        || t.starts_with("次のユーザーメッセージに短いセッションタイトル")
        || t.starts_with("다음 사용자 메시지에 짧은 세션 제목")
        || t.starts_with("Escribe un título de sesión corto")
        || t.starts_with("Schreibe einen kurzen Sitzungstitel")
        || t.starts_with("Écris un titre de session court")
        || t.starts_with("Escreva um título de sessão curto")
        || t.starts_with("اكتب عنوان جلسة قصير")
}

/// Offline title: first non-empty line, folded links, collapsed whitespace,
/// max ~28 display chars. Matches grok-app's instant heuristic.
pub fn heuristic_title(message: &str) -> String {
    let folded = fold_reference_links(message);
    let line = folded
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if line.is_empty() {
        return String::new();
    }
    let collapsed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, HEURISTIC_MAX_CHARS)
}

pub fn first_user_text_from_turns(turns: &[MessageTurn]) -> Option<String> {
    for turn in turns {
        if !matches!(turn.role, TurnRole::User) {
            continue;
        }
        let mut parts = Vec::new();
        for block in &turn.blocks {
            if let ContentBlock::Text { text } = block {
                let t = text.trim();
                if !t.is_empty() && !is_title_refine_prompt(t) {
                    parts.push(t);
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join(" "));
        }
    }
    None
}

pub fn title_seed_from_blocks(blocks: &[crate::acp::types::PromptInputBlock]) -> Option<String> {
    use crate::acp::types::PromptInputBlock;
    let joined = blocks
        .iter()
        .filter_map(|b| match b {
            PromptInputBlock::Text { text } => {
                let t = text.trim();
                (!t.is_empty()).then_some(t)
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Whether an unlocked title may still be replaced by heuristic / refine.
///
/// True for placeholders, the first-line heuristic, the 80-char create-row
/// seed, or any prefix of the first user message (the frontend slices to 80).
/// False for a later user message against an already-named conversation.
pub fn can_overwrite_auto_title(current: Option<&str>, first_message: &str) -> bool {
    let Some(current) = current.map(str::trim).filter(|t| !t.is_empty()) else {
        return true;
    };
    if is_placeholder_title(current) {
        return true;
    }
    let heuristic = heuristic_title(first_message);
    if !heuristic.is_empty() && current == heuristic {
        return true;
    }
    let folded = fold_reference_links(first_message);
    let collapsed: String = folded.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.starts_with(current) {
        return true;
    }
    let seed: String = collapsed.chars().take(80).collect();
    current == seed
}

pub fn resolve_title_locale(settings: &SystemLanguageSettings) -> TitleLocale {
    match settings.mode {
        LanguageMode::Manual => TitleLocale::from_app_locale(settings.language),
        LanguageMode::System => detect_os_title_locale()
            .unwrap_or_else(|| TitleLocale::from_app_locale(settings.language)),
    }
}

pub fn title_prompt(snippet: &str, locale: TitleLocale) -> String {
    match locale {
        TitleLocale::En => format!(
            "Write a short session title for the user message below.\n\
             Requirements: at most 8 English words (or match the message language if it is not English); \
             output the title only; no quotes, prefixes, or explanation.\n\n\
             User message:\n{snippet}"
        ),
        TitleLocale::Zh => format!(
            "为下面这条用户消息起一个简短会话标题。要求：最多16个汉字或8个英文单词；只输出标题；不要引号、标点前缀、解释。\n\n\
             用户消息：\n{snippet}"
        ),
        TitleLocale::ZhTw => format!(
            "為下面這則使用者訊息起一個簡短對話標題。要求：最多16個漢字或8個英文單詞；只輸出標題；不要引號、標點前綴、解釋。\n\n\
             使用者訊息：\n{snippet}"
        ),
        TitleLocale::Ja => format!(
            "次のユーザーメッセージに短いセッションタイトルを付けてください。要件：最大16文字；タイトルのみ出力；引用符・接頭辞・説明は不要。\n\n\
             ユーザーメッセージ：\n{snippet}"
        ),
        TitleLocale::Ko => format!(
            "다음 사용자 메시지에 짧은 세션 제목을 붙이세요. 요구사항: 최대 16자; 제목만 출력; 따옴표, 접두사, 설명 금지.\n\n\
             사용자 메시지:\n{snippet}"
        ),
        TitleLocale::Es => format!(
            "Escribe un título de sesión corto para el mensaje del usuario.\n\
             Requisitos: como máximo 8 palabras; solo el título; sin comillas, prefijos ni explicación.\n\n\
             Mensaje:\n{snippet}"
        ),
        TitleLocale::De => format!(
            "Schreibe einen kurzen Sitzungstitel für die folgende Nutzernachricht.\n\
             Anforderungen: höchstens 8 Wörter; nur den Titel ausgeben; keine Anführungszeichen, Prefixe oder Erklärungen.\n\n\
             Nutzernachricht:\n{snippet}"
        ),
        TitleLocale::Fr => format!(
            "Écris un titre de session court pour le message utilisateur ci-dessous.\n\
             Exigences : 8 mots maximum ; uniquement le titre ; pas de guillemets, préfixes ni explication.\n\n\
             Message :\n{snippet}"
        ),
        TitleLocale::Pt => format!(
            "Escreva um título de sessão curto para a mensagem do usuário abaixo.\n\
             Requisitos: no máximo 8 palavras; apenas o título; sem aspas, prefixos ou explicação.\n\n\
             Mensagem:\n{snippet}"
        ),
        TitleLocale::Ar => format!(
            "اكتب عنوان جلسة قصير لرسالة المستخدم أدناه.\n\
             المتطلبات: 8 كلمات كحد أقصى؛ العنوان فقط؛ بدون علامات اقتباس أو بادئات أو شرح.\n\n\
             رسالة المستخدم:\n{snippet}"
        ),
    }
}

pub fn clean_llm_title(raw: &str) -> Option<String> {
    let skip_line = |line: &str| -> bool {
        let l = line.trim();
        if l.is_empty() {
            return true;
        }
        let lower = l.to_ascii_lowercase();
        lower.starts_with("error:")
            || lower.starts_with("max turns")
            || lower.contains("max turns reached")
            || lower.starts_with("usage:")
            || lower.starts_with('{')
    };
    let mut t = raw
        .lines()
        .map(str::trim)
        .find(|l| !skip_line(l))?
        .to_string();
    for _ in 0..3 {
        if let Some(inner) = strip_wrapping_quotes(&t) {
            t = inner.to_string();
        } else {
            break;
        }
    }
    if let Some(rest) = t
        .strip_prefix("标题：")
        .or_else(|| t.strip_prefix("标题:"))
        .or_else(|| t.strip_prefix("標題："))
        .or_else(|| t.strip_prefix("標題:"))
        .or_else(|| t.strip_prefix("Title:"))
        .or_else(|| t.strip_prefix("Title："))
    {
        t = rest.trim().to_string();
    }
    if t.is_empty() || t.len() > 120 || is_placeholder_title(&t) || skip_line(&t) {
        return None;
    }
    Some(truncate_chars(&t, LLM_TITLE_MAX_CHARS))
}

/// Instant heuristic (if the row is still a placeholder) plus a background CLI refine.
pub async fn kickoff_grok_auto_title(
    conn: DatabaseConnection,
    emitter: EventEmitter,
    conversation_id: i32,
    first_message: String,
) {
    let heuristic = heuristic_title(&first_message);
    if heuristic.is_empty() {
        return;
    }

    let Ok(summary) = conversation_service::get_by_id(&conn, conversation_id).await else {
        return;
    };
    if summary.title_locked {
        return;
    }
    if !can_overwrite_auto_title(summary.title.as_deref(), &first_message) {
        return;
    }

    if is_placeholder_title(summary.title.as_deref().unwrap_or("")) {
        match conversation_service::refresh_auto_title(&conn, conversation_id, heuristic.clone())
            .await
        {
            Ok(true) => {
                crate::commands::conversations::emit_conversation_upsert(
                    &emitter,
                    &conn,
                    conversation_id,
                )
                .await;
            }
            Ok(false) => {}
            Err(e) => tracing::debug!(
                conversation_id,
                error = %e,
                "grok heuristic title write failed"
            ),
        }
    }

    if !begin_refine(conversation_id) {
        return;
    }

    let locale = crate::commands::system_settings::load_system_language_settings(&conn)
        .await
        .map(|s| resolve_title_locale(&s))
        .unwrap_or(TitleLocale::En);

    tokio::spawn(async move {
        struct RefineGuard(i32);
        impl Drop for RefineGuard {
            fn drop(&mut self) {
                end_refine(self.0);
            }
        }
        let _guard = RefineGuard(conversation_id);

        let Some(refined) = llm_title_via_cli(&first_message, locale).await else {
            return;
        };

        let Ok(current) = conversation_service::get_by_id(&conn, conversation_id).await else {
            return;
        };
        if current.title_locked {
            return;
        }
        if !can_overwrite_auto_title(current.title.as_deref(), &first_message) {
            return;
        }
        if current.title.as_deref() == Some(refined.as_str()) {
            let _ =
                conversation_service::commit_refined_title(&conn, conversation_id, refined.clone())
                    .await;
            return;
        }

        match conversation_service::commit_refined_title(&conn, conversation_id, refined.clone())
            .await
        {
            Ok(true) => {
                crate::commands::conversations::emit_conversation_upsert(
                    &emitter,
                    &conn,
                    conversation_id,
                )
                .await;
            }
            Ok(false) => {}
            Err(e) => tracing::debug!(
                conversation_id,
                error = %e,
                "grok refined title write failed"
            ),
        }
    });
}

fn strip_wrapping_quotes(t: &str) -> Option<String> {
    let mut chars = t.chars();
    let first = chars.next()?;
    let last = chars.next_back()?;
    let paired = matches!(
        (first, last),
        ('"', '"') | ('\'', '\'') | ('「', '」') | ('“', '”')
    );
    if !paired {
        return None;
    }
    Some(
        t[first.len_utf8()..t.len() - last.len_utf8()]
            .trim()
            .to_string(),
    )
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn detect_os_title_locale() -> Option<TitleLocale> {
    if let Some(tag) = posix_lang_tag() {
        if let Some(locale) = TitleLocale::from_lang_tag(&tag) {
            return Some(locale);
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(tag) = apple_languages_tag() {
        return TitleLocale::from_lang_tag(&tag);
    }
    None
}

fn posix_lang_tag() -> Option<String> {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn apple_languages_tag() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    first_apple_languages_tag(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(target_os = "macos", test))]
fn first_apple_languages_tag(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let q = bytes[i];
        if q == b'"' || q == b'\'' {
            if let Some(end) = raw[i + 1..].find(q as char) {
                let inner = raw[i + 1..i + 1 + end].trim();
                if !inner.is_empty() {
                    return Some(inner.to_string());
                }
                i += end + 2;
                continue;
            }
        }
        i += 1;
    }
    None
}

fn refining_ids() -> &'static Mutex<HashSet<i32>> {
    static IDS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();
    IDS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn begin_refine(id: i32) -> bool {
    refining_ids()
        .lock()
        .map(|mut set| set.insert(id))
        .unwrap_or(false)
}

fn end_refine(id: i32) {
    if let Ok(mut set) = refining_ids().lock() {
        set.remove(&id);
    }
}

fn resolve_grok_cli() -> Option<PathBuf> {
    if let Some(path) = crate::commands::acp::resolve_system_agent_binary("grok") {
        return Some(path);
    }
    let home = dirs::home_dir()?;
    let cand = if cfg!(windows) {
        home.join(".grok").join("bin").join("grok.exe")
    } else {
        home.join(".grok").join("bin").join("grok")
    };
    cand.is_file().then_some(cand)
}

async fn llm_title_via_cli(message: &str, locale: TitleLocale) -> Option<String> {
    let path = resolve_grok_cli()?;
    let snippet: String = message.chars().take(LLM_SNIPPET_MAX_CHARS).collect();
    let prompt = title_prompt(&snippet, locale);
    let scratch = crate::paths::codeg_grok_title_scratch_dir();
    if let Err(e) = std::fs::create_dir_all(&scratch) {
        tracing::debug!(error = %e, "grok title scratch dir create failed");
        return None;
    }

    let mut cmd = tokio::process::Command::new(&path);
    crate::process::configure_tokio_command(&mut cmd);
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--effort")
        .arg("low")
        .arg("--max-turns")
        .arg("2")
        .arg("--always-approve")
        .arg("--no-subagents")
        .arg("--disable-web-search")
        .arg("--no-auto-update")
        .arg("--cwd")
        .arg(&scratch)
        .arg("--disallowed-tools")
        .arg(
            "run_terminal_cmd,run_terminal_command,web_search,web_fetch,search_replace,write,Agent,spawn_subagent,bash,bash_tool",
        )
        .kill_on_drop(true);

    let output = match tokio::time::timeout(LLM_TIMEOUT, cmd.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            tracing::debug!(error = %e, "grok title cli spawn failed");
            return None;
        }
        Err(_) => {
            tracing::debug!("grok title cli timed out");
            return None;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(title) = clean_llm_title(&stdout) {
        return Some(title);
    }
    if !output.status.success() {
        tracing::debug!(
            status = %output.status,
            stderr = %String::from_utf8_lossy(&output.stderr).trim(),
            "grok title cli failed"
        );
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders() {
        assert!(is_placeholder_title("新会话"));
        assert!(is_placeholder_title("New chat"));
        assert!(is_placeholder_title(""));
        assert!(!is_placeholder_title("修权限条 bug"));
    }

    #[test]
    fn heuristic_uses_first_line() {
        let t = heuristic_title("  帮我改一下登录页样式\n第二行");
        assert!(t.contains("登录") || t.contains("帮我"));
        assert!(t.chars().count() <= HEURISTIC_MAX_CHARS);
    }

    #[test]
    fn heuristic_folds_file_links() {
        let t = heuristic_title("[README.md](file:///Users/x/README.md) 看看");
        assert!(!t.contains("file://"));
        assert!(t.contains("README.md"));
    }

    #[test]
    fn clean_strips_quotes_and_prefix() {
        assert_eq!(
            clean_llm_title("  \"修复登录样式\" \n"),
            Some("修复登录样式".into())
        );
        assert_eq!(
            clean_llm_title("Title: List open PRs\n"),
            Some("List open PRs".into())
        );
        assert_eq!(
            clean_llm_title("标题：侧栏未读红点\n"),
            Some("侧栏未读红点".into())
        );
    }

    #[test]
    fn clean_rejects_max_turns_noise() {
        assert_eq!(clean_llm_title("Max turns reached\n"), None);
        assert_eq!(
            clean_llm_title("修复登录样式\nMax turns reached\n"),
            Some("修复登录样式".into())
        );
    }

    #[test]
    fn title_prompt_follows_locale() {
        let zh = title_prompt("list open prs", TitleLocale::Zh);
        assert!(zh.contains("用户消息："));
        assert!(zh.contains("list open prs"));
        assert!(!zh.contains("User message:"));

        let en = title_prompt("list open prs", TitleLocale::En);
        assert!(en.contains("User message:"));
        assert!(!en.contains("用户消息"));
    }

    #[test]
    fn can_overwrite_placeholder_and_seed() {
        let msg = "帮我改一下登录页样式并且顺便看看权限";
        assert!(can_overwrite_auto_title(None, msg));
        assert!(can_overwrite_auto_title(Some("新会话"), msg));
        assert!(can_overwrite_auto_title(Some(&heuristic_title(msg)), msg));
        let seed: String = msg.chars().take(80).collect();
        assert!(can_overwrite_auto_title(Some(&seed), msg));
        assert!(!can_overwrite_auto_title(Some("用户手改的名字"), msg));
    }

    #[test]
    fn follow_up_message_does_not_overwrite_existing_title() {
        assert!(!can_overwrite_auto_title(
            Some("登录页样式"),
            "再帮我看看单元测试"
        ));
    }

    #[test]
    fn locale_from_lang_tag() {
        assert_eq!(
            TitleLocale::from_lang_tag("zh-CN.UTF-8"),
            Some(TitleLocale::Zh)
        );
        assert_eq!(TitleLocale::from_lang_tag("zh_TW"), Some(TitleLocale::ZhTw));
        assert_eq!(TitleLocale::from_lang_tag("en-US"), Some(TitleLocale::En));
        assert_eq!(TitleLocale::from_lang_tag("C"), None);
    }

    #[test]
    fn apple_languages_first_tag() {
        let raw = "(\n    \"zh-Hans-CN\",\n    \"en-US\"\n)";
        assert_eq!(
            first_apple_languages_tag(raw).as_deref(),
            Some("zh-Hans-CN")
        );
    }

    #[test]
    fn scratch_cwd_and_refine_prompt() {
        assert!(is_grok_title_scratch_cwd(
            "/Users/me/.codeg/grok-title-scratch"
        ));
        assert!(!is_grok_title_scratch_cwd("/Users/me/proj"));
        assert!(is_title_refine_prompt(
            "为下面这条用户消息起一个简短会话标题。要求：最多16个汉字"
        ));
        assert!(!is_title_refine_prompt("帮我改登录页"));
    }

    #[test]
    fn resolve_manual_locale() {
        let settings = SystemLanguageSettings {
            mode: LanguageMode::Manual,
            language: AppLocale::ZhCn,
        };
        assert_eq!(resolve_title_locale(&settings), TitleLocale::Zh);
    }
}
