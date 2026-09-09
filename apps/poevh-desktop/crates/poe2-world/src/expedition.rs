//! Expedition combination/ranking engine.
//!
//! The process-specific decoder lives in `poe2-memory`; this module stays
//! deterministic so it can be tested without a running game.

use parking_lot::RwLock;
use poe2_types::{
    ExpeditionSnapshot, ExpeditionStationResult, RuneCombination, RuneStationSnapshot,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExpeditionRecipe {
    pub id: String,
    pub runes: Vec<String>,
    pub reward: String,
    pub reward_count: u32,
    #[serde(default)]
    pub min_area_level: u16,
    #[serde(default)]
    pub max_area_level: u16,
}

#[derive(Debug, Clone)]
pub struct ExpeditionCatalog {
    pub recipes: Vec<ExpeditionRecipe>,
}

impl Default for ExpeditionCatalog {
    fn default() -> Self {
        // Small, versioned safe fallback. Full catalog can be supplied by a
        // future signed data pack without changing the engine contract.
        Self {
            recipes: vec![
                recipe(
                    "2SlotExaltedOrb",
                    &["Adaptive", "Protective"],
                    "Exalted Orb",
                    1,
                ),
                recipe(
                    "2SlotArtificersOrb",
                    &["Arcane", "Tempest"],
                    "Artificer's Orb",
                    1,
                ),
                recipe(
                    "2SlotBlacksmithsWhetstone",
                    &["Fire", "Stone"],
                    "Blacksmith's Whetstone",
                    2,
                ),
                recipe(
                    "2SlotLesserGlacialRune",
                    &["Cold", "Momentum"],
                    "Lesser Glacial Rune",
                    1,
                ),
            ],
        }
    }
}

fn recipe(id: &str, runes: &[&str], reward: &str, reward_count: u32) -> ExpeditionRecipe {
    ExpeditionRecipe {
        id: id.into(),
        runes: runes.iter().map(|r| (*r).into()).collect(),
        reward: reward.into(),
        reward_count,
        min_area_level: 1,
        max_area_level: 0,
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExpeditionRuntimeSnapshot {
    pub snapshot: Option<ExpeditionSnapshot>,
    pub dismissed_session: Option<String>,
    pub last_error: Option<String>,
}

static RUNTIME: OnceLock<RwLock<ExpeditionRuntimeSnapshot>> = OnceLock::new();
type RewardPriceCache = HashMap<String, (Option<f64>, Instant)>;
static REWARD_PRICES: OnceLock<parking_lot::Mutex<RewardPriceCache>> = OnceLock::new();
static REWARD_IN_FLIGHT: OnceLock<parking_lot::Mutex<HashSet<String>>> = OnceLock::new();
static PRICE_WORKERS: AtomicUsize = AtomicUsize::new(0);
const MAX_PRICE_WORKERS: usize = 4;

fn runtime() -> &'static RwLock<ExpeditionRuntimeSnapshot> {
    RUNTIME.get_or_init(|| RwLock::new(ExpeditionRuntimeSnapshot::default()))
}

fn prices() -> &'static parking_lot::Mutex<RewardPriceCache> {
    REWARD_PRICES.get_or_init(|| parking_lot::Mutex::new(HashMap::new()))
}

fn in_flight() -> &'static parking_lot::Mutex<HashSet<String>> {
    REWARD_IN_FLIGHT.get_or_init(|| parking_lot::Mutex::new(HashSet::new()))
}

/// Return a cached reward price and queue one background Trade2 lookup when stale.
pub fn reward_price_or_queue(name: &str, league: &str) -> Option<f64> {
    let key = format!(
        "{}|{}",
        league.trim().to_ascii_lowercase(),
        name.trim().to_ascii_lowercase()
    );
    if key.is_empty() {
        return None;
    }
    if let Some((value, updated)) = prices().lock().get(&key).copied() {
        if updated.elapsed() < Duration::from_secs(600) {
            return value;
        }
    }
    if in_flight().lock().insert(key.clone()) {
        if PRICE_WORKERS.fetch_add(1, Ordering::AcqRel) >= MAX_PRICE_WORKERS {
            PRICE_WORKERS.fetch_sub(1, Ordering::AcqRel);
            in_flight().lock().remove(&key);
            return None;
        }
        let reward = name.trim().to_string();
        let league = league.trim().to_string();
        std::thread::spawn(move || {
            let value = lookup_reward_price(&reward, &league);
            prices().lock().insert(key.clone(), (value, Instant::now()));
            in_flight().lock().remove(&key);
            PRICE_WORKERS.fetch_sub(1, Ordering::AcqRel);
        });
    }
    None
}

fn lookup_reward_price(name: &str, league: &str) -> Option<f64> {
    let raw_text = format!("Rarity: Currency\n{}", name);
    let result = crate::trade::search_market(poe2_types::TradeSearchInput {
        raw_text,
        league: league.into(),
        selected_mods: Vec::new(),
        selected_pseudos: Vec::new(),
        item_filters: Default::default(),
        online_only: true,
    })
    .ok()?;
    let mut values: Vec<f64> = result
        .listings
        .into_iter()
        .filter_map(|listing| {
            let currency = listing.currency?.to_ascii_lowercase();
            currency.contains("exalted").then_some(listing.amount?)
        })
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect();
    values.sort_by(f64::total_cmp);
    values.get(values.len() / 2).copied()
}

pub fn latest_snapshot() -> ExpeditionRuntimeSnapshot {
    runtime().read().clone()
}

pub fn publish_snapshot(snapshot: ExpeditionSnapshot) {
    let mut state = runtime().write();
    if state
        .snapshot
        .as_ref()
        .is_some_and(|old| old.session_id != snapshot.session_id)
    {
        state.dismissed_session = None;
    }
    state.snapshot = Some(snapshot);
    state.last_error = None;
}

pub fn publish_error(error: impl Into<String>) {
    runtime().write().last_error = Some(error.into());
}

pub fn dismiss_session(session_id: impl Into<String>) {
    runtime().write().dismissed_session = Some(session_id.into());
}

impl ExpeditionCatalog {
    pub fn combinations_for(
        &self,
        station: &RuneStationSnapshot,
        area_level: u16,
    ) -> Vec<ExpeditionRecipe> {
        self.recipes
            .iter()
            .filter(|recipe| {
                let size_ok = recipe.runes.len() <= station.slot_count as usize;
                let level_ok = (recipe.min_area_level == 0 || area_level >= recipe.min_area_level)
                    && (recipe.max_area_level == 0 || area_level <= recipe.max_area_level);
                let anchor_ok = station.unique
                    || station.anchor_rune_id < 0
                    || station.anchor_position < 0
                    || recipe
                        .runes
                        .get(station.anchor_position as usize)
                        .is_some_and(|r| r.eq_ignore_ascii_case(&station.anchor_rune));
                size_ok && level_ok && anchor_ok
            })
            .cloned()
            .collect()
    }

    pub fn rank_station(
        &self,
        station: RuneStationSnapshot,
        area_level: u16,
        prices: impl Fn(&str) -> Option<f64>,
        max_rows: usize,
        min_value: f64,
        show_unpriced: bool,
    ) -> ExpeditionStationResult {
        let mut combinations: Vec<RuneCombination> = self
            .combinations_for(&station, area_level)
            .into_iter()
            .filter_map(|recipe| {
                let unit = prices(&recipe.reward);
                let total = unit.map(|v| v * recipe.reward_count as f64);
                if total.is_some_and(|v| v < min_value) || (unit.is_none() && !show_unpriced) {
                    return None;
                }
                Some(RuneCombination {
                    recipe_id: recipe.id,
                    runes: recipe.runes,
                    reward: recipe.reward,
                    reward_count: recipe.reward_count,
                    value_exalted: total,
                    price_source: unit.map(|_| "Trade2 median listing".into()),
                    price_updated_unix: None,
                })
            })
            .collect();
        combinations.sort_by(|a, b| {
            b.value_exalted
                .unwrap_or(f64::NEG_INFINITY)
                .total_cmp(&a.value_exalted.unwrap_or(f64::NEG_INFINITY))
                .then_with(|| a.reward.cmp(&b.reward))
        });
        combinations.truncate(max_rows.max(1));
        let best_value_exalted = combinations.first().and_then(|x| x.value_exalted);
        ExpeditionStationResult {
            station,
            combinations,
            best_value_exalted,
        }
    }

    pub fn rank_snapshot(
        &self,
        mut snapshot: ExpeditionSnapshot,
        prices: impl Fn(&str) -> Option<f64> + Copy,
        max_rows: usize,
        min_value: f64,
        show_unpriced: bool,
    ) -> ExpeditionSnapshot {
        let area_level = snapshot.area_level;
        snapshot.stations = snapshot
            .stations
            .into_iter()
            .map(|entry| {
                self.rank_station(
                    entry.station,
                    area_level,
                    prices,
                    max_rows,
                    min_value,
                    show_unpriced,
                )
            })
            .collect();
        snapshot.stations.sort_by(|a, b| {
            b.best_value_exalted
                .unwrap_or(f64::NEG_INFINITY)
                .total_cmp(&a.best_value_exalted.unwrap_or(f64::NEG_INFINITY))
        });
        snapshot
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn station() -> RuneStationSnapshot {
        RuneStationSnapshot {
            station_id: 1,
            label: "RUNE-01".into(),
            slot_count: 3,
            anchor_rune_id: 0,
            anchor_rune: "Fire".into(),
            anchor_position: 0,
            unique: false,
            collected: false,
        }
    }

    #[test]
    fn anchor_and_value_sorting_are_deterministic() {
        let catalog = ExpeditionCatalog {
            recipes: vec![
                ExpeditionRecipe {
                    id: "low".into(),
                    runes: vec!["Fire".into(), "Stone".into()],
                    reward: "Orb A".into(),
                    reward_count: 1,
                    min_area_level: 1,
                    max_area_level: 0,
                },
                ExpeditionRecipe {
                    id: "high".into(),
                    runes: vec!["Fire".into(), "Moon".into(), "Power".into()],
                    reward: "Orb B".into(),
                    reward_count: 2,
                    min_area_level: 1,
                    max_area_level: 0,
                },
            ],
        };
        let ranked = catalog.rank_station(
            station(),
            80,
            |name| {
                (name == "Orb B")
                    .then_some(5.0)
                    .or_else(|| (name == "Orb A").then_some(2.0))
            },
            8,
            0.0,
            true,
        );
        assert_eq!(ranked.combinations[0].recipe_id, "high");
        assert_eq!(ranked.best_value_exalted, Some(10.0));
    }

    #[test]
    fn dismissed_or_unpriced_rows_can_be_filtered() {
        let catalog = ExpeditionCatalog {
            recipes: vec![ExpeditionRecipe {
                id: "x".into(),
                runes: vec!["Fire".into()],
                reward: "Unknown".into(),
                reward_count: 1,
                min_area_level: 1,
                max_area_level: 0,
            }],
        };
        let ranked = catalog.rank_station(station(), 80, |_| None, 8, 0.0, false);
        assert!(ranked.combinations.is_empty());
    }
}
