//! Trade and price checking engine for Path of Exile 2.
//!
//! Provides item clipboard ingestion, structural parsing, and market valuation.

pub mod clipboard;
pub mod hotkey;
pub mod market;
pub mod parser;
pub mod rates;

pub use clipboard::read_clipboard_text;
pub use hotkey::spawn_hotkey_listener;
pub use market::{
    clear_capture, latest_capture, list_leagues, publish_capture, publish_capture_error,
    search_market,
};
pub use parser::parse_poe2_item;
pub use rates::estimate_item_price;

use anyhow::Result;
use poe2_types::trade::{PoeItem, PriceEstimate};

/// Capture current item from Windows clipboard and compute price estimate.
pub fn check_item_from_clipboard() -> Result<(PoeItem, PriceEstimate)> {
    let raw = read_clipboard_text()?;
    let item = parse_poe2_item(&raw)?;
    let estimate = estimate_item_price(&item);
    Ok((item, estimate))
}
