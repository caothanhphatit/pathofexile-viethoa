//! Pure instance registry, separate from process discovery and profile persistence.
use poe2_types::*;
use std::{collections::HashMap, time::Instant};

fn normalize_path_str(p: &str) -> String {
    p.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_string()
}

fn executable_matches(configured: &str, actual: &str) -> bool {
    let configured = configured.trim();
    if configured.is_empty() {
        return true;
    }
    let configured_norm = normalize_path_str(configured);
    let actual_norm = normalize_path_str(actual);

    let configured_path = std::path::Path::new(&configured_norm);
    let actual_path = std::path::Path::new(&actual_norm);

    // Profiles created by older builds sometimes stored the game directory
    // (without an .exe) instead of the executable itself. Treat that form as
    // a directory even when the path is temporarily unavailable on disk.
    if configured_path.is_dir() || configured_path.extension().is_none() {
        return actual_path
            .parent()
            .map(|parent| {
                normalize_path_str(&parent.to_string_lossy()).eq_ignore_ascii_case(&configured_norm)
            })
            .unwrap_or(false);
    }
    configured_norm.eq_ignore_ascii_case(&actual_norm)
}

#[derive(Default)]
pub struct InstanceRegistry {
    pub processes: Vec<GameProcess>,
    pub scan_error: Option<String>,
    bindings: HashMap<u32, ProcessIdentity>,
    samples: HashMap<ProcessIdentity, (Instant, u64)>,
    missing_counts: HashMap<ProcessIdentity, u32>,
}

impl InstanceRegistry {
    pub fn update(&mut self, result: Result<Vec<GameProcess>, String>, now: Instant) {
        let mut processes = match result {
            Ok(p) => {
                self.scan_error = None;
                p
            }
            Err(e) => {
                self.scan_error = Some(e);
                // Maintain last-known-good inventory on transient scan error;
                // do not wipe processes or bindings.
                return;
            }
        };

        // Track missing counts for processes in previous inventory
        for prev in &self.processes {
            let pid_reused = processes.iter().any(|p| {
                p.identity.pid == prev.identity.pid
                    && p.identity.started_at != prev.identity.started_at
            });
            if pid_reused {
                // PID was reused by OS: old process is definitively gone immediately
                self.missing_counts.insert(prev.identity.clone(), 3);
            } else if !processes.iter().any(|p| p.identity == prev.identity) {
                *self
                    .missing_counts
                    .entry(prev.identity.clone())
                    .or_insert(0) += 1;
            } else {
                self.missing_counts.remove(&prev.identity);
            }
        }

        // Retain processes that missed fewer than 3 consecutive scans
        for prev in &self.processes {
            if let Some(&misses) = self.missing_counts.get(&prev.identity) {
                if misses < 3 && !processes.iter().any(|p| p.identity == prev.identity) {
                    processes.push(prev.clone());
                }
            }
        }
        self.missing_counts.retain(|_, misses| *misses < 3);

        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f64;
        let mut samples = HashMap::new();
        for process in &mut processes {
            if let Some((time, ticks)) = self.samples.get(&process.identity) {
                let elapsed = now.saturating_duration_since(*time).as_secs_f64();
                if elapsed > 0.0 && process.cpu_ticks >= *ticks {
                    process.cpu_percent = Some(
                        ((process.cpu_ticks - ticks) as f64 / 10_000_000.0 / elapsed / cores
                            * 100.0)
                            .clamp(0.0, 100.0) as f32,
                    );
                }
            }
            samples.insert(process.identity.clone(), (now, process.cpu_ticks));
        }
        // Keep assignment deterministic even when an OS/API provider returns
        // processes in arbitrary order: oldest game process is slot 1.
        processes.sort_by_key(|process| {
            u64::from_str_radix(&process.identity.started_at, 16).unwrap_or(u64::MAX)
        });
        self.samples = samples;
        self.processes = processes;
    }

    pub fn bind(
        &mut self,
        config: &MultiClientConfig,
        id: u32,
        identity: ProcessIdentity,
    ) -> Result<(), InstanceUpdateError> {
        use InstanceUpdateError::{Conflict, NotFound};
        let profile = config.clients.iter().find(|c| c.id == id).ok_or(NotFound)?;
        if !profile.enabled {
            return Err(Conflict("Enable the profile before binding"));
        }
        let process = self
            .processes
            .iter()
            .find(|p| p.identity == identity)
            .ok_or(Conflict("Process is stale or unavailable; scan again"))?;
        if profile.flavor != ClientFlavor::Unknown && profile.flavor != process.flavor {
            return Err(Conflict("Process platform does not match the profile"));
        }
        if !executable_matches(&profile.exe_path, &identity.exe_path) {
            return Err(Conflict(
                "Process executable does not match the profile path",
            ));
        }
        if self
            .bindings
            .iter()
            .any(|(other_id, other)| *other_id != id && other.pid == identity.pid)
        {
            return Err(Conflict(
                "This PID is already assigned to another instance; unbind it first",
            ));
        }
        self.bindings.insert(id, identity);
        Ok(())
    }

    pub fn auto_bind_unbound(&mut self, config: &MultiClientConfig) {
        if self.scan_error.is_some() {
            return;
        }

        // Drop identities that are no longer present before assigning new
        // processes.  This keeps a closed slot from blocking the first free
        // slot after a restart.
        self.bindings.retain(|_, bound| {
            self.processes
                .iter()
                .any(|process| process.identity == *bound)
        });

        // Profiles are an ordered UI contract: the earliest enabled profile
        // owns the earliest discovered game process.  Never fall back to a
        // process already owned by another profile, otherwise a path/flavor
        // mismatch can make a new game jump to slot 3 (and move bindings).
        // For each enabled client profile:
        let mut profiles: Vec<_> = config.clients.iter().filter(|p| p.enabled).collect();
        profiles.sort_by_key(|profile| profile.id);
        for profile in profiles {
            // Check if current binding is still alive
            let is_alive = self
                .bindings
                .get(&profile.id)
                .map(|identity| self.processes.iter().any(|p| p.identity == *identity))
                .unwrap_or(false);

            if is_alive {
                continue;
            }

            // Find an available discovered process that isn't bound to any active profile
            let matches_profile = |p: &&GameProcess| {
                if profile.flavor != ClientFlavor::Unknown && profile.flavor != p.flavor {
                    return false;
                }
                if !executable_matches(&profile.exe_path, &p.identity.exe_path) {
                    return false;
                }
                true
            };
            let candidate = self.processes.iter().find(|p| {
                let already_bound = self.bindings.iter().any(|(other_id, bound)| {
                    *other_id != profile.id && bound.pid == p.identity.pid
                });
                if already_bound {
                    return false;
                }
                matches_profile(p)
            });

            if let Some(cand) = candidate {
                // Repair a slot gap: if an earlier client is unbound while a
                // later slot owns the only matching process, move that
                // process to the earlier slot so numbering follows launch
                // order.
                self.bindings
                    .retain(|_, bound| bound.pid != cand.identity.pid);
                self.bindings.insert(profile.id, cand.identity.clone());
            }
        }
    }

    pub fn unbind(&mut self, id: u32) {
        self.bindings.remove(&id);
    }
    pub fn binding(&self, id: u32) -> Option<&ProcessIdentity> {
        self.bindings.get(&id)
    }
    /// Every identity currently bound to a profile, in no particular order.
    pub fn bound_identities(&self) -> Vec<ProcessIdentity> {
        self.bindings.values().cloned().collect()
    }

    pub fn statuses(&self, config: &MultiClientConfig) -> Vec<InstanceStatus> {
        config
            .clients
            .iter()
            .map(|profile| {
                let binding = self.bindings.get(&profile.id).cloned();
                let process = binding
                    .as_ref()
                    .and_then(|id| self.processes.iter().find(|p| p.identity == *id))
                    .cloned();
                let status = if !profile.enabled {
                    "disabled"
                } else if binding.is_none() {
                    "unbound"
                } else if process.is_none() {
                    if self.scan_error.is_some() {
                        "scan_unavailable"
                    } else {
                        "exited_or_unavailable"
                    }
                } else {
                    "bound"
                };
                InstanceStatus {
                    instance_id: profile.id,
                    account_profile_id: Some(profile.id),
                    is_main: profile.id == config.main_instance_id,
                    black_screen: profile.black_screen,
                    bg_fps: profile.bg_fps,
                    automation_enabled: true,
                    status: status.into(),
                    binding,
                    process,
                }
            })
            .collect()
    }
}
