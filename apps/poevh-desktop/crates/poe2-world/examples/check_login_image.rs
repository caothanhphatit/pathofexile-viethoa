//! Read-only fixture diagnostic. Never sends input or prints recognized account text.
#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use windows::{
        core::HSTRING,
        Graphics::Imaging::*,
        Storage::{FileAccessMode, StorageFile},
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("Expected a local screenshot path"))?;
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?.get()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let transform = BitmapTransform::new()?;
    let requested = std::env::args()
        .nth(2)
        .map(|v| v.parse::<u32>())
        .transpose()?
        .unwrap_or(7680);
    anyhow::ensure!(
        (800..=7680).contains(&requested),
        "Diagnostic width must be 800..7680"
    );
    let width = decoder.PixelWidth()?;
    let height = decoder.PixelHeight()?;
    anyhow::ensure!(
        width <= 7680 && height <= 4320,
        "Screenshot exceeds supported capture size"
    );
    transform.SetScaledWidth(width)?;
    transform.SetScaledHeight(height)?;
    let pixels = decoder
        .GetPixelDataTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Ignore,
            &transform,
            ExifOrientationMode::IgnoreExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )?
        .get()?
        .DetachPixelData()?;
    let (pixels, width, height, _) = poe2_world::login::resize_capture(
        &pixels,
        width as usize,
        height as usize,
        requested as usize,
    )?;
    let layout = poe2_world::login::detect_form(&pixels, width, height, None)?;
    println!("Pixel login geometry recognized ({width}x{height}): {layout:?}. Text/empty fields NOT verified. Read-only; no input sent.");
    Ok(())
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Windows image decoder required");
}
