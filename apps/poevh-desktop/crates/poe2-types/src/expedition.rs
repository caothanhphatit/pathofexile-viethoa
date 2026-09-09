//! Read-only Expedition Radar domain types.
//!
//! These types deliberately contain no process handles or UI concerns. The
//! memory adapter publishes immutable snapshots and the overlay consumes them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExpeditionConfig {
    pub enabled: bool,
    pub auto_open: bool,
    pub min_value_exalted: f64,
    pub max_rows_per_station: u16,
    pub scan_interval_ms: u64,
    pub show_unpriced: bool,
    pub selected_client_id: u32,
    pub league: String,
}

impl Default for ExpeditionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_open: true,
            min_value_exalted: 0.0,
            max_rows_per_station: 8,
            scan_interval_ms: 2_000,
            show_unpriced: true,
            selected_client_id: 1,
            league: "Standard".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuneStationSnapshot {
    pub station_id: u64,
    pub label: String,
    pub slot_count: u16,
    pub anchor_rune_id: i16,
    pub anchor_rune: String,
    pub anchor_position: i16,
    pub unique: bool,
    pub collected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuneCombination {
    pub recipe_id: String,
    pub runes: Vec<String>,
    pub reward: String,
    pub reward_count: u32,
    pub value_exalted: Option<f64>,
    pub price_source: Option<String>,
    pub price_updated_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExpeditionStationResult {
    pub station: RuneStationSnapshot,
    pub combinations: Vec<RuneCombination>,
    pub best_value_exalted: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExpeditionSnapshot {
    pub session_id: String,
    pub area_name: String,
    pub area_level: u16,
    pub scan_unix: i64,
    pub stations: Vec<ExpeditionStationResult>,
}

impl ExpeditionSnapshot {
    pub fn empty(session_id: impl Into<String>, area_name: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            area_name: area_name.into(),
            area_level: 0,
            scan_unix: 0,
            stations: Vec::new(),
        }
    }
}
