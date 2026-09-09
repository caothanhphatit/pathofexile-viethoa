//! POE2 memory reader — reads live game state via ReadProcessMemory.
//!
//! Uses signature scanning (AOB) and public POE2 structure patterns.
//! Does NOT write to process memory, inject code, or hook functions.

pub mod adapter;
pub mod navigation;
pub mod offsets;
pub mod process;
pub mod reader;
pub mod scanner;

pub use adapter::MemoryWorldAdapter;
pub use scanner::{Pattern, PatternScanner};
