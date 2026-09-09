//! GUI releases have no stdout console. Keep a bounded, separate log per session.
use anyhow::{Context, Result};
use std::{
    fs::OpenOptions,
    io::{self, Write},
    sync::Mutex,
};

const SESSION_LIMIT: usize = 8 * 1024 * 1024;
const LIMIT_NOTICE: &[u8] = b"\nSession log limit reached; further messages omitted.\n";

struct SessionWriter<W> {
    output: W,
    remaining: usize,
    stopped: bool,
}

impl<W: Write> Write for SessionWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.stopped {
            return Ok(bytes.len());
        }
        if bytes.len() > self.remaining.saturating_sub(LIMIT_NOTICE.len()) {
            if self.remaining >= LIMIT_NOTICE.len() {
                self.output.write_all(LIMIT_NOTICE)?;
            }
            self.stopped = true;
        } else {
            self.output.write_all(bytes)?;
            // Logs are diagnostic evidence for hangs/crashes. Keep them
            // observable while the GUI process is still alive.
            self.output.flush()?;
            self.remaining -= bytes.len();
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.output.flush()
    }
}

pub fn init() -> Result<()> {
    let root = std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA is unavailable")?;
    let folder = std::path::PathBuf::from(root).join("POEVH").join("logs");
    std::fs::create_dir_all(&folder).context("Create log directory")?;
    let session = poe2_world::credentials::random_key()?;
    let log_path = folder.join(format!("session-{session}.log"));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&log_path)
        .context("Create session log")?;
    let writer = Mutex::new(SessionWriter {
        output: file,
        remaining: SESSION_LIMIT,
        stopped: false,
    });
    let filter = std::env::var("POEVH_LOG").unwrap_or_else(|_| {
        // Do not inherit a machine-wide RUST_LOG=warn: it previously removed
        // every happy-path record and left valid session files at zero bytes.
        "POEVH=info,poevh=info,poe2_bot=info,poe2_engine=info,poe2_input=info,poe2_memory=info,poe2_overlay=info,poe2_world=info".into()
    });
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(false)
        .with_writer(writer)
        .try_init()
        .map_err(|error| anyhow::anyhow!("Initialize file logging: {error}"))?;
    tracing::info!(
        path = %log_path.display(),
        "logging initialized; set POEVH_LOG=poe2_memory=debug,poe2_engine=debug,poe2_input=debug for per-scan trace"
    );
    Ok(())
}

pub fn show_error(message: &str) {
    #[cfg(windows)]
    unsafe {
        use windows::{
            core::{w, HSTRING},
            Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
        };
        let _ = MessageBoxW(
            None,
            &HSTRING::from(message),
            w!("POE2 MultiPilot"),
            MB_OK | MB_ICONERROR,
        );
    }
    #[cfg(not(windows))]
    eprintln!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn log_preserves_messages_and_flushes_without_a_console() {
        let mut writer = SessionWriter {
            output: Vec::new(),
            remaining: 1024,
            stopped: false,
        };
        writer.write_all(b"startup\n").unwrap();
        writer.write_all(b"ready\n").unwrap();
        writer.flush().unwrap();
        assert_eq!(writer.output, b"startup\nready\n");
    }
    #[test]
    fn session_log_is_bounded_and_announces_truncation_once() {
        let mut writer = SessionWriter {
            output: Vec::new(),
            remaining: 100,
            stopped: false,
        };
        writer.write_all(b"ready\n").unwrap();
        writer.write_all(&[b'x'; 200]).unwrap();
        writer.write_all(b"ignored").unwrap();
        assert!(writer.output.len() <= 100);
        assert_eq!(
            writer.output,
            [b"ready\n".as_slice(), LIMIT_NOTICE].concat()
        );
    }

    #[test]
    fn info_happy_path_is_written_by_the_real_tracing_subscriber() {
        let path = std::env::temp_dir().join(format!(
            "poevh-log-test-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .unwrap();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter("info")
            .with_ansi(false)
            .with_writer(Mutex::new(SessionWriter {
                output: file,
                remaining: 4096,
                stopped: false,
            }))
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(item_id = 42_u64, "loot.pickup confirmed");
        });
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("loot.pickup confirmed"));
        assert!(text.contains("item_id=42"));
        let _ = std::fs::remove_file(path);
    }
}
