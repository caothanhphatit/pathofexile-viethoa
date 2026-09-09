//! Windows process handle + ReadProcessMemory wrapper.

use anyhow::{bail, Result};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        Diagnostics::ToolHelp::{
            Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        },
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Module32FirstW, MODULEENTRY32W, TH32CS_SNAPMODULE,
                TH32CS_SNAPMODULE32,
            },
        },
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    },
};

/// Safe wrapper around a Windows process handle opened for read-only VM access.
pub struct ProcessHandle {
    pub handle: HANDLE,
    pub pid: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct ModuleScanInfo {
    pub base: u64,
    pub text_base: u64,
    pub text_size: usize,
    pub timestamp: u32,
    pub image_size: u32,
}

// SAFETY: HANDLE is an opaque pointer used only for ReadProcessMemory (read-only).
// We never share the handle across threads simultaneously; the Mutex in
// MemoryWorldAdapter ensures exclusive access.
unsafe impl Send for ProcessHandle {}
unsafe impl Sync for ProcessHandle {}

impl ProcessHandle {
    /// Open POE2 process by name ("PathOfExile.exe" or "PathOfExile_x64.exe").
    pub fn open_poe2() -> Result<Self> {
        let pid = find_process_by_name("PathOfExile")?;
        Self::open(pid)
    }

    pub fn open(pid: u32) -> Result<Self> {
        let handle =
            unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid)? };
        Ok(Self { handle, pid })
    }

    /// Read `count` bytes from `addr` into `buf`.
    pub fn read_bytes(&self, addr: u64, buf: &mut [u8]) -> Result<()> {
        let mut read = 0usize;
        unsafe {
            ReadProcessMemory(
                self.handle,
                addr as *const _,
                buf.as_mut_ptr() as *mut _,
                buf.len(),
                Some(&mut read),
            )?;
        }
        if read != buf.len() {
            bail!("short read: expected {} got {}", buf.len(), read);
        }
        Ok(())
    }

    /// Read a value of type T (POD types only).
    pub fn read<T: Copy + Default>(&self, addr: u64) -> Result<T> {
        let mut val = T::default();
        let buf = unsafe {
            std::slice::from_raw_parts_mut(&mut val as *mut T as *mut u8, std::mem::size_of::<T>())
        };
        self.read_bytes(addr, buf)?;
        Ok(val)
    }

    /// Read a UTF-16 string from memory (null-terminated, max 128 chars).
    pub fn read_wstring(&self, addr: u64) -> Result<String> {
        let mut buf = [0u16; 128];
        let raw =
            unsafe { std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut u8, buf.len() * 2) };
        self.read_bytes(addr, raw)?;
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Ok(String::from_utf16_lossy(&buf[..end]))
    }

    /// Read MSVC std::wstring (small-string optimization, bounded).
    pub fn read_std_wstring(&self, addr: u64) -> Result<String> {
        let len = self.read::<u64>(addr + 0x10)? as usize;
        if len > 4096 {
            bail!("std::wstring length out of bounds: {len}");
        }
        let data = if len < 8 {
            addr
        } else {
            self.read::<u64>(addr)?
        };
        if data == 0 {
            bail!("std::wstring data is null");
        }
        let mut buf = vec![0u16; len];
        let raw = unsafe {
            std::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<u8>(), len.saturating_mul(2))
        };
        self.read_bytes(data, raw)?;
        Ok(String::from_utf16_lossy(&buf))
    }

    /// Read a UTF-8 string (max 64 bytes).
    pub fn read_string(&self, addr: u64) -> Result<String> {
        let mut buf = [0u8; 64];
        self.read_bytes(addr, &mut buf)?;
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        Ok(String::from_utf8_lossy(&buf[..end]).to_string())
    }

    /// Resolve a multi-level pointer chain.
    pub fn deref_chain(&self, base: u64, offsets: &[u64]) -> Result<u64> {
        let mut addr = base;
        for (i, &off) in offsets.iter().enumerate() {
            addr = self.read::<u64>(addr)?;
            if addr == 0 {
                bail!("null pointer at chain step {i}");
            }
            addr += off;
        }
        Ok(addr)
    }

    /// Find the base address of the main module (PathOfExile*.exe).
    pub fn module_base(&self) -> Result<u64> {
        let snap =
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, self.pid)? };
        let mut me = MODULEENTRY32W {
            dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe {
            Module32FirstW(snap, &mut me)?;
        }
        let base = me.modBaseAddr as u64;
        unsafe { CloseHandle(snap).ok() };
        Ok(base)
    }

    /// Read the loaded PE headers and return the exact executable `.text`
    /// section plus a stable build key. This avoids probing an arbitrary 64 MB
    /// range and lets the signature cache be invalidated on game updates.
    pub fn module_scan_info(&self) -> Result<ModuleScanInfo> {
        let base = self.module_base()?;
        let e_lfanew = self.read::<u32>(base + 0x3c)? as u64;
        if e_lfanew > 0x10_0000 {
            bail!("invalid PE header offset");
        }
        let nt = base + e_lfanew;
        if self.read::<u32>(nt)? != 0x0000_4550 {
            bail!("invalid PE signature");
        }
        let section_count = self.read::<u16>(nt + 6)? as usize;
        if section_count == 0 || section_count > 96 {
            bail!("invalid PE section count");
        }
        let timestamp = self.read::<u32>(nt + 8)?;
        let optional_size = self.read::<u16>(nt + 20)? as u64;
        let optional = nt + 24;
        let magic = self.read::<u16>(optional)?;
        if magic != 0x10b && magic != 0x20b {
            bail!("unsupported PE optional header");
        }
        let image_size = self.read::<u32>(optional + 56)?;
        let sections = optional + optional_size;
        for index in 0..section_count {
            let section = sections + index as u64 * 40;
            let name = self.read::<[u8; 8]>(section)?;
            let end = name
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(name.len());
            if &name[..end] != b".text" {
                continue;
            }
            let virtual_size = self.read::<u32>(section + 8)?;
            let virtual_address = self.read::<u32>(section + 12)?;
            let raw_size = self.read::<u32>(section + 16)?;
            let text_size = virtual_size.max(raw_size) as usize;
            if text_size == 0
                || virtual_address >= image_size
                || virtual_address.saturating_add(text_size as u32) > image_size
            {
                bail!("invalid PE .text bounds");
            }
            return Ok(ModuleScanInfo {
                base,
                text_base: base + virtual_address as u64,
                text_size,
                timestamp,
                image_size,
            });
        }
        bail!("PE .text section not found")
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle).ok() };
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn find_process_by_name(name: &str) -> Result<u32> {
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? };
    let mut pe = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let name_lower = name.to_lowercase();
    let mut found = None;
    unsafe {
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                let proc_name = String::from_utf16_lossy(&pe.szExeFile);
                let proc_name = proc_name.trim_end_matches('\0').to_lowercase();
                if proc_name.contains(&name_lower) {
                    found = Some(pe.th32ProcessID);
                    break;
                }
                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        CloseHandle(snap).ok();
    }
    found.ok_or_else(|| anyhow::anyhow!("process '{}' not found", name))
}
