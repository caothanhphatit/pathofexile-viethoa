//! Official Path of Exile 2 trade search integration.
//!
//! The client deliberately accepts structured item data rather than arbitrary
//! upstream JSON. This keeps the local API small and prevents it becoming an
//! unrestricted HTTP proxy.

use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock};
use poe2_types::trade::{
    ItemRarity, PoeItem, TradeCaptureSnapshot, TradeItemFilters, TradeListing, TradeMarketResult,
    TradeModFilter, TradeSearchInput, TradeSelectedPseudo,
};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, CONTENT_TYPE, RETRY_AFTER, USER_AGENT};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

const API_ROOT: &str = "https://www.pathofexile.com";
const USER_AGENT_VALUE: &str = "POEVH/0.2 local desktop price checker";
const FETCH_LIMIT: usize = 10;
const MIN_SEARCH_INTERVAL: Duration = Duration::from_millis(2100);

#[derive(Debug, Clone, Deserialize)]
struct StatEntry {
    id: String,
    text: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct StatGroup {
    entries: Vec<StatEntry>,
}

#[derive(Debug, Deserialize)]
struct StatResponse {
    result: Vec<StatGroup>,
}

#[derive(Debug, Clone, PartialEq)]
struct ResolvedPseudoFilter {
    key: String,
    trade_id: String,
    min: Option<f64>,
    max: Option<f64>,
}

#[derive(Debug, Default)]
struct StatLookup {
    by_kind: HashMap<(String, String), usize>,
    any: HashMap<String, usize>,
    local_by_kind: HashMap<(String, String), usize>,
    local_any: HashMap<String, usize>,
}

impl StatLookup {
    fn build(stats: &[StatEntry]) -> Self {
        let mut lookup = Self::default();
        for (index, entry) in stats.iter().enumerate() {
            let normalized = normalize_stat(&entry.text);
            lookup
                .by_kind
                .entry((entry.kind.clone(), normalized.clone()))
                .or_insert(index);
            lookup.any.entry(normalized).or_insert(index);
            if entry.text.to_ascii_lowercase().contains("(local)") {
                let without_local = normalize_stat_without_local(&entry.text);
                lookup
                    .local_by_kind
                    .entry((entry.kind.clone(), without_local.clone()))
                    .or_insert(index);
                lookup.local_any.entry(without_local).or_insert(index);
            }
        }
        lookup
    }

    fn match_index(&self, expected_kind: &str, normalized: &str, equipment: bool) -> Option<usize> {
        let kind_key = || (expected_kind.to_string(), normalized.to_string());
        if equipment {
            self.local_by_kind
                .get(&kind_key())
                .or_else(|| self.by_kind.get(&kind_key()))
                .or_else(|| self.local_any.get(normalized))
                .or_else(|| self.any.get(normalized))
                .copied()
        } else {
            self.by_kind
                .get(&kind_key())
                .or_else(|| self.any.get(normalized))
                .copied()
        }
    }
}

#[derive(Debug, Deserialize)]
struct LeagueEntry {
    id: String,
    realm: String,
}

#[derive(Debug, Deserialize)]
struct LeagueResponse {
    result: Vec<LeagueEntry>,
}

#[derive(Debug, Default)]
struct MarketCache {
    stats: Option<Arc<Vec<StatEntry>>>,
    stat_lookup: Option<Arc<StatLookup>>,
    stats_updated: Option<Instant>,
    leagues: Option<Vec<String>>,
    leagues_updated: Option<Instant>,
    last_search: Option<Instant>,
}

static MARKET_CACHE: OnceLock<Mutex<MarketCache>> = OnceLock::new();
static LATEST_CAPTURE: OnceLock<RwLock<TradeCaptureSnapshot>> = OnceLock::new();
const CACHE_TTL: Duration = Duration::from_secs(3600);

fn market_cache() -> &'static Mutex<MarketCache> {
    MARKET_CACHE.get_or_init(|| Mutex::new(MarketCache::default()))
}

fn capture_state() -> &'static RwLock<TradeCaptureSnapshot> {
    LATEST_CAPTURE.get_or_init(|| RwLock::new(TradeCaptureSnapshot::default()))
}

pub fn publish_capture(raw_text: String, item: PoeItem) {
    let mut state = capture_state().write();
    state.revision = state.revision.wrapping_add(1);
    state.status = "captured".to_string();
    state.raw_text = Some(raw_text);
    state.item = Some(item);
    state.error = None;
}

pub fn publish_capture_error(error: impl Into<String>) {
    let mut state = capture_state().write();
    state.revision = state.revision.wrapping_add(1);
    state.status = "error".to_string();
    state.raw_text = None;
    state.item = None;
    state.error = Some(error.into());
}

pub fn latest_capture() -> TradeCaptureSnapshot {
    capture_state().read().clone()
}

/// Remove captured item text and parsed data when the overlay is dismissed.
/// The revision still advances so clients cannot retain a stale snapshot.
pub fn clear_capture() {
    let mut state = capture_state().write();
    state.revision = state.revision.wrapping_add(1);
    state.status = "empty".to_string();
    state.raw_text = None;
    state.item = None;
    state.error = None;
}

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> Result<&'static Client> {
    if let Some(c) = HTTP_CLIENT.get() {
        return Ok(c);
    }
    let c = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .context("Không khởi tạo được HTTP client cho Trade API")?;
    let _ = HTTP_CLIENT.set(c);
    Ok(HTTP_CLIENT.get().unwrap())
}

fn validate_league(league: &str) -> Result<&str> {
    let league = league.trim();
    if league.is_empty()
        || league.len() > 80
        || !league
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '\''))
    {
        return Err(anyhow!("Tên league không hợp lệ"));
    }
    Ok(league)
}

fn encoded_league(league: &str) -> String {
    league.replace(' ', "%20").replace('\'', "%27")
}

fn check_response(response: Response, operation: &str) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let retry = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(|value| format!("; thử lại sau {value} giây"))
        .unwrap_or_default();
    Err(anyhow!(
        "GGG Trade API {operation} trả HTTP {status}{retry}"
    ))
}

fn load_stats(client: &Client) -> Result<(Arc<Vec<StatEntry>>, Arc<StatLookup>)> {
    {
        let cache = market_cache().lock();
        if cache.stats_updated.is_some_and(|t| t.elapsed() < CACHE_TTL) {
            if let (Some(stats), Some(lookup)) = (cache.stats.clone(), cache.stat_lookup.clone()) {
                return Ok((stats, lookup));
            }
        }
    }

    let response = check_response(
        client
            .get(format!("{API_ROOT}/api/trade2/data/stats"))
            .header(USER_AGENT, USER_AGENT_VALUE)
            .header(ACCEPT, "application/json")
            .send()
            .map_err(|e| anyhow!("Không tải được danh mục modifier từ GGG: {e}"))?,
        "stats",
    )?;
    let body: StatResponse = response
        .json()
        .context("GGG trả dữ liệu modifier không hợp lệ")?;
    let stats = Arc::new(
        body.result
            .into_iter()
            .flat_map(|group| group.entries)
            .collect::<Vec<_>>(),
    );
    let lookup = Arc::new(StatLookup::build(&stats));
    let mut cache = market_cache().lock();
    cache.stats = Some(Arc::clone(&stats));
    cache.stat_lookup = Some(Arc::clone(&lookup));
    cache.stats_updated = Some(Instant::now());
    Ok((stats, lookup))
}

pub fn list_leagues() -> Result<Vec<String>> {
    {
        let cache = market_cache().lock();
        if cache
            .leagues_updated
            .is_some_and(|t| t.elapsed() < CACHE_TTL)
        {
            if let Some(leagues) = cache.leagues.clone() {
                return Ok(leagues);
            }
        }
    }
    let response = check_response(
        client()?
            .get(format!("{API_ROOT}/api/trade2/data/leagues"))
            .header(USER_AGENT, USER_AGENT_VALUE)
            .header(ACCEPT, "application/json")
            .send()
            .map_err(|e| anyhow!("Không tải được danh sách league từ GGG: {e}"))?,
        "leagues",
    )?;
    let body: LeagueResponse = response
        .json()
        .context("GGG trả danh sách league không hợp lệ")?;
    let leagues: Vec<String> = body
        .result
        .into_iter()
        .filter(|entry| entry.realm == "poe2")
        .map(|entry| entry.id)
        .collect();
    if leagues.is_empty() {
        return Err(anyhow!("GGG không trả league PoE2 nào"));
    }
    let mut cache = market_cache().lock();
    cache.leagues = Some(leagues.clone());
    cache.leagues_updated = Some(Instant::now());
    Ok(leagues)
}

fn throttle_search() {
    let wait = {
        let mut cache = market_cache().lock();
        let now = Instant::now();
        let reserved = cache
            .last_search
            .map(|last| std::cmp::max(now, last + MIN_SEARCH_INTERVAL))
            .unwrap_or(now);
        cache.last_search = Some(reserved);
        reserved.saturating_duration_since(now)
    };
    if !wait.is_zero() {
        std::thread::sleep(wait);
    }
}

fn normalize_stat(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    let mut output = String::with_capacity(chars.len());
    let mut index = 0;
    while index < chars.len() {
        // PoE2 clipboard lines include the rolled value followed by the
        // allowed range, e.g. `+147(120-149)`.  The Trade2 catalogue uses
        // the placeholder form (`# to maximum Life`), so discard only
        // numeric range annotations before replacing values.  Do not remove
        // arbitrary parenthesised text: `(Local)`, `(implicit)`, etc. are
        // meaningful in the stat catalogue.
        if chars[index] == '(' {
            if let Some(end) = chars[index + 1..].iter().position(|ch| *ch == ')') {
                let end = index + 1 + end;
                let inner = &chars[index + 1..end];
                let is_numeric_range = !inner.is_empty()
                    && inner.iter().all(|ch| {
                        ch.is_ascii_digit()
                            || matches!(ch, '.' | ',' | '-' | ' ' | '\u{2013}' | '\u{2014}')
                    })
                    && inner.iter().any(|ch| ch.is_ascii_digit())
                    && inner
                        .iter()
                        .any(|ch| matches!(ch, '-' | '\u{2013}' | '\u{2014}'));
                if is_numeric_range {
                    index = end + 1;
                    continue;
                }
            }
        }
        let signed_number = matches!(chars[index], '+' | '-')
            && chars
                .get(index + 1)
                .is_some_and(|next| next.is_ascii_digit());
        if chars[index].is_ascii_digit() || signed_number {
            if signed_number {
                output.push(chars[index]);
                index += 1;
            }
            output.push('#');
            while index < chars.len()
                && (chars[index].is_ascii_digit() || matches!(chars[index], '.' | ','))
            {
                index += 1;
            }
            continue;
        }
        output.push(chars[index].to_ascii_lowercase());
        index += 1;
    }
    output
        .replace("+#", "#")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_equipment(item: &PoeItem) -> bool {
    if item.armour > 0 || item.evasion > 0 || item.energy_shield > 0 {
        return true;
    }
    let class = item.item_class.to_lowercase();
    class.contains("armour")
        || class.contains("glove")
        || class.contains("boot")
        || class.contains("helmet")
        || class.contains("shield")
        || class.contains("focus")
        || class.contains("quiver")
        || class.contains("weapon")
        || class.contains("bow")
        || class.contains("crossbow")
        || class.contains("axe")
        || class.contains("sword")
        || class.contains("mace")
        || class.contains("staff")
        || class.contains("staves")
        || class.contains("wand")
        || class.contains("sceptre")
        || class.contains("claw")
        || class.contains("dagger")
        || class.contains("flail")
        || class.contains("spear")
}

fn normalize_stat_without_local(text: &str) -> String {
    let cleaned = text
        .replace("(Local)", "")
        .replace("(local)", "")
        .replace("(LOCAL)", "");
    normalize_stat(&cleaned)
}

#[cfg(test)]
fn resolve_filters(
    item: &PoeItem,
    stats: &[StatEntry],
    selected: &[poe2_types::trade::TradeSelectedMod],
) -> Vec<TradeModFilter> {
    let lookup = StatLookup::build(stats);
    resolve_filters_indexed(item, stats, &lookup, selected)
}

fn resolve_filters_indexed(
    item: &PoeItem,
    stats: &[StatEntry],
    lookup: &StatLookup,
    selected: &[poe2_types::trade::TradeSelectedMod],
) -> Vec<TradeModFilter> {
    let is_equip = is_equipment(item);
    item.mods
        .iter()
        .enumerate()
        .map(|(index, item_mod)| {
            let normalized = normalize_stat(&item_mod.text);
            let expected_kind = match item_mod.mod_type {
                poe2_types::trade::ModType::Implicit => "implicit",
                poe2_types::trade::ModType::Enchant => "enchant",
                poe2_types::trade::ModType::Rune => "rune",
                _ => "explicit",
            };
            let matched = lookup
                .match_index(expected_kind, &normalized, is_equip)
                .and_then(|index| stats.get(index));
            let selection = selected.iter().find(|selection| selection.index == index);
            let suggested_min = item_mod
                .values
                .first()
                .copied()
                .map(|value| (value * 0.8 * 10.0).round() / 10.0);
            TradeModFilter {
                index,
                text: item_mod.text.clone(),
                trade_id: matched.map(|entry| entry.id.clone()),
                suggested_min,
                selected: selection.is_some(),
            }
        })
        .collect()
}

/// Return the canonical text used by GGG's live Trade2 pseudo catalogue.
/// Keeping the browser-facing key separate from the upstream stat id prevents
/// the local API from becoming an arbitrary-stat proxy.
fn pseudo_catalog_text(key: &str) -> Option<&'static str> {
    match key {
        "total_life" => Some("+# total maximum Life"),
        "total_mana" => Some("+# total maximum Mana"),
        "total_energy_shield" => Some("+# total maximum Energy Shield"),
        "total_strength" => Some("+# total to Strength"),
        "total_dexterity" => Some("+# total to Dexterity"),
        "total_intelligence" => Some("+# total to Intelligence"),
        "total_attributes" => Some("+# total to Attributes"),
        "total_elemental_resistance" => Some("+#% total Elemental Resistance"),
        "total_resistance" => Some("+#% total Resistance"),
        "total_fire_resistance" => Some("+#% total to Fire Resistance"),
        "total_cold_resistance" => Some("+#% total to Cold Resistance"),
        "total_lightning_resistance" => Some("+#% total to Lightning Resistance"),
        "total_chaos_resistance" => Some("+#% total to Chaos Resistance"),
        _ => None,
    }
}

#[cfg(test)]
fn resolve_pseudo_filters(
    stats: &[StatEntry],
    selected: &[TradeSelectedPseudo],
) -> Result<Vec<ResolvedPseudoFilter>> {
    let lookup = StatLookup::build(stats);
    resolve_pseudo_filters_indexed(stats, &lookup, selected)
}

fn resolve_pseudo_filters_indexed(
    stats: &[StatEntry],
    lookup: &StatLookup,
    selected: &[TradeSelectedPseudo],
) -> Result<Vec<ResolvedPseudoFilter>> {
    selected
        .iter()
        .map(|filter| {
            let text = pseudo_catalog_text(&filter.key)
                .ok_or_else(|| anyhow!("Pseudo-stat '{}' không được hỗ trợ", filter.key))?;
            let normalized = normalize_stat(text);
            let entry = lookup
                .match_index("pseudo", &normalized, false)
                .and_then(|index| stats.get(index))
                .ok_or_else(|| {
                    anyhow!(
                        "GGG Trade2 chưa cung cấp pseudo-stat '{}' cho league hiện tại",
                        filter.key
                    )
                })?;
            Ok(ResolvedPseudoFilter {
                key: filter.key.clone(),
                trade_id: entry.id.clone(),
                min: filter.min,
                max: filter.max,
            })
        })
        .collect()
}

fn build_query(
    item: &PoeItem,
    input: &TradeSearchInput,
    filters: &[TradeModFilter],
    pseudos: &[ResolvedPseudoFilter],
) -> Value {
    let mut selected_filters: Vec<Value> = input
        .selected_mods
        .iter()
        .filter_map(|selection| {
            let filter = filters
                .iter()
                .find(|filter| filter.index == selection.index)?;
            let id = filter.trade_id.as_ref()?;
            let mut value = serde_json::Map::new();
            if let Some(min) = selection.min {
                value.insert("min".into(), json!(min));
            }
            if let Some(max) = selection.max {
                value.insert("max".into(), json!(max));
            }
            let mut stat = serde_json::Map::new();
            stat.insert("id".into(), json!(id));
            if !value.is_empty() {
                stat.insert("value".into(), Value::Object(value));
            }
            Some(Value::Object(stat))
        })
        .collect();

    selected_filters.extend(pseudos.iter().map(|filter| {
        let mut value = serde_json::Map::new();
        if let Some(min) = filter.min {
            value.insert("min".into(), json!(min));
        }
        if let Some(max) = filter.max {
            value.insert("max".into(), json!(max));
        }
        let mut stat = serde_json::Map::new();
        stat.insert("id".into(), json!(filter.trade_id));
        if !value.is_empty() {
            stat.insert("value".into(), Value::Object(value));
        }
        Value::Object(stat)
    }));

    let mut query = serde_json::Map::new();
    query.insert(
        "status".into(),
        json!({"option": if input.online_only { "online" } else { "any" }}),
    );
    if item.rarity == ItemRarity::Unique && !item.name.is_empty() {
        query.insert("name".into(), json!(item.name));
    }
    let item_type = if !item.base_type.is_empty() {
        &item.base_type
    } else {
        &item.name
    };
    if !item_type.is_empty() {
        query.insert("type".into(), json!(item_type));
    }
    query.insert(
        "stats".into(),
        json!([{"type":"and", "filters": selected_filters}]),
    );
    let mut query_filters = serde_json::Map::new();
    let item_filters = &input.item_filters;

    let mut type_filters = serde_json::Map::new();
    if let Some(rarity) = item_filters
        .rarity
        .as_deref()
        .filter(|value| *value != "any")
    {
        type_filters.insert("rarity".into(), json!({"option": rarity}));
    }
    insert_range(
        &mut type_filters,
        "ilvl",
        item_filters.item_level_min,
        item_filters.item_level_max,
    );
    insert_range(
        &mut type_filters,
        "quality",
        item_filters.quality_min,
        item_filters.quality_max,
    );
    insert_filter_group(&mut query_filters, "type_filters", type_filters);

    let mut equipment_filters = serde_json::Map::new();
    insert_range(
        &mut equipment_filters,
        "ar",
        item_filters.armour_min,
        item_filters.armour_max,
    );
    insert_range(
        &mut equipment_filters,
        "ev",
        item_filters.evasion_min,
        item_filters.evasion_max,
    );
    insert_range(
        &mut equipment_filters,
        "es",
        item_filters.energy_shield_min,
        item_filters.energy_shield_max,
    );
    insert_range(
        &mut equipment_filters,
        "rune_sockets",
        item_filters.rune_sockets_min,
        item_filters.rune_sockets_max,
    );
    insert_filter_group(&mut query_filters, "equipment_filters", equipment_filters);

    let mut requirement_filters = serde_json::Map::new();
    insert_range(
        &mut requirement_filters,
        "lvl",
        item_filters.requirement_level_min,
        item_filters.requirement_level_max,
    );
    insert_filter_group(&mut query_filters, "req_filters", requirement_filters);

    query.insert("filters".into(), Value::Object(query_filters));
    json!({"query": Value::Object(query), "sort": {"price":"asc"}})
}

fn insert_range(
    filters: &mut serde_json::Map<String, Value>,
    id: &str,
    min: Option<f64>,
    max: Option<f64>,
) {
    if min.is_none() && max.is_none() {
        return;
    }
    let mut range = serde_json::Map::new();
    if let Some(value) = min {
        range.insert("min".into(), json!(value));
    }
    if let Some(value) = max {
        range.insert("max".into(), json!(value));
    }
    filters.insert(id.to_string(), Value::Object(range));
}

fn insert_filter_group(
    query_filters: &mut serde_json::Map<String, Value>,
    id: &str,
    filters: serde_json::Map<String, Value>,
) {
    if !filters.is_empty() {
        query_filters.insert(id.to_string(), json!({"filters": filters}));
    }
}

fn validate_item_filters(filters: &TradeItemFilters) -> Result<()> {
    if let Some(rarity) = filters.rarity.as_deref() {
        if !matches!(rarity, "any" | "normal" | "magic" | "rare" | "unique") {
            return Err(anyhow!("Độ hiếm item không hợp lệ"));
        }
    }
    for (label, min, max) in [
        ("item level", filters.item_level_min, filters.item_level_max),
        ("quality", filters.quality_min, filters.quality_max),
        ("armour", filters.armour_min, filters.armour_max),
        ("evasion", filters.evasion_min, filters.evasion_max),
        (
            "energy shield",
            filters.energy_shield_min,
            filters.energy_shield_max,
        ),
        (
            "rune sockets",
            filters.rune_sockets_min,
            filters.rune_sockets_max,
        ),
        (
            "requirement level",
            filters.requirement_level_min,
            filters.requirement_level_max,
        ),
    ] {
        if min.is_some_and(|value| !value.is_finite() || value < 0.0)
            || max.is_some_and(|value| !value.is_finite() || value < 0.0)
            || min.zip(max).is_some_and(|(min, max)| min > max)
        {
            return Err(anyhow!("Khoảng {label} không hợp lệ"));
        }
    }
    Ok(())
}

fn optional_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn display_fields(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|field| {
            let name = field.get("name").and_then(Value::as_str).unwrap_or("");
            let values: Vec<&str> = field
                .get("values")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.as_array()?.first()?.as_str())
                .collect();
            if name.is_empty() && values.is_empty() {
                return None;
            }
            let rendered = values
                .iter()
                .enumerate()
                .fold(name.to_string(), |text, (index, value)| {
                    text.replace(&format!("%{index}"), value)
                });
            if rendered != name || values.is_empty() {
                Some(rendered)
            } else if name.is_empty() {
                Some(values.join(", "))
            } else {
                Some(format!("{name}: {}", values.join(", ")))
            }
        })
        .collect()
}

fn string_rows(item: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .flat_map(|key| {
            item.get(*key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn rarity_label(frame_type: Option<u64>) -> &'static str {
    match frame_type {
        Some(0) => "normal",
        Some(1) => "magic",
        Some(2) => "rare",
        Some(3) => "unique",
        Some(4) => "gem",
        Some(5) => "currency",
        _ => "unknown",
    }
}

fn parse_listing(entry: &Value) -> Option<TradeListing> {
    let listing = entry.get("listing")?;
    let account = listing.get("account").unwrap_or(&Value::Null);
    let item = entry.get("item").unwrap_or(&Value::Null);
    let price = listing.get("price");
    let quality = item
        .get("properties")
        .and_then(Value::as_array)
        .and_then(|properties| {
            properties.iter().find_map(|property| {
                let name = property.get("name").and_then(Value::as_str).unwrap_or("");
                let is_quality =
                    name == "Quality" || property.get("type").and_then(Value::as_u64) == Some(6);
                is_quality.then(|| {
                    property
                        .get("values")
                        .and_then(Value::as_array)
                        .and_then(|values| values.first())
                        .and_then(Value::as_array)
                        .and_then(|pair| pair.first())
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })?
            })
        });
    Some(TradeListing {
        id: entry.get("id")?.as_str()?.to_string(),
        amount: price
            .and_then(|price| price.get("amount"))
            .and_then(Value::as_f64),
        currency: price
            .and_then(|price| price.get("currency"))
            .and_then(Value::as_str)
            .map(str::to_string),
        account: account
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Ẩn")
            .to_string(),
        character: account
            .get("lastCharacterName")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        indexed: listing
            .get("indexed")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        online: account.get("online").is_some_and(|value| !value.is_null()),
        item_level: optional_u32(item.get("ilvl")),
        quality,
        stack_size: optional_u32(item.get("stackSize")),
        item_name: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        base_type: item
            .get("typeLine")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        rarity: rarity_label(item.get("frameType").and_then(Value::as_u64)).to_string(),
        properties: display_fields(item.get("properties")),
        requirements: display_fields(item.get("requirements")),
        implicit_mods: string_rows(item, &["implicitMods", "enchantMods", "fracturedMods"]),
        explicit_mods: string_rows(item, &["explicitMods", "craftedMods"]),
        rune_mods: string_rows(item, &["runeMods"]),
    })
}

pub fn search_market(input: TradeSearchInput) -> Result<TradeMarketResult> {
    let league = validate_league(&input.league)?.to_string();
    if input.raw_text.len() > 24_000 {
        return Err(anyhow!("Dữ liệu item vượt giới hạn"));
    }
    let item = super::parser::parse_poe2_item(&input.raw_text)?;
    if input.selected_mods.len() + input.selected_pseudos.len() > 12 {
        return Err(anyhow!(
            "Chỉ hỗ trợ tối đa 12 modifier/pseudo-stat trong một truy vấn"
        ));
    }
    validate_item_filters(&input.item_filters)?;
    let mut seen = std::collections::HashSet::new();
    for selected in &input.selected_mods {
        if selected.index >= item.mods.len() || !seen.insert(selected.index) {
            return Err(anyhow!("Danh sách modifier không hợp lệ"));
        }
        if selected.min.is_some_and(|value| !value.is_finite())
            || selected.max.is_some_and(|value| !value.is_finite())
            || selected
                .min
                .zip(selected.max)
                .is_some_and(|(min, max)| min > max)
        {
            return Err(anyhow!("Khoảng giá trị modifier không hợp lệ"));
        }
    }
    let mut seen_pseudos = std::collections::HashSet::new();
    for selected in &input.selected_pseudos {
        if !seen_pseudos.insert(selected.key.as_str())
            || pseudo_catalog_text(&selected.key).is_none()
        {
            return Err(anyhow!("Danh sách pseudo-stat không hợp lệ"));
        }
        if selected.min.is_some_and(|value| !value.is_finite())
            || selected.max.is_some_and(|value| !value.is_finite())
            || selected
                .min
                .zip(selected.max)
                .is_some_and(|(min, max)| min > max)
        {
            return Err(anyhow!("Khoảng giá trị pseudo-stat không hợp lệ"));
        }
    }
    let client = client()?;
    let (stats, lookup) = load_stats(client)?;
    let filters = resolve_filters_indexed(&item, &stats, &lookup, &input.selected_mods);
    let pseudos = resolve_pseudo_filters_indexed(&stats, &lookup, &input.selected_pseudos)?;
    let query = build_query(&item, &input, &filters, &pseudos);

    throttle_search();
    let search_url = format!(
        "{API_ROOT}/api/trade2/search/poe2/{}",
        encoded_league(&league)
    );
    let response = check_response(
        client
            .post(&search_url)
            .header(USER_AGENT, USER_AGENT_VALUE)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(&query)
            .send()
            .map_err(|e| anyhow!("Không kết nối được GGG Trade API ({search_url}): {e}"))?,
        "search",
    )?;
    let search: Value = response
        .json()
        .context("GGG trả search JSON không hợp lệ")?;
    if let Some(error) = search.get("error") {
        return Err(anyhow!(
            "GGG từ chối truy vấn: {}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        ));
    }
    let query_id = search
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Search response thiếu query id"))?
        .to_string();
    let ids: Vec<&str> = search
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(FETCH_LIMIT)
        .collect();

    let listings = if ids.is_empty() {
        Vec::new()
    } else {
        let fetch_url = format!(
            "{API_ROOT}/api/trade2/fetch/{}?query={query_id}",
            ids.join(",")
        );
        let response = check_response(
            client
                .get(fetch_url)
                .header(USER_AGENT, USER_AGENT_VALUE)
                .header(ACCEPT, "application/json")
                .send()
                .map_err(|e| anyhow!("Không tải được listing từ GGG: {e}"))?,
            "fetch",
        )?;
        let fetched: Value = response
            .json()
            .context("GGG trả listing JSON không hợp lệ")?;
        fetched
            .get("result")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(parse_listing)
            .collect()
    };

    let total = search
        .get("total")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or_default();
    let inexact = search
        .get("inexact")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let trade_url = format!(
        "{API_ROOT}/trade2/search/poe2/{}/{}",
        encoded_league(&league),
        query_id
    );

    Ok(TradeMarketResult {
        source: "pathofexile.com/trade2".to_string(),
        query_id,
        league,
        total,
        inexact,
        item,
        filters,
        listings,
        trade_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use poe2_types::trade::{ItemMod, ModType, TradeSelectedMod, TradeSelectedPseudo};

    #[test]
    fn listing_keeps_hover_tooltip_details() {
        let entry = json!({
            "id": "listing-1",
            "listing": {
                "indexed": "2026-09-04T00:00:00Z",
                "account": {"name": "Seller", "online": {"league": "Standard"}},
                "price": {"amount": 2.0, "currency": "exalted"}
            },
            "item": {
                "name": "Rage Grip",
                "typeLine": "Feathered Mitts",
                "frameType": 2,
                "ilvl": 81,
                "properties": [{"name": "Armour", "values": [["478", 0]]}],
                "requirements": [{"name": "Level", "values": [["59", 0]]}],
                "implicitMods": ["+12 to Armour"],
                "explicitMods": ["+147 to maximum Life"],
                "runeMods": ["+20 to maximum Life"]
            }
        });
        let listing = parse_listing(&entry).expect("listing should parse");
        assert_eq!(listing.item_name, "Rage Grip");
        assert_eq!(listing.base_type, "Feathered Mitts");
        assert_eq!(listing.properties, vec!["Armour: 478"]);
        assert_eq!(listing.requirements, vec!["Level: 59"]);
        assert_eq!(listing.explicit_mods, vec!["+147 to maximum Life"]);
        assert_eq!(listing.rune_mods, vec!["+20 to maximum Life"]);
    }

    #[test]
    fn normalizes_rolls_without_losing_signs() {
        assert_eq!(normalize_stat("+72 to maximum Life"), "# to maximum life");
        assert_eq!(
            normalize_stat("+147(120-149) to maximum Life"),
            "# to maximum life"
        );
        assert_eq!(
            normalize_stat("36(33-38)% increased Armour"),
            "#% increased armour"
        );
        assert_eq!(
            normalize_stat("+36(36-40)% to Cold Resistance"),
            "#% to cold resistance"
        );
        assert_eq!(
            normalize_stat("+120 to maximum Life (rune)"),
            "# to maximum life (rune)"
        );
        assert_eq!(
            normalize_stat("Adds 4 to 12 Fire Damage"),
            "adds # to # fire damage"
        );
    }

    #[test]
    fn query_contains_only_resolved_selected_modifiers() {
        let mut item = PoeItem {
            rarity: ItemRarity::Rare,
            name: "Doom Tread".into(),
            base_type: "Iron Greaves".into(),
            ..Default::default()
        };
        item.mods
            .push(ItemMod::new("+72 to maximum Life", ModType::Explicit));
        item.mods
            .push(ItemMod::new("Unknown local text", ModType::Explicit));
        let input = TradeSearchInput {
            raw_text: "unused".into(),
            league: "Standard".into(),
            selected_mods: vec![
                TradeSelectedMod {
                    index: 0,
                    min: Some(55.0),
                    max: None,
                },
                TradeSelectedMod {
                    index: 1,
                    min: None,
                    max: None,
                },
            ],
            selected_pseudos: Vec::new(),
            item_filters: TradeItemFilters {
                rarity: Some("rare".into()),
                item_level_min: Some(80.0),
                armour_min: Some(400.0),
                requirement_level_max: Some(70.0),
                ..Default::default()
            },
            online_only: true,
        };
        let filters = vec![
            TradeModFilter {
                index: 0,
                text: "+72 to maximum Life".into(),
                trade_id: Some("explicit.stat_life".into()),
                suggested_min: Some(57.6),
                selected: true,
            },
            TradeModFilter {
                index: 1,
                text: "Unknown local text".into(),
                trade_id: None,
                suggested_min: None,
                selected: true,
            },
        ];
        let query = build_query(&item, &input, &filters, &[]);
        assert_eq!(query["query"]["type"], "Iron Greaves");
        assert!(query["query"].get("name").is_none());
        assert_eq!(
            query["query"]["stats"][0]["filters"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            query["query"]["stats"][0]["filters"][0]["value"]["min"],
            55.0
        );
        assert_eq!(
            query["query"]["filters"]["type_filters"]["filters"]["rarity"]["option"],
            "rare"
        );
        assert_eq!(
            query["query"]["filters"]["type_filters"]["filters"]["ilvl"]["min"],
            80.0
        );
        assert_eq!(
            query["query"]["filters"]["equipment_filters"]["filters"]["ar"]["min"],
            400.0
        );
        assert_eq!(
            query["query"]["filters"]["req_filters"]["filters"]["lvl"]["max"],
            70.0
        );
    }

    #[test]
    fn resolves_poe2_clipboard_roll_ranges_against_trade2_stat_text() {
        let item = PoeItem {
            mods: vec![
                ItemMod::new("+147(120-149) to maximum Life", ModType::Explicit),
                ItemMod::new("36(33-38)% increased Armour", ModType::Explicit),
                ItemMod::new("+36(36-40)% to Cold Resistance", ModType::Explicit),
            ],
            ..Default::default()
        };
        let stats = vec![
            StatEntry {
                id: "explicit.stat_life".into(),
                text: "# to maximum Life".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_armour".into(),
                text: "#% increased Armour".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_cold".into(),
                text: "#% to Cold Resistance".into(),
                kind: "explicit".into(),
            },
        ];
        let filters = resolve_filters(&item, &stats, &[]);
        assert_eq!(
            filters
                .iter()
                .map(|filter| filter.trade_id.as_deref())
                .collect::<Vec<_>>(),
            vec![
                Some("explicit.stat_life"),
                Some("explicit.stat_armour"),
                Some("explicit.stat_cold")
            ]
        );
    }

    #[test]
    fn resolves_and_emits_whitelisted_pseudo_stats() {
        let stats = vec![StatEntry {
            id: "pseudo.pseudo_total_elemental_resistance".into(),
            text: "+#% total Elemental Resistance".into(),
            kind: "pseudo".into(),
        }];
        let selected = vec![TradeSelectedPseudo {
            key: "total_elemental_resistance".into(),
            min: Some(81.0),
            max: None,
        }];
        let pseudos = resolve_pseudo_filters(&stats, &selected).expect("pseudo should resolve");
        assert_eq!(
            pseudos[0].trade_id,
            "pseudo.pseudo_total_elemental_resistance"
        );

        let input = TradeSearchInput {
            raw_text: "unused".into(),
            league: "Standard".into(),
            selected_mods: Vec::new(),
            selected_pseudos: selected,
            item_filters: Default::default(),
            online_only: true,
        };
        let query = build_query(&PoeItem::default(), &input, &[], &pseudos);
        assert_eq!(
            query["query"]["stats"][0]["filters"][0]["id"],
            "pseudo.pseudo_total_elemental_resistance"
        );
        assert_eq!(
            query["query"]["stats"][0]["filters"][0]["value"]["min"],
            81.0
        );
    }

    #[test]
    fn resolves_local_equipment_modifiers_to_local_trade_stat_ids() {
        let item = PoeItem {
            item_class: "Gloves".into(),
            armour: 478,
            mods: vec![
                ItemMod::new("+147(120-149) to maximum Life", ModType::Explicit),
                ItemMod::new("36(33-38)% increased Armour", ModType::Explicit),
                ItemMod::new("+144(128-159) to Armour", ModType::Explicit),
            ],
            ..Default::default()
        };
        let stats = vec![
            StatEntry {
                id: "explicit.stat_life".into(),
                text: "# to maximum Life".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_armour_global".into(),
                text: "#% increased Armour".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_armour_local".into(),
                text: "#% increased Armour (Local)".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_flat_armour_global".into(),
                text: "# to Armour".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_flat_armour_local".into(),
                text: "# to Armour (Local)".into(),
                kind: "explicit".into(),
            },
        ];
        let filters = resolve_filters(&item, &stats, &[]);
        assert_eq!(
            filters
                .iter()
                .map(|filter| filter.trade_id.as_deref())
                .collect::<Vec<_>>(),
            vec![
                Some("explicit.stat_life"),
                Some("explicit.stat_armour_local"),
                Some("explicit.stat_flat_armour_local")
            ]
        );
    }

    #[test]
    fn resolves_multiline_modifier_against_trade2_stat_text() {
        let raw = r#"Item Class: Amulets
Rarity: Unique
Aul's Uprising
Onyx Amulet
--------
Damage over Time bypasses your Energy Shield
While not on Full Life, Sacrifice 10% of maximum Mana per Second to Recover that much Life
+35% to Fire Resistance"#;
        let item = crate::trade::parser::parse_poe2_item(raw).expect("Must parse multiline item");
        assert_eq!(item.mods.len(), 2);
        let stats = vec![
            StatEntry {
                id: "explicit.stat_dot_bypasses".into(),
                text: "Damage over Time bypasses your Energy Shield\nWhile not on Full Life, Sacrifice #% of maximum Mana per Second to Recover that much Life".into(),
                kind: "explicit".into(),
            },
            StatEntry {
                id: "explicit.stat_fire".into(),
                text: "#% to Fire Resistance".into(),
                kind: "explicit".into(),
            },
        ];
        let filters = resolve_filters(&item, &stats, &[]);
        assert_eq!(
            filters
                .iter()
                .map(|filter| filter.trade_id.as_deref())
                .collect::<Vec<_>>(),
            vec![
                Some("explicit.stat_dot_bypasses"),
                Some("explicit.stat_fire"),
            ]
        );
        assert_eq!(filters[0].suggested_min, Some(8.0));
    }

    #[test]
    fn rejects_league_path_injection() {
        assert!(validate_league("Standard/../../x").is_err());
        assert!(validate_league("Runes of Aldur").is_ok());
    }

    #[test]
    fn rejects_duplicate_or_inverted_modifier_filters_before_network() {
        let raw = "Item Class: Boots\nRarity: Rare\nDoom Tread\nIron Greaves\n--------\n+35% to Fire Resistance";
        let duplicate = TradeSearchInput {
            raw_text: raw.into(),
            league: "Standard".into(),
            selected_mods: vec![
                TradeSelectedMod {
                    index: 0,
                    min: None,
                    max: None,
                },
                TradeSelectedMod {
                    index: 0,
                    min: None,
                    max: None,
                },
            ],
            selected_pseudos: Vec::new(),
            item_filters: Default::default(),
            online_only: true,
        };
        assert!(search_market(duplicate).is_err());

        let inverted = TradeSearchInput {
            raw_text: raw.into(),
            league: "Standard".into(),
            selected_mods: vec![TradeSelectedMod {
                index: 0,
                min: Some(40.0),
                max: Some(20.0),
            }],
            selected_pseudos: Vec::new(),
            item_filters: Default::default(),
            online_only: true,
        };
        assert!(search_market(inverted).is_err());

        let invalid_item_range = TradeSearchInput {
            raw_text: raw.into(),
            league: "Standard".into(),
            selected_mods: Vec::new(),
            selected_pseudos: Vec::new(),
            item_filters: TradeItemFilters {
                item_level_min: Some(90.0),
                item_level_max: Some(80.0),
                ..Default::default()
            },
            online_only: true,
        };
        assert!(search_market(invalid_item_range).is_err());
    }

    #[test]
    #[ignore = "calls the live GGG Trade2 API"]
    fn live_trade2_search_returns_real_listings() {
        let leagues = list_leagues().expect("GGG should return the current PoE2 leagues");
        assert!(leagues.iter().any(|league| league == "Standard"));
        let result = search_market(TradeSearchInput {
            raw_text: r#"Item Class: Boots
Rarity: Rare
Doom Tread
Iron Greaves
--------
Item Level: 78
--------
+35% to Fire Resistance
+72 to maximum Life"#
                .into(),
            league: "Standard".into(),
            selected_mods: vec![TradeSelectedMod {
                index: 0,
                min: None,
                max: None,
            }],
            selected_pseudos: vec![TradeSelectedPseudo {
                key: "total_elemental_resistance".into(),
                min: Some(30.0),
                max: None,
            }],
            item_filters: TradeItemFilters {
                rarity: Some("rare".into()),
                item_level_min: Some(70.0),
                ..Default::default()
            },
            online_only: false,
        })
        .expect("GGG Trade2 should accept a base-type search");
        assert_eq!(result.source, "pathofexile.com/trade2");
        assert!(!result.query_id.is_empty());
        assert!(!result.trade_url.is_empty());
        assert!(result.filters[0].trade_id.is_some());
    }
}
