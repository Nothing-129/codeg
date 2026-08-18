//! Pure-UI preference booleans persisted in `app_metadata`.
//!
//! Three toggles live here, all default ON so the status workflow stays
//! available until the user turns a switch off:
//!   * `show_conversation_status` — colored status dots (sidebar / tabs / dialogs)
//!   * `allow_conversation_status_actions` — whether the status can be changed
//!   * `show_welcome_quick_actions` — the mode cards on the welcome page
//!
//! Unlike their localStorage predecessors these survive an app reinstall (the
//! DB lives in the data dir, not the webview container) and are shared by every
//! window of both transports. `set_ui_preferences_core` broadcasts
//! [`UI_PREFERENCES_CHANGED_EVENT`] after each save — load-bearing, since the
//! settings window and the sidebar view-options menu are different windows.
//! Nothing on the Rust side consumes these values, so there is no runtime
//! config to re-apply (unlike `crate::commands::feedback`).

use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::db::service::app_metadata_service;
use crate::web::event_bridge::{emit_event, EventEmitter, UI_PREFERENCES_CHANGED_EVENT};

pub const UI_PREFERENCES_KEY: &str = "ui_preferences";

/// All three default ON — `#[serde(default)]` makes partial or future-shaped
/// JSON degrade per-field instead of failing the whole load. (Container-level
/// `serde(default)` reads missing fields from `Default`, which is why `Default`
/// is the all-true manual impl below rather than the derived all-false one.)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct UiPreferences {
    pub show_conversation_status: bool,
    pub allow_conversation_status_actions: bool,
    pub show_welcome_quick_actions: bool,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            show_conversation_status: true,
            allow_conversation_status_actions: true,
            show_welcome_quick_actions: true,
        }
    }
}

/// Read the persisted blob from `app_metadata`.
///
/// `Ok(None)` means "no row yet" — the frontend uses that exact signal to
/// one-time-migrate the legacy localStorage keys, so it must not be conflated
/// with "row storing all-defaults". A malformed value warns and reads as
/// defaults (never errors hard, matching `load_feedback_settings`).
pub async fn load_ui_preferences(conn: &DatabaseConnection) -> Result<Option<UiPreferences>, AppCommandError> {
    let Some(raw) = app_metadata_service::get_value(conn, UI_PREFERENCES_KEY)
        .await
        .map_err(AppCommandError::from)?
    else {
        return Ok(None);
    };
    match serde_json::from_str::<UiPreferences>(&raw) {
        Ok(prefs) => Ok(Some(prefs)),
        Err(e) => {
            tracing::warn!("ignoring malformed {UI_PREFERENCES_KEY} value: {e}");
            Ok(Some(UiPreferences::default()))
        }
    }
}

/// Persist + broadcast. Single write path shared by the Tauri command and the
/// HTTP handler so the write + notify chain lives in exactly one place.
pub async fn set_ui_preferences_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    desired: UiPreferences,
) -> Result<UiPreferences, AppCommandError> {
    let serialized =
        serde_json::to_string(&desired).map_err(|e| AppCommandError::configuration_invalid(
            format!("failed to serialize ui preferences: {e}"),
        ))?;
    app_metadata_service::upsert_value(conn, UI_PREFERENCES_KEY, &serialized)
        .await
        .map_err(AppCommandError::from)?;
    emit_event(emitter, UI_PREFERENCES_CHANGED_EVENT, &desired);
    Ok(desired)
}

// -------- Tauri commands -----------------------------------------------------

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_ui_preferences(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
) -> Result<Option<UiPreferences>, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        load_ui_preferences(&db.conn).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn set_ui_preferences(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    settings: UiPreferences,
) -> Result<UiPreferences, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        // `app.emit` fans out to every window, so a save from the settings
        // window (or the sidebar menu in the main window) converges everywhere.
        let emitter = EventEmitter::Tauri(app);
        set_ui_preferences_core(&db.conn, &emitter, settings).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = settings;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn load_returns_none_when_unset() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        assert_eq!(load_ui_preferences(&db.conn).await.unwrap(), None);
    }

    #[tokio::test]
    async fn set_then_load_round_trip() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let desired = UiPreferences {
            show_conversation_status: false,
            allow_conversation_status_actions: false,
            show_welcome_quick_actions: false,
        };
        let saved = set_ui_preferences_core(&db.conn, &EventEmitter::Noop, desired.clone())
            .await
            .unwrap();
        assert_eq!(saved, desired);
        assert_eq!(load_ui_preferences(&db.conn).await.unwrap(), Some(desired));
    }

    #[tokio::test]
    async fn partial_json_merges_defaults_per_field() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        app_metadata_service::upsert_value(
            &db.conn,
            UI_PREFERENCES_KEY,
            r#"{"show_conversation_status":false}"#,
        )
        .await
        .unwrap();
        let loaded = load_ui_preferences(&db.conn).await.unwrap().unwrap();
        assert!(!loaded.show_conversation_status);
        assert!(loaded.allow_conversation_status_actions);
        assert!(loaded.show_welcome_quick_actions);
    }

    #[tokio::test]
    async fn corrupt_value_falls_back_to_all_enabled() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        app_metadata_service::upsert_value(&db.conn, UI_PREFERENCES_KEY, "not-json")
            .await
            .unwrap();
        assert_eq!(
            load_ui_preferences(&db.conn).await.unwrap(),
            Some(UiPreferences::default())
        );
    }
}
