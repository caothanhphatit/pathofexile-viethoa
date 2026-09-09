//! Trade and item pricing domain models for Path of Exile 2.
//!
//! Inspired by Awakened PoE Trade, structured for zero-overhead parsing
//! and UI consumption.

use serde::{Deserialize, Serialize};

/// Item rarity tier in PoE2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ItemRarity {
    #[default]
    Normal,
    Magic,
    Rare,
    Unique,
    Currency,
    Gem,
    Waystone,
    Unknown,
}

impl ItemRarity {
    pub fn parse_label(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "normal" => Self::Normal,
            "magic" => Self::Magic,
            "rare" => Self::Rare,
            "unique" => Self::Unique,
            "currency" => Self::Currency,
            "gem" => Self::Gem,
            "waystone" | "waystones" => Self::Waystone,
            _ => Self::Unknown,
        }
    }

    pub fn display_vn(&self) -> &'static str {
        match self {
            Self::Normal => "Thường (Trắng)",
            Self::Magic => "Ma Thuật (Xanh)",
            Self::Rare => "Hiếm (Vàng)",
            Self::Unique => "Độc Nhất (Cam)",
            Self::Currency => "Tiền Tệ (Currency)",
            Self::Gem => "Ngọc (Gem)",
            Self::Waystone => "Đá Waystone",
            Self::Unknown => "Không xác định",
        }
    }

    pub fn color_hex(&self) -> &'static str {
        match self {
            Self::Normal => "#c8c8c8",
            Self::Magic => "#8888ff",
            Self::Rare => "#ffff77",
            Self::Unique => "#af6025",
            Self::Currency => "#aa9e82",
            Self::Gem => "#1ba29b",
            Self::Waystone => "#d4b060",
            Self::Unknown => "#999999",
        }
    }
}

/// Category of modifier on an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModType {
    Implicit,
    #[default]
    Explicit,
    Rune,
    Enchant,
    Monster,
}

/// A parsed modifier with extracted numeric rolls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ItemMod {
    pub text: String,
    pub mod_type: ModType,
    pub values: Vec<f64>,
    pub is_selected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
}

impl ItemMod {
    pub fn new(text: impl Into<String>, mod_type: ModType) -> Self {
        let text = text.into();
        let values = extract_numbers(&text);
        Self {
            text,
            mod_type,
            values,
            is_selected: true,
            tier: None,
        }
    }
}

/// Extract float numbers from modifier strings.
fn extract_numbers(s: &str) -> Vec<f64> {
    let mut numbers = Vec::new();
    let mut current = String::new();
    let mut in_num = false;

    for ch in s.chars() {
        if ch.is_ascii_digit()
            || (ch == '.' && in_num && !current.contains('.'))
            || (ch == '-' && !in_num)
        {
            current.push(ch);
            in_num = true;
        } else {
            if in_num {
                if let Ok(n) = current.parse::<f64>() {
                    numbers.push(n);
                }
                current.clear();
                in_num = false;
            }
        }
    }
    if in_num {
        if let Ok(n) = current.parse::<f64>() {
            numbers.push(n);
        }
    }
    numbers
}

/// A fully parsed Path of Exile 2 item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PoeItem {
    pub raw_text: String,
    pub item_class: String,
    pub rarity: ItemRarity,
    pub name: String,
    pub base_type: String,
    pub quality: u32,
    pub item_level: u32,
    pub waystone_tier: Option<u32>,
    pub sockets: Option<String>,
    pub armour: u32,
    pub evasion: u32,
    pub energy_shield: u32,
    #[serde(default)]
    pub spirit: u32,
    pub requirements_level: u32,
    /// Human-readable requirement rows preserved from the clipboard. Keeping
    /// the original rows lets the overlay render the same visual hierarchy as
    /// the in-game tooltip without treating requirements as trade modifiers.
    #[serde(default)]
    pub requirements: Vec<String>,
    pub corrupted: bool,
    pub unidentified: bool,
    pub mirrored: bool,
    pub mods: Vec<ItemMod>,
}

impl PoeItem {
    pub fn display_title(&self) -> String {
        if !self.name.is_empty() && !self.base_type.is_empty() && self.name != self.base_type {
            format!("{} — {}", self.name, self.base_type)
        } else if !self.name.is_empty() {
            self.name.clone()
        } else if !self.base_type.is_empty() {
            self.base_type.clone()
        } else {
            "Vật phẩm chưa định danh".to_string()
        }
    }
}

/// Estimated market price from the valuation engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceEstimate {
    pub primary_currency: String,
    pub min_price: f64,
    pub median_price: f64,
    pub max_price: f64,
    pub chaos_equivalent: f64,
    pub confidence: String,
    pub note: String,
    pub sample_count: usize,
}

impl Default for PriceEstimate {
    fn default() -> Self {
        Self {
            primary_currency: "Exalted Orb".to_string(),
            min_price: 1.0,
            median_price: 1.5,
            max_price: 2.5,
            chaos_equivalent: 45.0,
            confidence: "Tham khảo".to_string(),
            note: "Dựa trên định giá hệ thống cho dòng trang bị và bậc phẩm chất".to_string(),
            sample_count: 10,
        }
    }
}

/// Query for price search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceCheckQuery {
    pub item: PoeItem,
    pub selected_mod_indices: Vec<usize>,
    pub league: String,
}

/// One stat filter selected by the user for an official trade search.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TradeSelectedMod {
    pub index: usize,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// A derived Trade2 pseudo-stat selected by the user. `key` is intentionally
/// a small domain identifier rather than a raw GGG stat id; the backend maps
/// it against the live stat catalogue and rejects unknown values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TradeSelectedPseudo {
    pub key: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Optional structured filters exposed by the price-check UI. These map only
/// to documented filter identifiers returned by GGG's live Trade2 catalogue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TradeItemFilters {
    pub rarity: Option<String>,
    pub item_level_min: Option<f64>,
    pub item_level_max: Option<f64>,
    pub quality_min: Option<f64>,
    pub quality_max: Option<f64>,
    pub armour_min: Option<f64>,
    pub armour_max: Option<f64>,
    pub evasion_min: Option<f64>,
    pub evasion_max: Option<f64>,
    pub energy_shield_min: Option<f64>,
    pub energy_shield_max: Option<f64>,
    pub rune_sockets_min: Option<f64>,
    pub rune_sockets_max: Option<f64>,
    pub requirement_level_min: Option<f64>,
    pub requirement_level_max: Option<f64>,
}

/// Input accepted by the local trade proxy. The item text always originates
/// from PoE's clipboard format; callers cannot supply arbitrary API JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TradeSearchInput {
    pub raw_text: String,
    pub league: String,
    #[serde(default)]
    pub selected_mods: Vec<TradeSelectedMod>,
    #[serde(default)]
    pub selected_pseudos: Vec<TradeSelectedPseudo>,
    #[serde(default)]
    pub item_filters: TradeItemFilters,
    #[serde(default = "default_online_only")]
    pub online_only: bool,
}

fn default_online_only() -> bool {
    true
}

/// Resolution status for an item modifier against GGG's live trade stat data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TradeModFilter {
    pub index: usize,
    pub text: String,
    pub trade_id: Option<String>,
    pub suggested_min: Option<f64>,
    pub selected: bool,
}

/// A real listing returned by GGG's trade2 search/fetch endpoints.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TradeListing {
    pub id: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub account: String,
    pub character: String,
    pub indexed: String,
    pub online: bool,
    pub item_level: Option<u32>,
    pub quality: Option<String>,
    pub stack_size: Option<u32>,
    #[serde(default)]
    pub item_name: String,
    #[serde(default)]
    pub base_type: String,
    #[serde(default)]
    pub rarity: String,
    #[serde(default)]
    pub properties: Vec<String>,
    #[serde(default)]
    pub requirements: Vec<String>,
    #[serde(default)]
    pub implicit_mods: Vec<String>,
    #[serde(default)]
    pub explicit_mods: Vec<String>,
    #[serde(default)]
    pub rune_mods: Vec<String>,
}

/// Result of one official Path of Exile 2 trade query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TradeMarketResult {
    pub source: String,
    pub query_id: String,
    pub league: String,
    pub total: usize,
    pub inexact: bool,
    pub item: PoeItem,
    pub filters: Vec<TradeModFilter>,
    pub listings: Vec<TradeListing>,
    pub trade_url: String,
}

/// Latest hotkey capture. The revision lets the overlay poll without replaying
/// an older item when it is reopened.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TradeCaptureSnapshot {
    pub revision: u64,
    pub status: String,
    pub raw_text: Option<String>,
    pub item: Option<PoeItem>,
    pub error: Option<String>,
}
