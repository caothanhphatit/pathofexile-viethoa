# Phase 0 Design

## Architecture Decision

The extractor is a separate module in the same repository. It will share
repository tooling and PostgreSQL access, but it must not couple itself to the
current static pages, current POE2DB-derived crawlers, or frontend runtime.

## Control Plane

The `/ai` folder contains durable rules for agents and developers:

- JSON files for rules, configuration, review, architecture, patterns, and SOLID.
- Markdown phase docs for human-readable planning and verification.

## Key Constraints

- Keep raw game data before mapping.
- Keep patch versions append-only.
- Use PoB as upstream reference until Rust reaches parity.
- Keep local assets in ignored storage.
- Make every mapper independently testable.

## Non-goals

- No full extractor implementation in Phase 0.
- No modification of current app data sources in Phase 0.
- No DOCX artifact is required for these engineering docs.
