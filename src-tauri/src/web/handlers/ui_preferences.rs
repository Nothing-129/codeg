//! HTTP handlers for pure-UI preferences — the web-mode mirror of the Tauri
//! commands in `commands::ui_preferences`.
//!
//! Both endpoints share the same core helpers (`load_ui_preferences`,
//! `set_ui_preferences_core`) so the persist + broadcast behavior stays
//! identical across transports.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::ui_preferences::{
    load_ui_preferences, set_ui_preferences_core, UiPreferences,
};

pub async fn get_ui_preferences(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Option<UiPreferences>>, AppCommandError> {
    Ok(Json(load_ui_preferences(&state.db.conn).await?))
}

#[derive(Deserialize)]
pub struct SetUiPreferencesParams {
    pub settings: UiPreferences,
}

pub async fn set_ui_preferences(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetUiPreferencesParams>,
) -> Result<Json<UiPreferences>, AppCommandError> {
    let saved = set_ui_preferences_core(&state.db.conn, &state.emitter, params.settings).await?;
    Ok(Json(saved))
}
