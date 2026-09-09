# Expedition Radar

POEVH now contains a dedicated Expedition Radar contract and overlay path.

## Behaviour

- Radar is disabled by default and enabled from the `Expedition Radar` tab.
- A read-only memory adapter publishes Rune Station snapshots keyed by an area
  session id.
- One always-on-top overlay is reused. It opens once when a new area contains
  Rune Stations; closing it dismisses that session. A new area resets dismissal
  and replaces the content instead of creating another window.
- Reward prices are requested in a background queue through the existing
  Trade2 client and cached for ten minutes. Until the first lookup completes,
  the combination remains visible as `Chưa có giá` when configured.

## Boundaries

The adapter never writes process memory, injects DLLs, or sends game input. AOB
and pointer-chain data are version-sensitive; an offset/schema gate must be
updated for future game builds before enabling a release build. The bundled
catalog is a safe fallback and is intentionally small until a separately
verified, versioned recipe data pack is supplied.

## API

- `GET /api/expedition/latest` returns the latest snapshot, dismissal state and
  any transient error.
- `POST /api/expedition/dismiss` dismisses the current session.
- `POST /api/command` with `command: update_expedition` persists the tab config.

## Reference behaviour

The combination filtering follows the public Expedition rule that the first
inscribed rune constrains the available recipe and that recipe size controls
the number of waves. The reference scanner was one-shot; POEVH adds bounded
polling, area-session reset and an overlay lifecycle around that decoder.
