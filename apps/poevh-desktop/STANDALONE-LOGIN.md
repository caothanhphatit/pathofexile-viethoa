# Standalone login — pixel implementation, 2026-09-03

Latest packaging update: [GUI-only release](GUI-RELEASE.md) removes the startup
console and records the current deployed hash. Login behavior below is unchanged;
the release hash at the bottom of this document refers to the earlier pixel build.

The OCR prototype has been replaced. The new implementation follows the **verified
mechanism family** in the original application: pixel/geometry recognition,
per-instance confirmed click points, and keyboard-layout-based input. It is not
a byte-for-byte port or proof of identical behavior. **Real-account login has not
been verified end-to-end.**

Original-analysis evidence: [Original-MultiPilot-Login-Findings.md](../Original-MultiPilot-Login-Findings.md).
The original also has clipboard/Ctrl+V and DPAPI paths. This implementation deliberately
keeps the existing Windows Credential Manager vault and uses its own keyboard-input
implementation instead of putting a password on the clipboard.

## Use

1. In **Quản lý instance**, select **Standalone**, set its trusted executable and
   save the profile. The previously observed executable on this machine is
   `D:\Grinding Gear Games\Path of Exile 2\PathOfExile.exe`.
2. Save the account in that instance's **Standalone · Tài khoản** section. Never
   send a password through chat. The account is saved to the current user's Windows vault.
3. Optional: **Hiệu chỉnh điểm login**. Load a PNG/JPEG of an empty login screen,
   cropped to the **game client area only**, without title bar, borders or desktop.
   Click the middle of Email, Password and Log In in order; numeric X/Y percentages
   are also available for keyboard access. Check the confirmation and save.
   The image is decoded locally in the browser and discarded on close; only three
   normalized points, capture dimensions and a version are sent/persisted.
   Clear calibration to return to automatic pixel detection.
4. For a running game, scan, choose its exact path/PID, bind it and choose
   **Đăng nhập PID đã gắn**. Otherwise choose **Mở & đăng nhập**. This launches
   one configured instance; it is not batch launch or a multi-instance-limit bypass.
5. Before confirming, leave the login form empty, dismiss overlays/modals/OTP
   dialogs, and turn Caps Lock off. Keep the game foreground and do not touch the
   mouse/keyboard during entry. Esc or **Dừng đăng nhập** requests cancellation.
6. Inspect the game yourself. A successful operation means **Log In was sent once**,
   not that authentication succeeded. Handle OTP/CAPTCHA/errors manually.
   Bot/KBM stay off and are not automatically resumed.

Delete saved credentials before changing the executable/platform, replacing the
account or removing the profile. Changing executable/platform also clears calibration.

## How it works

- **Capture:** GDI screen capture in physical client-area coordinates, bounded to
  800–7680 × 500–4320 pixels. The runtime analyzes the original pixels, not a
  resized screenshot. It rechecks window size/origin/focus after capture.
- **Recognition:** scan gold-colored horizontal bands, pair them into two aligned
  dark input fields, then locate a sufficiently large red button below. Missing
  or ambiguous layouts stop input. Candidate counts are bounded. No OCR package,
  game memory offsets or injected DLL is used.
- **Calibration:** schema version 1, finite normalized points, vertical order,
  dimension bounds and a 2% aspect-ratio tolerance. Saved points must lie inside
  controls recognized in the current capture. There is **no blind coordinate
  fallback**. Calibration is independent per instance and survives profile reload.
- **Input:** preflight both entire strings through the game thread's keyboard
  layout using VkKeyScanExW; reject unsupported characters before any typing.
  Click Email → Ctrl+A → mapped keys → recheck geometry → click Password →
  Ctrl+A → mapped keys → recheck geometry → click Log In once. Each mapped
  character is sent as a key/modifier down/up group, with a 40 ms pacing interval.
  No clipboard fallback or automatic retry is used.
- **Guards:** serialize login sessions, suspend bot/KBM, neutralize pads, exclude
  active input macros, reject changed PID/start-time/path, unexpected foreground,
  moved windows, covered click points, held modifiers or Esc. Check mouse movement
  and keyboard-layout changes during typing. Attempt key/button release after
  partial SendInput delivery.
- **API:** token/Host/Origin protection, 8 KiB body limit and no-store responses.
  `/api/login-calibration` requires explicit confirmation; saves reject an active
  login or instance operation. Password is never returned by `/api/state`.
- **Status:** `waiting_for_login_screen` → `submitted_unverified` or
  `needs_attention_no_retry`. Waiting is bounded to 60 seconds for a newly launched
  process/window and 45 seconds for form geometry. Only the preparation stage retries.

## Code map

- `crates/poe2-world/src/login_pixels.rs`: pure detector and geometry tests;
  optional resize helper is for fixture diagnostics, **not the runtime capture path**.
- `crates/poe2-world/src/login.rs`: capture, session/focus guards, keyboard preflight
  and single-submit flow.
- `crates/poe2-world/src/credentials.rs`: isolated, app-owned Windows vault targets.
- `crates/poe2-types/src/login.rs`: versioned calibration model and validation.
- `crates/poe2-engine/src/runtime.rs`: profile persistence and operation guards.
- `crates/poe2-overlay/src/server.rs`: protected endpoints.
- `crates/poe2-overlay/src/dashboard.html`: per-instance controls and calibration dialog.

Systematic-debugging guided the recognition/resizing investigation. Frontend-design
kept the new calibration controls consistent with the existing dashboard, including
labels, keyboard-editable points and visible statuses. Webapp-testing guided the
headless browser regressions using intercepted dummy requests.

## Evidence and limitations

- The provided original screenshot at **2713×1810** is recognized read-only:
  Email center `(1388.5, 1194)`, Password `(1388.5, 1291)`,
  Log In `(1398.5, 1528)`. These are diagnostic outputs, not runtime constants.
  The screenshot includes window/desktop chrome; do not use these coordinates as
  a client-area calibration.
- Resized variants at 1280 and 1600 pixels were recognized. A 1920-pixel downsample
  lost a thin border and was correctly rejected. This regression is why the runtime
  keeps physical-resolution pixels. Bilinear resampling is not a guarantee against
  aliasing at every scale.
- Geometry recognition does **not** read or verify email/password text, detect
  every in-game dialog, establish which edit field owns keyboard focus, or confirm
  server authentication. A same-game modal/race can still redirect input. This is
  a supervised experimental feature, not unattended account automation.
- The supplied screenshot is evidence for this layout only. HDR, capture restrictions,
  future skins/UI versions, unusual aspect ratios and overlays can fail recognition.
  Physical window/focus checks reduce risk but do not make SendInput atomic.
- Native login input, live capture recognition and successful authentication have
  not been tested end-to-end. Pure keyboard mapping tests do not prove that the
  game accepts the generated input. A real-account test must be user-driven.
- The calibration UI requires a user-supplied cropped image, rather than the original
  app's live calibration workflow. It uses stricter pixel validation instead of
  the original's confirmed-mark fallback. These are intentional differences.
- No character selection, automatic verification, login-error recovery, Steam/Epic
  login, trial/license changes, account-limit bypass or new sidecar use is included.
  No changes to graphics, memory-reader routing or follower-input routing are claimed.

## Credential security

Passwords are not intentionally written to profiles/backups, process arguments,
clipboard, responses or application logs. API state scrubs the opaque vault
reference. Delete/rollback operate only on exact app-owned random targets.
No real credentials were read by the assistant; tests use isolated dummy entries.

Windows credentials are scoped to the current Windows user, not protected against
all software running as that user. The browser, HTTP parser, game and OS necessarily
hold transient plaintext. Zeroizing owned Rust buffers cannot erase every copy made
by those components. Use a trusted machine/executable and keep port 8766 local.

Old binaries may discard newly added metadata when rewriting profiles. Before
rolling back, clear saved accounts or manage orphan app-owned vault entries manually
under `POE2MultiPilot/Standalone/v1/` in Windows Credential Manager.

## Reproduce

```powershell
$env:PATH = 'C:\msys64\mingw64\bin;' + $env:PATH
cargo fmt --all --check
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p poe2-world --example check_login_image -- <empty-login-screenshot.png>
& 'C:\Users\caoth\AppData\Local\Programs\Python\Python313\python.exe' review-tools/run_dashboard_review.py
cargo build --release
```

Tests use pure pixel buffers, temporary profiles, random dummy vault targets and
mock browser requests. They do not launch the installed game, load third-party DLLs
or submit a real account. The diagnostic prints geometry only, never recognized text.

## Release verification

- 54 Rust tests passed, 0 failed/ignored; all-targets workspace run.
- Strict Clippy (`-D warnings`) and `cargo fmt --all --check` passed.
- Headless browser regressions passed, including calibration image/point validation,
  explicit confirmation, save/clear, and existing credential/instance controls.
- Original-resolution screenshot diagnostic passed. No real login input was sent.
- Release built with the existing optimized profile and copied to
  `D:\code\POE2-MultiPilot.exe` (2,638,848 bytes).
- SHA-256: `0314A91C5FB300BCF604296717D496E1D5D4F711D36122457232273CC6F47936`.
  The deployed hash matches `target/release/poe2-bot.exe`.
- Previous OCR binary preserved at
  `D:\code\POE2-MultiPilot.pre-pixel-login-20260903.bak`, SHA-256
  `51AD25D06736BE21543E38444FC22C8E5DDFC399E9581D4304C641814BA4593A`.
- The new binary was not automatically launched. No user profile/credential
  changes were made while testing; only isolated test fixtures were mutated.
