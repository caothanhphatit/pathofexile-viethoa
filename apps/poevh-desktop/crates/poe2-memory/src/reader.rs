//! High-level game state reader built on top of ProcessHandle + Offsets + PatternScanner.

use crate::{
    navigation::TerrainGrid, offsets::Offsets, process::ProcessHandle, scanner::PatternScanner,
};
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

// ─── Raw structs (as read from memory) ──────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct RawActor {
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub hp: u8,   // 0-100 %
    pub mana: u8, // 0-100 %
    pub area: String,
}

#[derive(Debug, Clone, Default)]
pub struct RawWorldState {
    pub local_player: RawActor,
    pub nearby: Vec<RawActor>,
    pub area_name: String,
    pub expedition: Vec<RawRuneStation>,
    pub area_id: u64,
    pub area_level: u16,
    pub terrain: Option<Arc<TerrainGrid>>,
    pub loot: Vec<RawLootItem>,
    pub loot_health: LootReaderHealth,
}

#[derive(Debug, Clone, Default)]
pub struct RawLootItem {
    pub source_id: u64,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub rarity: Option<poe2_types::ItemRarity>,
    pub identified: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct LootReaderHealth {
    pub candidates: usize,
    pub decoded: usize,
    pub consecutive_schema_failures: u8,
    pub schema_ok: bool,
}

#[derive(Debug, Clone, Default)]
pub struct RawRuneStation {
    pub address: u64,
    pub slot_count: u16,
    pub anchor_idx: i16,
    pub anchor_position: i16,
    pub anchor_name: String,
    pub unique: bool,
}

const RUNE_NAMES: [&str; 34] = [
    "Fire",
    "Cold",
    "Lightning",
    "Tempest",
    "Momentum",
    "Bloodletting",
    "Stone",
    "Adaptive",
    "Arcane",
    "Toxic",
    "Electrocuting",
    "Protective",
    "Cyclonic",
    "Vision",
    "Tidal",
    "Rebirth",
    "Prismatic",
    "Gasp",
    "Moon",
    "Celestial",
    "Opulent",
    "Rage",
    "Wisdom",
    "Sky",
    "Earth",
    "Life",
    "Bond",
    "Ward",
    "Soul",
    "Death",
    "Oath",
    "Time",
    "Power",
    "Bait",
];

// ─── Reader ──────────────────────────────────────────────────────────────────

pub struct GameStateReader {
    proc: ProcessHandle,
    #[allow(dead_code)]
    pub module_base: u64,
    pub game_state_ctrl_ptr: u64,
    build_key: String,
    expedition_scan: Arc<Mutex<ExpeditionScanState>>,
    terrain_cache: Mutex<TerrainCache>,
    actor_cache: Mutex<ActorEntityCache>,
    loot_cache: Mutex<LootCache>,
}

#[derive(Default)]
struct TerrainCache {
    area: u64,
    generation: u64,
    terrain: Option<Arc<TerrainGrid>>,
    last_attempt: Option<Instant>,
}

#[derive(Default)]
struct ActorEntityCache {
    area: u64,
    entities: Vec<u64>,
    refreshed_at: Option<Instant>,
}

#[derive(Default)]
struct LootCache {
    area: u64,
    items: Vec<RawLootItem>,
    refreshed_at: Option<Instant>,
    identities: std::collections::HashMap<u64, LootIdentity>,
    classifications: std::collections::HashMap<u64, (u64, bool)>,
    consecutive_schema_failures: u8,
    announced_area: bool,
}

#[derive(Debug, Clone)]
struct LootIdentity {
    address: u64,
    render: u64,
    name: String,
    rarity: Option<poe2_types::ItemRarity>,
    identified: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
struct EntityRef {
    id: u64,
    address: u64,
}

#[derive(Debug, Default)]
struct ExpeditionScanState {
    area: u64,
    result: Vec<RawRuneStation>,
    last_attempt: Option<Instant>,
    in_flight: bool,
}

impl ExpeditionScanState {
    fn prepare(
        &mut self,
        enabled: bool,
        area: u64,
        retry_interval: Duration,
    ) -> (Vec<RawRuneStation>, bool) {
        if !enabled || area == 0 {
            *self = Self::default();
            return (Vec::new(), false);
        }
        if self.area != area {
            self.area = area;
            self.result.clear();
            self.last_attempt = None;
            self.in_flight = false;
        }
        let snapshot = self.result.clone();
        let due = self.result.is_empty()
            && !self.in_flight
            && self
                .last_attempt
                .is_none_or(|last| last.elapsed() >= retry_interval);
        if due {
            self.in_flight = true;
            self.last_attempt = Some(Instant::now());
        }
        (snapshot, due)
    }
}

impl GameStateReader {
    pub fn attach() -> Result<Self> {
        let proc = ProcessHandle::open_poe2()?;
        Self::attach_process(proc)
    }

    pub fn attach_pid(pid: u32) -> Result<Self> {
        Self::attach_process(ProcessHandle::open(pid)?)
    }

    fn attach_process(proc: ProcessHandle) -> Result<Self> {
        let module = proc.module_scan_info()?;
        let module_base = module.base;
        info!(
            pid = proc.pid,
            base = format!("{module_base:#x}"),
            "Attached to POE2"
        );

        let build_key = format!("pe:{:08X}-{:08X}", module.timestamp, module.image_size);
        // Never guess a static address on an unknown build. A wrong pointer can
        // remain readable while producing plausible-but-false actor data.
        let game_state_ctrl_ptr = PatternScanner::find_game_state_controller(&proc, module)
            .map_err(|error| {
                anyhow::anyhow!(
                    "UNSUPPORTED_POE2_BUILD {build_key}: GameStateController AOB không khớp ({error})"
                )
            })?;
        info!(
            addr = format!("{game_state_ctrl_ptr:#x}"),
            %build_key,
            "🎯 Using dynamic GameStateController pointer from AOB scan"
        );

        Ok(Self {
            proc,
            module_base,
            game_state_ctrl_ptr,
            build_key,
            expedition_scan: Arc::new(Mutex::new(ExpeditionScanState::default())),
            terrain_cache: Mutex::new(TerrainCache::default()),
            actor_cache: Mutex::new(ActorEntityCache::default()),
            loot_cache: Mutex::new(LootCache::default()),
        })
    }

    pub fn build_key(&self) -> &str {
        &self.build_key
    }

    pub fn pid(&self) -> u32 {
        self.proc.pid
    }

    /// Read current world state. Returns None if the game is in a loading screen.
    pub fn read_state(&self) -> Option<RawWorldState> {
        match self.try_read_state() {
            Ok(s) => Some(s),
            Err(e) => {
                debug!("read_state failed: {e}");
                None
            }
        }
    }

    /// Read state while throttling the expensive Expedition tree walk.
    /// Other player/entity fields remain live on every tick.
    pub fn read_state_throttled(
        &self,
        expedition_enabled: bool,
        expedition_interval_ms: u64,
    ) -> Option<RawWorldState> {
        let interval = Duration::from_millis(expedition_interval_ms.clamp(100, 5_000));
        match self.try_read_state_with_interval(expedition_enabled, interval) {
            Ok(s) => Some(s),
            Err(e) => {
                debug!("read_state failed: {e}");
                None
            }
        }
    }

    fn try_read_state(&self) -> Result<RawWorldState> {
        self.try_read_state_with_interval(true, Duration::from_millis(100))
    }

    fn try_read_state_with_interval(
        &self,
        expedition_enabled: bool,
        expedition_interval: Duration,
    ) -> Result<RawWorldState> {
        let (_ig_state, area_ptr, player_ptr) = self.resolve_live_chain()?;

        // ── Area name ────────────────────────────────────────────────────
        let area_name = self
            .read_area_name(area_ptr)
            .unwrap_or_else(|_| "Unknown".into());
        let expedition =
            self.expedition_snapshot(area_ptr, expedition_enabled, expedition_interval);
        let generation = self
            .proc
            .read::<u32>(area_ptr + Offsets::AREA_HASH)
            .unwrap_or_default() as u64;
        let terrain = self.terrain_snapshot(area_ptr, generation);
        let (loot, loot_health) = self.loot_snapshot(area_ptr);

        // ── Local player ─────────────────────────────────────────────────
        let local = self.read_actor(player_ptr, &area_name).unwrap_or_default();

        // ── Nearby entity list (party members + nearby actors) ────────────
        let mut nearby = Vec::new();
        for eptr in self.nearby_entity_snapshot(area_ptr) {
            if eptr == player_ptr {
                continue;
            }
            if let Ok(actor) = self.read_actor(eptr, &area_name) {
                if !actor.name.is_empty() {
                    nearby.push(actor);
                }
            }
        }

        Ok(RawWorldState {
            local_player: local,
            nearby,
            area_name,
            expedition,
            area_id: area_ptr,
            area_level: if area_ptr != 0 {
                self.proc
                    .read::<i32>(area_ptr + Offsets::AREA_LEVEL)
                    .unwrap_or(0)
                    .clamp(0, 100) as u16
            } else {
                0
            },
            terrain,
            loot,
            loot_health,
        })
    }

    fn resolve_live_chain(&self) -> Result<(u64, u64, u64)> {
        let game_state = self.proc.read::<u64>(self.game_state_ctrl_ptr)?;
        if game_state == 0 {
            anyhow::bail!("GameState null");
        }
        let mut candidates = Vec::with_capacity(Offsets::GAME_STATE_SLOT_COUNT + 1);
        if let Ok(first) = self
            .proc
            .read::<u64>(game_state + Offsets::GAME_STATE_CURRENT_VECTOR)
        {
            if let Ok(active) = self.proc.read::<u64>(first) {
                candidates.push(active);
            }
        }
        for index in 0..Offsets::GAME_STATE_SLOT_COUNT {
            if let Ok(candidate) = self.proc.read::<u64>(
                game_state
                    + Offsets::GAME_STATE_STATES
                    + index as u64 * Offsets::GAME_STATE_SLOT_STRIDE,
            ) {
                candidates.push(candidate);
            }
        }
        for in_game in candidates {
            if in_game == 0 {
                continue;
            }
            let area = self
                .proc
                .read::<u64>(in_game + Offsets::INGAME_AREA_INSTANCE)
                .unwrap_or(0);
            let player = self
                .proc
                .read::<u64>(area + Offsets::LOCAL_PLAYER_OFFSET)
                .unwrap_or(0);
            if player == 0 {
                continue;
            }
            let details = self
                .proc
                .read::<u64>(player + Offsets::ENTITY_DETAILS)
                .unwrap_or(0);
            let metadata = self
                .proc
                .read_std_wstring(details + Offsets::DETAILS_METADATA)
                .unwrap_or_default();
            if metadata.starts_with("Metadata/") {
                return Ok((in_game, area, player));
            }
        }
        anyhow::bail!("no validated InGameState/AreaInstance/LocalPlayer chain")
    }

    fn terrain_snapshot(&self, area: u64, generation: u64) -> Option<Arc<TerrainGrid>> {
        let mut cache = self.terrain_cache.lock();
        let same_area = cache.area == area && cache.generation == generation;
        if same_area && cache.terrain.is_some() {
            return cache.terrain.clone();
        }
        if same_area
            && cache
                .last_attempt
                .is_some_and(|last| last.elapsed() < Duration::from_secs(2))
        {
            return None;
        }
        let terrain = Self::read_terrain(&self.proc, area, generation).map(Arc::new);
        cache.area = area;
        cache.generation = generation;
        cache.terrain = terrain.clone();
        cache.last_attempt = Some(Instant::now());
        terrain
    }

    fn nearby_entity_snapshot(&self, area: u64) -> Vec<u64> {
        let mut cache = self.actor_cache.lock();
        let refresh = cache.area != area
            || cache
                .refreshed_at
                .is_none_or(|last| last.elapsed() >= Duration::from_secs(2));
        if refresh {
            cache.area = area;
            cache.entities =
                Self::read_entity_map(&self.proc, area, Offsets::AREA_AWAKE_ENTITIES, 8192)
                    .into_iter()
                    .map(|entity| entity.address)
                    .collect();
            cache.refreshed_at = Some(Instant::now());
        }
        cache.entities.clone()
    }

    /// Read dropped items from the live entity maps. The short cache keeps
    /// pickup responsive without scanning the maps on every movement tick.
    fn loot_snapshot(&self, area: u64) -> (Vec<RawLootItem>, LootReaderHealth) {
        let mut cache = self.loot_cache.lock();
        if cache.area == area
            && cache
                .refreshed_at
                .is_some_and(|at| at.elapsed() < Duration::from_millis(400))
        {
            return (
                cache.items.clone(),
                LootReaderHealth {
                    candidates: cache.items.len(),
                    decoded: cache.items.len(),
                    consecutive_schema_failures: cache.consecutive_schema_failures,
                    schema_ok: cache.consecutive_schema_failures < 3,
                },
            );
        }

        if cache.area != area {
            cache.area = area;
            cache.items.clear();
            cache.identities.clear();
            cache.classifications.clear();
            cache.consecutive_schema_failures = 0;
            cache.announced_area = false;
        }
        let started = Instant::now();
        let mut items = Vec::new();
        let mut candidates = 0usize;
        let entities =
            Self::read_entity_map(&self.proc, area, Offsets::AREA_AWAKE_ENTITIES, 20_000);
        let live_ids = entities
            .iter()
            .map(|entity| entity.id)
            .collect::<std::collections::HashSet<_>>();
        cache.identities.retain(|id, _| live_ids.contains(id));
        cache.classifications.retain(|id, _| live_ids.contains(id));
        for entity in entities {
            let is_world_item = match cache.classifications.get(&entity.id) {
                Some((address, classified)) if *address == entity.address => *classified,
                _ => {
                    let classified = Self::is_world_item(&self.proc, entity.address);
                    cache
                        .classifications
                        .insert(entity.id, (entity.address, classified));
                    classified
                }
            };
            if !is_world_item {
                continue;
            }
            candidates += 1;
            let identity = match cache.identities.get(&entity.id) {
                Some(identity) if identity.address == entity.address => Some(identity.clone()),
                _ => Self::read_world_item_identity(&self.proc, entity).inspect(|identity| {
                    cache.identities.insert(entity.id, identity.clone());
                }),
            };
            if let Some(identity) = identity {
                if let Some(item) = Self::read_world_item_position(&self.proc, entity.id, &identity)
                {
                    items.push(item);
                }
            }
        }
        if candidates > 0 && items.is_empty() {
            cache.consecutive_schema_failures = cache.consecutive_schema_failures.saturating_add(1);
            warn!(
                area = format_args!("{area:#x}"),
                candidates,
                failures = cache.consecutive_schema_failures,
                "loot.scan schema validation failed: WorldItem candidates could not be decoded"
            );
        } else {
            if candidates > 0 && cache.consecutive_schema_failures > 0 {
                info!(
                    candidates,
                    decoded = items.len(),
                    "loot.scan recovered successfully"
                );
            }
            cache.consecutive_schema_failures = 0;
        }
        if !cache.announced_area {
            info!(
                area = format_args!("{area:#x}"),
                candidates,
                decoded = items.len(),
                elapsed_ms = started.elapsed().as_millis(),
                "loot.scan ready for current area"
            );
            cache.announced_area = true;
        } else {
            debug!(
                candidates,
                decoded = items.len(),
                elapsed_ms = started.elapsed().as_millis(),
                "loot.scan completed"
            );
        }
        for item in &items {
            debug!(
                item_id = item.source_id,
                name = %item.name,
                x = item.x,
                y = item.y,
                rarity = ?item.rarity,
                identified = ?item.identified,
                "loot.scan decoded item"
            );
        }
        cache.items = items;
        cache.refreshed_at = Some(Instant::now());
        let health = LootReaderHealth {
            candidates,
            decoded: cache.items.len(),
            consecutive_schema_failures: cache.consecutive_schema_failures,
            schema_ok: cache.consecutive_schema_failures < 3,
        };
        (cache.items.clone(), health)
    }

    fn is_world_item(proc: &ProcessHandle, entity: u64) -> bool {
        let details = proc
            .read::<u64>(entity + Offsets::ENTITY_DETAILS)
            .unwrap_or(0);
        details != 0
            && proc
                .read_std_wstring(details + Offsets::DETAILS_METADATA)
                .is_ok_and(|metadata| metadata.contains("WorldItem"))
    }

    fn read_world_item_identity(proc: &ProcessHandle, entity: EntityRef) -> Option<LootIdentity> {
        let render = Self::resolve_component(proc, entity.address, "Render")?;
        let world_item = Self::resolve_component(proc, entity.address, "WorldItem")?;
        let item_entity = proc
            .read::<u64>(world_item + Offsets::WORLD_ITEM_COMPONENT_ITEM_ENTITY)
            .ok()?;
        let base = Self::resolve_component(proc, item_entity, "Base")?;
        let name_row = proc
            .read::<u64>(base + Offsets::BASE_COMPONENT_NAME_ROW)
            .ok()?;
        // Base row +0x30 is a pointer to UTF-16 data, not an inline
        // std::wstring. Dereferencing this pointer is required on PoE2 0.5.5.
        let name_ptr = proc
            .read::<u64>(name_row + Offsets::BASE_ROW_DISPLAY_NAME)
            .ok()?;
        let name = proc.read_wstring(name_ptr).ok()?.trim().to_string();
        if name.is_empty() {
            return None;
        }
        let mods = Self::resolve_component(proc, item_entity, "Mods");
        let rarity = mods.and_then(|mods| {
            match proc
                .read::<i32>(mods + Offsets::MODS_COMPONENT_RARITY)
                .ok()?
            {
                0 => Some(poe2_types::ItemRarity::Normal),
                1 => Some(poe2_types::ItemRarity::Magic),
                2 => Some(poe2_types::ItemRarity::Rare),
                3 => Some(poe2_types::ItemRarity::Unique),
                _ => None,
            }
        });
        let identified = mods.and_then(|mods| {
            proc.read::<i32>(mods + Offsets::MODS_COMPONENT_IDENTIFIED)
                .ok()
                .map(|value| value != 0)
        });
        Some(LootIdentity {
            address: entity.address,
            render,
            name,
            rarity,
            identified,
        })
    }

    fn read_world_item_position(
        proc: &ProcessHandle,
        source_id: u64,
        identity: &LootIdentity,
    ) -> Option<RawLootItem> {
        let world_x = proc
            .read::<f32>(identity.render + Offsets::RENDER_WORLD_POSITION)
            .ok()?;
        let world_y = proc
            .read::<f32>(identity.render + Offsets::RENDER_WORLD_POSITION + 4)
            .ok()?;
        Some(RawLootItem {
            source_id,
            name: identity.name.clone(),
            x: world_x / Offsets::WORLD_TO_GRID_RATIO,
            y: world_y / Offsets::WORLD_TO_GRID_RATIO,
            rarity: identity.rarity,
            identified: identity.identified,
        })
    }

    fn read_terrain(proc: &ProcessHandle, area: u64, generation: u64) -> Option<TerrainGrid> {
        let base = area.checked_add(Offsets::AREA_TERRAIN)?;
        let first = proc.read::<u64>(base + Offsets::TERRAIN_GRID_VECTOR).ok()?;
        let last = proc
            .read::<u64>(base + Offsets::TERRAIN_GRID_VECTOR + 8)
            .ok()?;
        let bytes_per_row = proc
            .read::<i32>(base + Offsets::TERRAIN_BYTES_PER_ROW)
            .ok()?;
        if first == 0 || last <= first || !(1..=65_536).contains(&bytes_per_row) {
            return None;
        }
        let total = usize::try_from(last - first).ok()?;
        if total == 0 || total > 64 * 1024 * 1024 || total % bytes_per_row as usize != 0 {
            return None;
        }
        let height = total / bytes_per_row as usize;
        let width = (bytes_per_row as usize).checked_mul(2)?;
        if height == 0 || height > 65_536 {
            return None;
        }
        let mut packed = vec![0u8; total];
        proc.read_bytes(first, &mut packed).ok()?;
        let mut cells = vec![0u8; width.checked_mul(height)?];
        for y in 0..height {
            for x in 0..width {
                let byte = packed[y * bytes_per_row as usize + x / 2];
                let nibble = if x % 2 == 0 { byte & 0x0f } else { byte >> 4 };
                cells[y * width + x] = u8::from(nibble != 0);
            }
        }
        TerrainGrid::new(area, generation, width, height, cells)
    }

    fn expedition_snapshot(
        &self,
        area: u64,
        enabled: bool,
        retry_interval: Duration,
    ) -> Vec<RawRuneStation> {
        let (snapshot, should_scan) =
            self.expedition_scan
                .lock()
                .prepare(enabled, area, retry_interval);
        if should_scan {
            let cache = Arc::clone(&self.expedition_scan);
            let pid = self.proc.pid;
            let spawn = std::thread::Builder::new()
                .name("expedition-memory-scan".to_string())
                .spawn(move || {
                    let result = ProcessHandle::open(pid)
                        .map(|process| Self::read_expedition(&process, area))
                        .unwrap_or_default();
                    let mut state = cache.lock();
                    if state.area == area {
                        state.result = result;
                        state.in_flight = false;
                        state.last_attempt = Some(Instant::now());
                    }
                });
            if let Err(error) = spawn {
                let mut state = self.expedition_scan.lock();
                if state.area == area {
                    state.in_flight = false;
                }
                warn!(%error, "Could not start Expedition memory scan worker");
            }
        }
        snapshot
    }

    fn read_expedition(proc: &ProcessHandle, area: u64) -> Vec<RawRuneStation> {
        let mut entities = Vec::new();
        for root_offset in [
            Offsets::AREA_AWAKE_ENTITIES,
            Offsets::AREA_SLEEPING_ENTITIES,
        ] {
            let head = proc.read::<u64>(area + root_offset).unwrap_or(0);
            let root = proc.read::<u64>(head.saturating_add(8)).unwrap_or(0);
            if root == 0 {
                continue;
            }
            let mut queue = vec![root];
            let mut seen = std::collections::HashSet::new();
            while let Some(node) = queue.pop() {
                if node == 0 || !seen.insert(node) || seen.len() > 20_000 {
                    continue;
                }
                if proc.read::<u8>(node + 0x19).unwrap_or(1) != 0 {
                    continue;
                }
                let left = proc.read::<u64>(node).unwrap_or(0);
                let right = proc.read::<u64>(node + 16).unwrap_or(0);
                queue.push(left);
                queue.push(right);
                let entity = proc.read::<u64>(node + 0x28).unwrap_or(0);
                if entity == 0 {
                    continue;
                }
                let details = proc
                    .read::<u64>(entity + Offsets::ENTITY_DETAILS)
                    .unwrap_or(0);
                let metadata = proc
                    .read_std_wstring(details + Offsets::DETAILS_METADATA)
                    .unwrap_or_default();
                if metadata.contains("Expedition2Encounter") {
                    entities.push((entity, metadata));
                }
            }
        }
        let mut result = Vec::new();
        for (entity, _) in entities {
            if let Some(station) = Self::read_rune_station(proc, entity) {
                result.push(station);
            }
        }
        result.sort_by_key(|s| s.address);
        result.dedup_by_key(|s| s.address);
        result
    }

    fn read_rune_station(proc: &ProcessHandle, entity: u64) -> Option<RawRuneStation> {
        let component = Self::resolve_component(proc, entity, "StateMachine")?;
        let start = proc
            .read::<u64>(component + Offsets::STATE_MACHINE_LISTENER)
            .ok()?;
        let end = proc
            .read::<u64>(component + Offsets::STATE_MACHINE_LISTENER + 8)
            .ok()?;
        let count = end.checked_sub(start)?.checked_div(8)?.min(256);
        let mut rune_sub = 0;
        for i in 0..count {
            let listener = proc.read::<u64>(start + i * 8).ok()?;
            let vtable = proc.read::<u64>(listener).ok()?;
            let candidate = vtable.checked_sub(Offsets::RUNE_LISTENER_SUB)?;
            if proc.read::<u64>(candidate + Offsets::RUNE_OWNER).ok()? == entity {
                rune_sub = candidate;
                break;
            }
        }
        if rune_sub == 0 {
            return None;
        }
        let slots = proc.read::<i32>(rune_sub + Offsets::RUNE_HOLE_COUNT).ok()?;
        if !(1..=16).contains(&slots) {
            return None;
        }
        let pos = proc
            .read::<i32>(rune_sub + Offsets::RUNE_ANCHOR_POS)
            .unwrap_or(-1);
        let anchor_ref = proc
            .read::<u64>(rune_sub + Offsets::RUNE_ANCHOR_REF)
            .unwrap_or(0);
        let (anchor_idx, anchor_name, unique) = if anchor_ref == 0 {
            (-1, "Unique / anchor-less".into(), true)
        } else {
            let holder = proc
                .read::<u64>(rune_sub + Offsets::RUNE_ANCHOR_HOLDER)
                .unwrap_or(0);
            let base = proc.read::<u64>(holder + 40).unwrap_or(0);
            let stride = Offsets::RUNE_STRIDE;
            let idx =
                if base != 0 && anchor_ref >= base && (anchor_ref - base).is_multiple_of(stride) {
                    ((anchor_ref - base) / stride) as i16
                } else {
                    -1
                };
            let name = usize::try_from(idx)
                .ok()
                .and_then(|index| RUNE_NAMES.get(index).copied())
                .unwrap_or("Unknown");
            (idx, name.to_string(), false)
        };
        Some(RawRuneStation {
            address: entity,
            slot_count: slots as u16,
            anchor_idx,
            anchor_position: pos as i16,
            anchor_name,
            unique,
        })
    }

    fn resolve_component(proc: &ProcessHandle, entity: u64, wanted: &str) -> Option<u64> {
        let details = proc.read::<u64>(entity + Offsets::ENTITY_DETAILS).ok()?;
        let lookup = proc
            .read::<u64>(details + Offsets::DETAILS_COMPONENT_LOOKUP)
            .ok()?;
        let components = proc
            .read::<u64>(entity + Offsets::ENTITY_COMPONENT_LIST)
            .ok()?;
        let components_end = proc
            .read::<u64>(entity + Offsets::ENTITY_COMPONENT_LIST + 8)
            .ok()?;
        let max = components_end
            .checked_sub(components)?
            .checked_div(8)?
            .min(512);
        let entries = proc.read::<u64>(lookup + Offsets::LOOKUP_ENTRIES).ok()?;
        let entries_end = proc
            .read::<u64>(lookup + Offsets::LOOKUP_ENTRIES + 8)
            .ok()?;
        let entry_count = entries_end
            .checked_sub(entries)?
            .checked_div(Offsets::LOOKUP_ENTRY_STRIDE)?
            .min(512);
        for i in 0..entry_count {
            let entry = entries + i * Offsets::LOOKUP_ENTRY_STRIDE;
            let index = proc.read::<i32>(entry + 8).ok()?;
            if index < 0 || index as u64 >= max {
                continue;
            }
            let addr = proc.read::<u64>(entry).ok()?;
            let name = proc.read_string(addr).ok()?;
            if name == wanted {
                return proc.read::<u64>(components + index as u64 * 8).ok();
            }
        }
        None
    }

    fn read_actor(&self, entity_ptr: u64, area: &str) -> Result<RawActor> {
        if self
            .proc
            .read::<u8>(entity_ptr + Offsets::ENTITY_VALID)
            .unwrap_or(0)
            == 0
        {
            anyhow::bail!("invalid entity");
        }
        let render = Self::resolve_component(&self.proc, entity_ptr, "Render")
            .ok_or_else(|| anyhow::anyhow!("Render component missing"))?;
        let player = Self::resolve_component(&self.proc, entity_ptr, "Player")
            .ok_or_else(|| anyhow::anyhow!("Player component missing"))?;
        let life = Self::resolve_component(&self.proc, entity_ptr, "Life");

        let world_x = self
            .proc
            .read::<f32>(render + Offsets::RENDER_WORLD_POSITION)?;
        let world_y = self
            .proc
            .read::<f32>(render + Offsets::RENDER_WORLD_POSITION + 4)?;
        let x = world_x / Offsets::WORLD_TO_GRID_RATIO;
        let y = world_y / Offsets::WORLD_TO_GRID_RATIO;
        if !x.is_finite() || !y.is_finite() {
            anyhow::bail!("non-finite actor position");
        }
        let hp = life
            .and_then(|component| self.read_vital_pct(component + Offsets::LIFE_HEALTH).ok())
            .unwrap_or(100);
        let mana = life
            .and_then(|component| self.read_vital_pct(component + Offsets::LIFE_MANA).ok())
            .unwrap_or(100);
        let name = self
            .proc
            .read_std_wstring(player + Offsets::PLAYER_NAME)
            .unwrap_or_default();

        Ok(RawActor {
            name,
            x,
            y,
            hp,
            mana,
            area: area.to_string(),
        })
    }

    fn read_vital_pct(&self, vital: u64) -> Result<u8> {
        let cur: i32 = self.proc.read(vital + Offsets::VITAL_CURRENT)?;
        let max: i32 = self.proc.read(vital + Offsets::VITAL_MAX)?;
        if max <= 0 {
            return Ok(100);
        }
        Ok(((cur as f32 / max as f32) * 100.0).clamp(0.0, 100.0) as u8)
    }

    fn read_area_name(&self, area: u64) -> Result<String> {
        let info: u64 = self.proc.read(area + Offsets::AREA_INFO_PTR)?;
        let name_ptr: u64 = self.proc.read(info + Offsets::AREA_INFO_NAME)?;
        self.proc.read_wstring(name_ptr)
    }

    fn read_entity_map(
        proc: &ProcessHandle,
        area: u64,
        map_offset: u64,
        max_nodes: usize,
    ) -> Vec<EntityRef> {
        let head = proc.read::<u64>(area + map_offset).unwrap_or(0);
        let declared_size = proc.read::<u64>(area + map_offset + 8).unwrap_or(0);
        let root = proc.read::<u64>(head.saturating_add(8)).unwrap_or(0);
        if head == 0 || root == 0 || declared_size == 0 {
            return Vec::new();
        }
        if declared_size > max_nodes as u64 {
            debug!(
                declared_size,
                max_nodes, "entity map is being read with a bounded node budget"
            );
        }
        let mut output = Vec::new();
        let mut stack = vec![root];
        let mut seen = std::collections::HashSet::new();
        while let Some(node) = stack.pop() {
            if node == 0 || node == head || !seen.insert(node) || seen.len() > max_nodes {
                continue;
            }
            let mut bytes = [0u8; 0x30];
            if proc.read_bytes(node, &mut bytes).is_err() || bytes[0x19] != 0 {
                continue;
            }
            stack.push(u64::from_le_bytes(bytes[0x00..0x08].try_into().unwrap()));
            stack.push(u64::from_le_bytes(bytes[0x10..0x18].try_into().unwrap()));
            let id = u32::from_le_bytes(bytes[0x20..0x24].try_into().unwrap());
            let entity = u64::from_le_bytes(bytes[0x28..0x30].try_into().unwrap());
            if id < 0x4000_0000 && entity != 0 {
                output.push(EntityRef {
                    id: id as u64,
                    address: entity,
                });
            }
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_expedition_never_schedules_a_memory_walk() {
        let mut state = ExpeditionScanState::default();
        let (snapshot, should_scan) = state.prepare(false, 0x1234, Duration::from_millis(100));
        assert!(snapshot.is_empty());
        assert!(!should_scan);
        assert!(!state.in_flight);
        assert_eq!(state.area, 0);
    }

    #[test]
    fn expedition_scan_is_single_flight_and_cached_after_success() {
        let mut state = ExpeditionScanState::default();
        let (_, first_scan) = state.prepare(true, 0x1234, Duration::from_secs(2));
        let (_, duplicate_scan) = state.prepare(true, 0x1234, Duration::from_secs(2));
        assert!(first_scan);
        assert!(!duplicate_scan);

        state.in_flight = false;
        state.result.push(RawRuneStation {
            address: 1,
            ..Default::default()
        });
        let (snapshot, cached_scan) = state.prepare(true, 0x1234, Duration::ZERO);
        assert_eq!(snapshot.len(), 1);
        assert!(!cached_scan);
    }

    #[test]
    fn expedition_area_change_invalidates_the_previous_cache() {
        let mut state = ExpeditionScanState {
            area: 0x1111,
            result: vec![RawRuneStation {
                address: 1,
                ..Default::default()
            }],
            last_attempt: Some(Instant::now()),
            in_flight: false,
        };
        let (snapshot, should_scan) = state.prepare(true, 0x2222, Duration::from_secs(2));
        assert!(snapshot.is_empty());
        assert!(should_scan);
        assert_eq!(state.area, 0x2222);
    }

    #[test]
    #[ignore = "requires a live PoE2 process loaded into an area"]
    fn live_reader_probe_reports_valid_player_and_terrain() {
        let reader = GameStateReader::attach().expect("live attach");
        let state = reader
            .try_read_state_with_interval(false, Duration::from_secs(1))
            .expect("live state");
        assert!(!state.local_player.name.is_empty());
        assert!(state.local_player.x.is_finite() && state.local_player.y.is_finite());
        let terrain = state.terrain.expect("terrain grid");
        assert!(terrain.width > 0 && terrain.height > 0);
        eprintln!(
            "build={} area={} player={} pos=({:.1},{:.1}) terrain={}x{} nearby={}",
            reader.build_key(),
            state.area_name,
            state.local_player.name,
            state.local_player.x,
            state.local_player.y,
            terrain.width,
            terrain.height,
            state.nearby.len()
        );
    }
}
