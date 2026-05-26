# Phase 2 Design

## Rust Native Extractor

Rust implements an `ExtractorSource` equivalent to the PoB-backed source. The
caller can choose PoB-backed, Rust-native, or fixture source without changing
import or mapper code.

## Spec Conversion

PoB `spec.lua` remains the starting schema authority. A converter produces a
versioned JSON spec consumed by Rust. Spec hashes are stored with extract
versions to make schema drift visible.

## Parity Strategy

Every Rust-native mapper starts disabled. It becomes primary only after golden
diffs match PoB output for the same patch and fixture.

## Fallback Strategy

If a Rust-native table parser fails after a game update, the extractor can fall
back to PoB-backed extraction while preserving raw snapshot and failure metadata.
