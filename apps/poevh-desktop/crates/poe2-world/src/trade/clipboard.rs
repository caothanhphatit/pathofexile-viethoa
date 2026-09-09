//! Clipboard capture for Path of Exile 2 items.
//!
//! Directly accesses Windows Clipboard via native Win32 API without external dependencies.

use anyhow::{anyhow, Result};

#[cfg(windows)]
pub fn read_clipboard_text() -> Result<String> {
    use std::ffi::c_void;

    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(uFormat: u32) -> *mut c_void;
        fn GlobalLock(hMem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(hMem: *mut c_void) -> i32;
    }

    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err(anyhow!("Không thể mở Windows Clipboard."));
        }

        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return Err(anyhow!(
                "Bộ nhớ tạm (Clipboard) không chứa văn bản hoặc chưa copy item trong PoE2."
            ));
        }

        let ptr = GlobalLock(handle) as *mut u16;
        if ptr.is_null() {
            CloseClipboard();
            return Err(anyhow!("Không thể đọc vùng nhớ bộ nhớ tạm."));
        }

        let mut len = 0usize;
        const MAX_CLIPBOARD_CHARS: usize = 65_536;
        while len < MAX_CLIPBOARD_CHARS && *ptr.add(len) != 0 {
            len += 1;
        }
        if len == MAX_CLIPBOARD_CHARS {
            GlobalUnlock(handle);
            CloseClipboard();
            return Err(anyhow!("Clipboard item vượt giới hạn 64K ký tự."));
        }

        let slice = std::slice::from_raw_parts(ptr, len);
        let text = String::from_utf16_lossy(slice);

        GlobalUnlock(handle);
        CloseClipboard();

        Ok(text)
    }
}

#[cfg(windows)]
pub fn write_clipboard_text(text: &str) -> Result<()> {
    use std::ffi::c_void;

    extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
    }

    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;
    let mut encoded: Vec<u16> = text.encode_utf16().collect();
    encoded.push(0);

    unsafe {
        let mut opened = false;
        for _ in 0..8 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !opened {
            return Err(anyhow!("Windows Clipboard đang bị ứng dụng khác khóa"));
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err(anyhow!("Không thể làm trống Windows Clipboard"));
        }
        let bytes = encoded.len() * std::mem::size_of::<u16>();
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if memory.is_null() {
            CloseClipboard();
            return Err(anyhow!("Không cấp phát được bộ nhớ Clipboard"));
        }
        let destination = GlobalLock(memory) as *mut u16;
        if destination.is_null() {
            GlobalFree(memory);
            CloseClipboard();
            return Err(anyhow!("Không khóa được bộ nhớ Clipboard"));
        }
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), destination, encoded.len());
        GlobalUnlock(memory);
        if SetClipboardData(CF_UNICODETEXT, memory).is_null() {
            GlobalFree(memory);
            CloseClipboard();
            return Err(anyhow!("Không ghi được Windows Clipboard"));
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn read_clipboard_text() -> Result<String> {
    Err(anyhow!("Hệ điều hành không hỗ trợ Win32 Clipboard."))
}

#[cfg(not(windows))]
pub fn write_clipboard_text(_text: &str) -> Result<()> {
    Err(anyhow!("Hệ điều hành không hỗ trợ Win32 Clipboard."))
}
