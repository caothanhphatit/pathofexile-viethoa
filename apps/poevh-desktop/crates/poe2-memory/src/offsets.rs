//! POE2 memory offsets — derived from community research and pattern scanning.
//!
//! These are READ-ONLY offsets pointing to game state fields.
//! All values are offsets from the module base or from object pointers.
//!
//! References:
//!   - ExileApi / PoE2 community offset tables (public)
//!   - Pattern: signature scanning on game binary

/// Offsets for POE2 (version-independent via pattern scan where possible).
pub struct Offsets;

impl Offsets {
    // ── Static pointer chain from module base ─────────────────────────────
    // GameStateController → InGameState → InGameData → LocalPlayer

    /// Offset from module base to the GameStateController pointer.
    pub const GAME_STATE_CTRL_PTR: u64 = 0x02C17698;

    pub const GAME_STATE_CURRENT_VECTOR: u64 = 0x08;
    pub const GAME_STATE_STATES: u64 = 0x48;
    pub const GAME_STATE_SLOT_STRIDE: u64 = 0x10;
    pub const GAME_STATE_SLOT_COUNT: usize = 12;
    pub const INGAME_AREA_INSTANCE: u64 = 0x2A0;
    pub const LOCAL_PLAYER_OFFSET: u64 = 0x05D0;

    // ── Entity component offsets ──────────────────────────────────────────
    // Each entity has a component lookup table; we read specific components.

    pub const ENTITY_DETAILS: u64 = 0x08;
    pub const ENTITY_COMPONENT_LIST: u64 = 0x10;
    pub const ENTITY_ID: u64 = 0x88;
    pub const ENTITY_VALID: u64 = 0x8C;
    pub const DETAILS_METADATA: u64 = 0x08;
    pub const DETAILS_COMPONENT_LOOKUP: u64 = 0x28;
    pub const LOOKUP_ENTRIES: u64 = 0x28;
    pub const LOOKUP_ENTRY_STRIDE: u64 = 0x10;
    pub const RENDER_WORLD_POSITION: u64 = 0x138;
    pub const LIFE_HEALTH: u64 = 0x1B0;
    pub const LIFE_MANA: u64 = 0x208;
    pub const VITAL_MAX: u64 = 0x2C;
    pub const VITAL_CURRENT: u64 = 0x30;
    pub const PLAYER_NAME: u64 = 0x1B0;
    // Dropped-item components (validated against the current PoE2 entity
    // layout; the container is Metadata/.../WorldItem).
    pub const WORLD_ITEM_COMPONENT_ITEM_ENTITY: u64 = 0x28;
    pub const BASE_COMPONENT_NAME_ROW: u64 = 0x10;
    pub const BASE_ROW_DISPLAY_NAME: u64 = 0x30;
    pub const MODS_COMPONENT_IDENTIFIED: u64 = 0x90;
    pub const MODS_COMPONENT_RARITY: u64 = 0x94;
    pub const WORLD_TO_GRID_RATIO: f32 = 250.0 / 23.0;

    // ── World area ───────────────────────────────────────────────────────
    pub const AREA_INFO_PTR: u64 = 0x098;
    pub const AREA_INFO_NAME: u64 = 0x08;

    // Expedition / Rune Station structure (read-only, schema-gated).
    pub const AREA_AWAKE_ENTITIES: u64 = 0x06F0;
    pub const AREA_SLEEPING_ENTITIES: u64 = 0x0700;
    pub const AREA_LEVEL: u64 = 0x00BC;
    pub const AREA_HASH: u64 = 0x0114;
    pub const AREA_TERRAIN: u64 = 0x08D0;
    pub const TERRAIN_GRID_VECTOR: u64 = 0x00D0;
    pub const TERRAIN_BYTES_PER_ROW: u64 = 0x0130;
    pub const STATE_MACHINE_LISTENER: u64 = 0x20;
    pub const RUNE_OWNER: u64 = 0x10;
    pub const RUNE_ANCHOR_REF: u64 = 0x28;
    pub const RUNE_ANCHOR_HOLDER: u64 = 0x30;
    pub const RUNE_HOLE_COUNT: u64 = 0x38;
    pub const RUNE_ANCHOR_POS: u64 = 0x3C;
    pub const RUNE_LISTENER_SUB: u64 = 0xA0;
    pub const RUNE_STRIDE: u64 = 0x68;
    pub const RUNE_COUNT: i32 = 34;

    // ── Map / minimap scale (for converting world→screen coords) ─────────
    pub const MINIMAP_PTR: u64 = 0x00C8;
    pub const MINIMAP_SCALE: u64 = 0x0054; // f32
    pub const MINIMAP_SHIFT_X: u64 = 0x0058; // f32
    pub const MINIMAP_SHIFT_Y: u64 = 0x005C; // f32
}
