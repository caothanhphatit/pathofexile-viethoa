//! Independent pixel/geometry implementation; no OCR, account text or game offsets.
use anyhow::{ensure, Result};
use poe2_types::LoginCalibration;

pub type PixelCapture = (zeroize::Zeroizing<Vec<u8>>, usize, usize, f32);

/// Optional fixture diagnostic only. Runtime analyzes original physical pixels:
/// even bilinear shrinking can erase one-pixel borders at particular scales.
pub fn resize_capture(
    source: &[u8],
    width: usize,
    height: usize,
    max_width: usize,
) -> Result<PixelCapture> {
    ensure!(
        (800..=7680).contains(&width)
            && (500..=4320).contains(&height)
            && (800..=7680).contains(&max_width),
        "Unsupported source dimensions"
    );
    ensure!(
        source.len() == width * height * 4,
        "Invalid source BGRA buffer"
    );
    let target_width = width.min(max_width);
    let scale = width as f32 / target_width as f32;
    let target_height = (height as f32 / scale).floor() as usize;
    if width == target_width {
        return Ok((zeroize::Zeroizing::new(source.to_vec()), width, height, 1.));
    }
    let mut output = zeroize::Zeroizing::new(vec![0; target_width * target_height * 4]);
    for y in 0..target_height {
        let sy = ((y as f32 + 0.5) * height as f32 / target_height as f32 - 0.5).max(0.);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(height - 1);
        let fy = sy - y0 as f32;
        for x in 0..target_width {
            let sx = ((x as f32 + 0.5) * scale - 0.5).max(0.);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(width - 1);
            let fx = sx - x0 as f32;
            for channel in 0..3 {
                let get = |xx, yy| source[(yy * width + xx) * 4 + channel] as f32;
                let top = get(x0, y0) * (1. - fx) + get(x1, y0) * fx;
                let bottom = get(x0, y1) * (1. - fx) + get(x1, y1) * fx;
                output[(y * target_width + x) * 4 + channel] =
                    (top * (1. - fy) + bottom * fy).round() as u8;
            }
            output[(y * target_width + x) * 4 + 3] = 255;
        }
    }
    Ok((output, target_width, target_height, scale))
}

#[derive(Clone, Debug, PartialEq)]
pub struct LoginLayout {
    pub email: (f32, f32),
    pub password: (f32, f32),
    pub submit: (f32, f32),
}

impl LoginLayout {
    pub fn close_to(&self, other: &Self, tolerance: f32) -> bool {
        [
            (self.email, other.email),
            (self.password, other.password),
            (self.submit, other.submit),
        ]
        .iter()
        .all(|(a, b)| (a.0 - b.0).abs() <= tolerance && (a.1 - b.1).abs() <= tolerance)
    }
}

#[derive(Clone, Copy, Debug)]
struct Region {
    left: usize,
    right: usize,
    top: usize,
    bottom: usize,
}
impl Region {
    fn center(self) -> (f32, f32) {
        (
            (self.left + self.right) as f32 / 2.,
            (self.top + self.bottom) as f32 / 2.,
        )
    }
    fn contains(self, p: (f32, f32)) -> bool {
        p.0 > self.left as f32 + 4.
            && p.0 < self.right as f32 - 4.
            && p.1 > self.top as f32 + 3.
            && p.1 < self.bottom as f32 - 3.
    }
}

fn gold(p: &[u8]) -> bool {
    let (b, g, r) = (p[0] as u32, p[1] as u32, p[2] as u32);
    r >= 55 && g >= 40 && r >= g && g * 4 > b * 5 && r * 10 < g * 19
}
fn red(p: &[u8]) -> bool {
    let (b, g, r) = (p[0] as u32, p[1] as u32, p[2] as u32);
    r > 55 && r * 10 > g * 18 && r * 2 > b * 3
}

fn dark_interior(pixels: &[u8], width: usize, field: Region) -> bool {
    let mut dark = 0;
    let mut samples = 0;
    for y in (field.top + 4..field.bottom.saturating_sub(3)).step_by(3) {
        for x in (field.left + 8..field.right.saturating_sub(7)).step_by(3) {
            let p = &pixels[(y * width + x) * 4..][..3];
            samples += 1;
            if p.iter().all(|c| *c < 100) {
                dark += 1;
            }
        }
    }
    samples > 0 && dark * 4 >= samples * 3
}

fn rows(
    pixels: &[u8],
    width: usize,
    roi: Region,
    minimum: usize,
    predicate: fn(&[u8]) -> bool,
) -> Vec<Region> {
    let mut groups: Vec<Region> = Vec::new();
    for y in roi.top..roi.bottom {
        let mut left = roi.right;
        let mut right = 0;
        let mut count = 0;
        for x in roi.left..roi.right {
            if predicate(&pixels[(y * width + x) * 4..][..4]) {
                left = left.min(x);
                right = x;
                count += 1;
            }
        }
        if count < minimum || count * 2 < right.saturating_sub(left) {
            continue;
        }
        if let Some(last) = groups.last_mut().filter(|r| y <= r.bottom + 3) {
            last.bottom = y;
            last.left = last.left.min(left);
            last.right = last.right.max(right);
        } else {
            groups.push(Region {
                left,
                right,
                top: y,
                bottom: y,
            });
        }
    }
    groups
}

/// Requires two aligned gold-bordered fields AND a red button below them.
/// Calibration only selects points INSIDE a freshly validated form; never a blind fallback.
/// This recognizes geometry, not empty text, focus ownership or every possible modal.
pub fn detect_form(
    pixels: &[u8],
    width: usize,
    height: usize,
    calibration: Option<&LoginCalibration>,
) -> Result<LoginLayout> {
    ensure!(
        (800..=7680).contains(&width) && (500..=4320).contains(&height),
        "Unsupported capture size"
    );
    ensure!(pixels.len() == width * height * 4, "Invalid BGRA capture");
    if let Some(c) = calibration {
        ensure!(
            c.fits(width as u32, height as u32),
            "Calibration aspect/version changed; recalibrate or clear it"
        );
    }
    let bands = rows(
        pixels,
        width,
        Region {
            left: width / 4,
            right: width * 3 / 4,
            top: height / 2,
            bottom: height * 95 / 100,
        },
        width * 15 / 100,
        gold,
    );
    ensure!(
        bands.len() <= 24,
        "Too many border candidates; inspect the screen manually"
    );
    let mut fields = Vec::new();
    for (i, top) in bands.iter().enumerate() {
        for bottom in &bands[i + 1..] {
            let h = bottom.bottom - top.top;
            if (height * 2 / 100..=height * 6 / 100).contains(&h)
                && top.left.abs_diff(bottom.left) < width / 80
                && top.right.abs_diff(bottom.right) < width / 80
                && top.right - top.left < width * 4 / 10
            {
                fields.push(Region {
                    left: top.left.max(bottom.left),
                    right: top.right.min(bottom.right),
                    top: top.top,
                    bottom: bottom.bottom,
                });
            }
        }
    }
    ensure!(
        fields.len() <= 16,
        "Too many field candidates; inspect the screen manually"
    );
    let mut layouts = Vec::new();
    for email in &fields {
        if !dark_interior(pixels, width, *email) {
            continue;
        }
        for password in &fields {
            if !dark_interior(pixels, width, *password) {
                continue;
            }
            if password.top <= email.bottom
                || password.top - email.bottom > height * 5 / 100
                || email.left.abs_diff(password.left) > width / 80
                || email.right.abs_diff(password.right) > width / 80
                || (email.bottom - email.top).abs_diff(password.bottom - password.top)
                    > height / 100
            {
                continue;
            }
            let buttons = rows(
                pixels,
                width,
                Region {
                    left: email.left,
                    right: email.right + 1,
                    top: (password.bottom + height * 4 / 100).min(height),
                    bottom: (password.bottom + height * 20 / 100).min(height),
                },
                width / 10,
                red,
            );
            for button in buttons {
                if !(height * 2 / 100..=height / 10).contains(&(button.bottom - button.top)) {
                    continue;
                }
                let layout = if let Some(c) = calibration {
                    let point = |p: [f32; 2]| (p[0] * width as f32, p[1] * height as f32);
                    let candidate = LoginLayout {
                        email: point(c.email),
                        password: point(c.password),
                        submit: point(c.submit),
                    };
                    if !email.contains(candidate.email)
                        || !password.contains(candidate.password)
                        || !button.contains(candidate.submit)
                    {
                        continue;
                    }
                    candidate
                } else {
                    LoginLayout {
                        email: email.center(),
                        password: password.center(),
                        submit: button.center(),
                    }
                };
                if !layouts
                    .iter()
                    .any(|existing: &LoginLayout| existing.close_to(&layout, 3.))
                {
                    layouts.push(layout);
                }
            }
        }
    }
    ensure!(
        layouts.len() == 1,
        "Login geometry missing, covered or ambiguous ({} border bands, {} fields, {} layouts); no blind coordinate fallback",
        bands.len(), fields.len(), layouts.len()
    );
    Ok(layouts.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Vec<u8> {
        let mut pixels = vec![0; 1000 * 1000 * 4];
        for y in [630, 670, 700, 740] {
            for x in 380..620 {
                pixels[(y * 1000 + x) * 4..][..4].copy_from_slice(&[40, 85, 110, 255]);
            }
        }
        for y in 830..890 {
            for x in 380..620 {
                pixels[(y * 1000 + x) * 4..][..4].copy_from_slice(&[15, 15, 100, 255]);
            }
        }
        pixels
    }
    #[test]
    fn detects_geometry_without_text() {
        let l = detect_form(&fixture(), 1000, 1000, None).unwrap();
        assert_eq!(l.email, (499.5, 650.));
        assert_eq!(l.password, (499.5, 720.));
        assert_eq!(l.submit, (499.5, 859.5));
    }
    #[test]
    fn rejects_missing_borders_button_and_bad_buffers() {
        assert!(detect_form(&[], 1000, 1000, None).is_err());
        assert!(detect_form(&[], usize::MAX, usize::MAX, None).is_err());
        let mut p = fixture();
        p[630 * 1000 * 4..671 * 1000 * 4].fill(0);
        assert!(detect_form(&p, 1000, 1000, None).is_err());
        let mut p = fixture();
        p[830 * 1000 * 4..890 * 1000 * 4].fill(0);
        assert!(detect_form(&p, 1000, 1000, None).is_err());
    }
    #[test]
    fn calibration_cannot_override_pixel_evidence() {
        let mut c = LoginCalibration {
            version: 1,
            capture_width: 1000,
            capture_height: 1000,
            email: [0.5, 0.65],
            password: [0.5, 0.72],
            submit: [0.5, 0.86],
        };
        assert!(detect_form(&fixture(), 1000, 1000, Some(&c)).is_ok());
        assert!(detect_form(&vec![0; 4000000], 1000, 1000, Some(&c)).is_err());
        c.email[0] = 0.3;
        assert!(detect_form(&fixture(), 1000, 1000, Some(&c)).is_err());
        c.capture_width = 1600;
        assert!(detect_form(&fixture(), 1000, 1000, Some(&c)).is_err());
    }
    #[test]
    fn rejects_two_possible_buttons_unless_calibrated() {
        let mut p = fixture();
        for y in 780..810 {
            for x in 380..620 {
                p[(y * 1000 + x) * 4..][..4].copy_from_slice(&[15, 15, 100, 255]);
            }
        }
        assert!(detect_form(&p, 1000, 1000, None).is_err());
    }

    #[test]
    fn rejects_bright_controls_even_with_matching_borders() {
        let mut p = fixture();
        for y in 635..665 {
            for x in 385..615 {
                p[(y * 1000 + x) * 4..][..3].fill(255);
            }
        }
        assert!(detect_form(&p, 1000, 1000, None).is_err());
    }

    #[test]
    fn shared_resampling_preserves_fixture_geometry_and_rejects_bad_dimensions() {
        let original = fixture();
        let (copy, w, h, scale) = resize_capture(&original, 1000, 1000, 1920).unwrap();
        assert_eq!((w, h, scale), (1000, 1000, 1.));
        assert_eq!(*copy, original);
        let mut doubled = vec![0; 2000 * 2000 * 4];
        for y in 0..2000 {
            for x in 0..2000 {
                doubled[(y * 2000 + x) * 4..][..4]
                    .copy_from_slice(&original[((y / 2) * 1000 + x / 2) * 4..][..4]);
            }
        }
        let (small, w, h, scale) = resize_capture(&doubled, 2000, 2000, 1000).unwrap();
        assert_eq!((w, h, scale), (1000, 1000, 2.));
        assert!(detect_form(&small, w, h, None).is_ok());
        assert!(resize_capture(&[], usize::MAX, 2000, 1000).is_err());
        assert!(resize_capture(&original, 1000, 1000, 0).is_err());
    }
}
