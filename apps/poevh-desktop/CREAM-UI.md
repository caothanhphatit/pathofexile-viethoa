# Cream UI refresh — 2026-09-03

Visual-only refresh guided by frontend-design: warm paper surfaces, dark brown
text, olive controls, restrained terracotta warnings, local serif headings and
plain line icons. No downloaded fonts, image assets, gradients or emoji-heavy
navigation. Existing commands, IDs, profile/account storage and login logic remain.

- Shared theme tokens replace old dark colors in CSS, inline styles and live status rendering.
- Page headings and short descriptions across all 14 pages.
- Responsive instance forms; readable disabled/unbound status without fading entire cards.
- Keyboard-operable sidebar sections, active-page indication and visible focus rings.
- Accessible names on toggle controls; reduced-motion preference honored.
- Native window theme and initial WebView background changed to light/cream.
- GUI-only executable packaging is preserved; no startup terminal.

Validation uses the existing isolated mock server and headless browser, per
webapp-testing. Screenshots contain synthetic test data, not live game telemetry.

- 14 pages checked at 1440×1000, 1140×800 and 960×640; no horizontal overflow.
- Primary text/semantic colors meet 4.5:1 against the main and card surfaces.
  This is a palette test, not a claim of full accessibility conformance.
- Existing instance, credentials and calibration browser regressions passed.
- Workspace tests, formatting, strict Clippy and optimized release checks run.
- Source: `crates/poe2-overlay/src/dashboard.html` and `desktop_app.rs`.
- Tests: `review-tools/test_cream_theme.py`, `test_instances.py` and
  `check_gui_release.py`. Run them via `run_dashboard_review.py` / the PE checker.

Preview: `review-tools/cream-home-1140.png`.

## Deployment

- Deployed `D:\code\POE2-MultiPilot.exe`: 2,650,624 bytes.
- SHA-256: `196EDD039C56B0C3B4496A1691D616B4873F55F6EDE4125CE846D28E51A6D5C8`.
- Backup: `D:\code\POE2-MultiPilot.pre-cream-20260903.bak`.
- Backup SHA-256: `D18C246ADDB35466E555E3A50A719DB9876401C345301FBCD0D70A5D25D3E5BB`.
- 56 workspace tests passed. Strict Clippy and formatting passed.
- Built/deployed EXE hashes match; deployed GUI subsystem check passed.
- The app was not automatically launched; no live game/credential actions were run.
