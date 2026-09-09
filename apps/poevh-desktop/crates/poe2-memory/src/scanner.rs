//! Pattern / AOB (Array of Bytes) scanner for POE2 memory.
//!
//! Scans POE2 process memory for known byte signatures and automatically
//! resolves RIP-relative instruction displacements to dynamic base pointers.

use crate::process::{ModuleScanInfo, ProcessHandle};
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tracing::info;

type BuildKey = (u32, u32);
type ResolvedCache = Mutex<HashMap<BuildKey, u64>>;
type CandidateCache = Mutex<HashMap<BuildKey, Vec<u64>>>;

static RESOLVED_RVA_CACHE: OnceLock<ResolvedCache> = OnceLock::new();
static CANDIDATE_RVA_CACHE: OnceLock<CandidateCache> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct Pattern {
    pub name: &'static str,
    pub bytes: Vec<Option<u8>>,
    /// Instruction offset where the 32-bit RIP relative displacement starts (usually 3 for `mov rax, [rip+disp32]`)
    pub disp_offset: usize,
    /// Total instruction length after which RIP is calculated (usually 7 for 7-byte mov)
    pub insn_len: usize,
}

impl Pattern {
    /// Parse IDA-style pattern: e.g. `"48 8B 05 ? ? ? ? 48 8B"`
    pub fn from_ida(
        name: &'static str,
        pattern: &str,
        disp_offset: usize,
        insn_len: usize,
    ) -> Self {
        let bytes = pattern
            .split_whitespace()
            .map(|s| {
                if s == "?" || s == "??" {
                    None
                } else {
                    u8::from_str_radix(s, 16).ok()
                }
            })
            .collect();
        Self {
            name,
            bytes,
            disp_offset,
            insn_len,
        }
    }

    /// Check if memory slice matches the pattern
    pub fn matches(&self, slice: &[u8]) -> bool {
        if slice.len() < self.bytes.len() {
            return false;
        }
        for (i, expected) in self.bytes.iter().enumerate() {
            if let Some(b) = expected {
                if slice[i] != *b {
                    return false;
                }
            }
        }
        true
    }
}

pub struct PatternScanner;

impl PatternScanner {
    /// Standard POE2 signatures for GameStateController across patches.
    pub fn standard_patterns() -> Vec<Pattern> {
        vec![Pattern::from_ida(
            "GameStates_2026_09",
            "48 39 2D ? ? ? ? 0F 85 ? ? ? ? B9 ? ? ? ? E8 ? ? ? ? 48 8B F8 48 89 44 24 50",
            3,
            7,
        )]
    }

    /// Scan the module memory space of POE2 for a given pattern and resolve RIP-relative target.
    pub fn scan_pattern(
        proc: &ProcessHandle,
        base: u64,
        size: usize,
        pattern: &Pattern,
    ) -> Result<u64> {
        info!(pattern = pattern.name, "🔍 Scanning memory for signature…");

        // Read memory in 64KB chunks with overlap to avoid missing boundary patterns
        let chunk_size = 0x10000;
        let overlap = pattern.bytes.len();
        let mut buffer = vec![0u8; chunk_size + overlap];

        let mut offset = 0;
        while offset < size {
            let read_len = (size - offset).min(chunk_size + overlap);
            let read_slice = &mut buffer[..read_len];

            if proc.read_bytes(base + offset as u64, read_slice).is_ok() {
                let scan_limit = if read_len >= pattern.bytes.len() {
                    read_len - pattern.bytes.len() + 1
                } else {
                    0
                };

                let anchor = pattern
                    .bytes
                    .iter()
                    .enumerate()
                    .find_map(|(index, byte)| byte.map(|value| (index, value)));
                let mut candidate = 0;
                while candidate < scan_limit {
                    let Some((anchor_index, anchor_byte)) = anchor else {
                        break;
                    };
                    let search_start = candidate + anchor_index;
                    let Some(relative) = read_slice[search_start..read_len]
                        .iter()
                        .position(|byte| *byte == anchor_byte)
                    else {
                        break;
                    };
                    let anchor_position = search_start + relative;
                    if anchor_position < anchor_index {
                        break;
                    }
                    candidate = anchor_position - anchor_index;
                    if candidate < scan_limit && pattern.matches(&read_slice[candidate..]) {
                        let match_addr = base + offset as u64 + candidate as u64;

                        // Read 32-bit displacement relative to (match_addr + insn_len)
                        let disp_addr = match_addr + pattern.disp_offset as u64;
                        let disp: i32 = proc.read(disp_addr)?;

                        let resolved =
                            (match_addr + pattern.insn_len as u64).wrapping_add(disp as i64 as u64);

                        info!(
                            pattern = pattern.name,
                            match_addr = format!("{match_addr:#x}"),
                            resolved = format!("{resolved:#x}"),
                            "✨ Signature matched! Base pointer dynamically resolved"
                        );
                        return Ok(resolved);
                    }
                    candidate += 1;
                }
            }
            offset += chunk_size;
        }

        bail!(
            "Pattern '{}' not found in scanned range ({:#x} bytes)",
            pattern.name,
            size
        );
    }

    /// Return every distinct RIP-resolved slot. The current GameStates
    /// signature intentionally wildcards the JNZ displacement and can match a
    /// handful of locations, so callers must validate the complete live chain.
    pub fn scan_resolved_addresses(
        proc: &ProcessHandle,
        base: u64,
        size: usize,
        pattern: &Pattern,
    ) -> Result<Vec<u64>> {
        let chunk_size = 0x10000usize;
        let overlap = pattern.bytes.len().saturating_sub(1);
        let mut matches = Vec::new();
        let mut offset = 0usize;
        while offset < size {
            let read_len = (size - offset).min(chunk_size + overlap);
            let mut buffer = vec![0u8; read_len];
            if proc.read_bytes(base + offset as u64, &mut buffer).is_ok() {
                let limit = read_len.saturating_sub(pattern.bytes.len()) + 1;
                for candidate in 0..limit {
                    if !pattern.matches(&buffer[candidate..]) {
                        continue;
                    }
                    let match_addr = base + offset as u64 + candidate as u64;
                    let disp = proc.read::<i32>(match_addr + pattern.disp_offset as u64)?;
                    let resolved =
                        (match_addr + pattern.insn_len as u64).wrapping_add(disp as i64 as u64);
                    matches.push(resolved);
                }
            }
            offset = offset.saturating_add(chunk_size);
        }
        matches.sort_unstable();
        matches.dedup();
        if matches.is_empty() {
            bail!("Pattern '{}' not found", pattern.name);
        }
        Ok(matches)
    }

    /// Automatically find GameStateController pointer using available patterns.
    pub fn find_game_state_controller(proc: &ProcessHandle, module: ModuleScanInfo) -> Result<u64> {
        let build_key = (module.timestamp, module.image_size);
        if let Some(rva) = RESOLVED_RVA_CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .ok()
            .and_then(|cache| cache.get(&build_key).copied())
        {
            let resolved = module.base.saturating_add(rva);
            if rva < module.image_size as u64 && Self::valid_game_state_slot(proc, resolved) {
                info!(
                    timestamp = module.timestamp,
                    rva = format!("{rva:#x}"),
                    "Using cached GameStateController RVA"
                );
                return Ok(resolved);
            }
        }

        if let Some(candidates) = CANDIDATE_RVA_CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .ok()
            .and_then(|cache| cache.get(&build_key).cloned())
        {
            for rva in &candidates {
                let slot = module.base.saturating_add(*rva);
                if Self::valid_game_state_slot(proc, slot) {
                    if let Ok(mut cache) = RESOLVED_RVA_CACHE
                        .get_or_init(|| Mutex::new(HashMap::new()))
                        .lock()
                    {
                        cache.insert(build_key, *rva);
                    }
                    return Ok(slot);
                }
            }
            if !candidates.is_empty() {
                bail!(
                    "GAME_NOT_IN_AREA: cached GameStates signature slots exist, but no live area/player chain is available"
                );
            }
        }

        let mut signature_matches = 0usize;
        for pat in Self::standard_patterns() {
            let Ok(addresses) =
                Self::scan_resolved_addresses(proc, module.text_base, module.text_size, &pat)
            else {
                continue;
            };
            signature_matches += addresses.len();
            if let Ok(mut cache) = CANDIDATE_RVA_CACHE
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
            {
                cache.insert(
                    build_key,
                    addresses
                        .iter()
                        .map(|address| address.saturating_sub(module.base))
                        .collect(),
                );
            }
            for addr in addresses {
                if !Self::valid_game_state_slot(proc, addr) {
                    continue;
                }
                if let Ok(mut cache) = RESOLVED_RVA_CACHE
                    .get_or_init(|| Mutex::new(HashMap::new()))
                    .lock()
                {
                    cache.insert(build_key, addr.saturating_sub(module.base));
                }
                return Ok(addr);
            }
        }
        if signature_matches > 0 {
            bail!(
                "GAME_NOT_IN_AREA: GameStates signature matched {signature_matches} slot(s), but no live area/player chain is available"
            );
        }
        bail!("All GameStateController signatures failed to match in POE2 memory")
    }

    fn valid_game_state_slot(proc: &ProcessHandle, slot: u64) -> bool {
        use crate::offsets::Offsets;
        let Ok(game_state) = proc.read::<u64>(slot) else {
            return false;
        };
        if game_state == 0 {
            return false;
        }
        let mut candidates = Vec::with_capacity(Offsets::GAME_STATE_SLOT_COUNT + 1);
        if let Ok(vector_first) = proc.read::<u64>(game_state + Offsets::GAME_STATE_CURRENT_VECTOR)
        {
            if let Ok(active) = proc.read::<u64>(vector_first) {
                candidates.push(active);
            }
        }
        for index in 0..Offsets::GAME_STATE_SLOT_COUNT {
            if let Ok(candidate) = proc.read::<u64>(
                game_state
                    + Offsets::GAME_STATE_STATES
                    + index as u64 * Offsets::GAME_STATE_SLOT_STRIDE,
            ) {
                candidates.push(candidate);
            }
        }
        candidates.into_iter().any(|in_game| {
            if in_game == 0 {
                return false;
            }
            let area = proc
                .read::<u64>(in_game + Offsets::INGAME_AREA_INSTANCE)
                .unwrap_or(0);
            let player = proc
                .read::<u64>(area + Offsets::LOCAL_PLAYER_OFFSET)
                .unwrap_or(0);
            let details = proc
                .read::<u64>(player + Offsets::ENTITY_DETAILS)
                .unwrap_or(0);
            let metadata = proc
                .read_std_wstring(details + Offsets::DETAILS_METADATA)
                .unwrap_or_default();
            metadata.starts_with("Metadata/")
        })
    }
}
