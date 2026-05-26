# Phase 2 Process

## Purpose

Phase 2 moves high-volume extraction from PoB Lua toward Rust-native parsing
while preserving PoB parity.

## Process

1. Convert PoB `spec.lua` into a Rust-readable spec format.
2. Implement Rust DAT64 parsing behind the same extractor source contract.
3. Start with lower-risk tables such as base items and item classes.
4. Run golden diff against PoB output for each ported table/exporter.
5. Enable Rust-native source per domain only after parity passes.
6. Keep PoB adapter available as fallback and oracle.

## Port Order

1. DAT64 primitive reader and spec loader.
2. Base item and item class tables.
3. Currency and waystone tables.
4. Skill gem and granted effect tables.
5. Mods, stats, and stat descriptions.
6. Passive tree and assets.
