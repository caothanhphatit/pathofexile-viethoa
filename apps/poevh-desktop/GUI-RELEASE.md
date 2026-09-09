# GUI-only release — 2026-09-03

Subsequent visual update: [Cream UI](CREAM-UI.md) records the latest deployed EXE.
The GUI-only behavior and file logging described here remain in effect.

The Windows release now uses `windows_subsystem = "windows"`. The previous
executable had PE subsystem 3 (console); the new executable has subsystem 2 (GUI).
This removes the startup console, without hiding or terminating unrelated terminals.
Debug builds retain the console subsystem. Administrator/UAC requirements are unchanged.

Logs now go to `%LOCALAPPDATA%\POE2MultiPilot\logs\session-<random-id>.log`.
Each launch creates a new file without overwriting earlier logs. ANSI colors are
disabled. Each session log is capped at 8 MiB, with a truncation notice when full.
Old session files are not automatically deleted; total directory size can grow
across sessions. No credentials or API payload logging was added.
Startup errors are shown in a Windows message box; normal startup shows the app.

Verification followed systematic-debugging: reproduce the console header failure,
apply the GUI attribute, then rerun the same read-only PE check on the built and
deployed executables. The app was not launched by the assistant during this fix.

- 56 workspace tests passed, including two logging regressions.
- Strict Clippy and formatting checks passed.
- `review-tools/check_gui_release.py` passes on the deployed binary.
- Deployed: `D:\code\POE2-MultiPilot.exe`, 2,642,432 bytes.
- SHA-256: `D18C246ADDB35466E555E3A50A719DB9876401C345301FBCD0D70A5D25D3E5BB`.
- Backup: `D:\code\POE2-MultiPilot.pre-gui-20260903.bak`.
- Backup SHA-256: `0314A91C5FB300BCF604296717D496E1D5D4F711D36122457232273CC6F47936`.

The deployed file matches `target/release/poe2-bot.exe`. Existing game processes,
account profiles and credentials were not changed.
