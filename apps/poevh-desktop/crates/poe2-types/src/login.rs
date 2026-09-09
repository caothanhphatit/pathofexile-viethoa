use serde::{Deserialize, Serialize};

/// User-confirmed points, relative to the GAME CLIENT AREA, never the desktop.
/// Images and credentials are deliberately not part of this data structure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginCalibration {
    pub version: u32,
    pub capture_width: u32,
    pub capture_height: u32,
    pub email: [f32; 2],
    pub password: [f32; 2],
    pub submit: [f32; 2],
}

impl LoginCalibration {
    pub fn valid(&self) -> bool {
        self.version == 1
            && (800..=7680).contains(&self.capture_width)
            && (500..=4320).contains(&self.capture_height)
            && [self.email, self.password, self.submit].iter().all(|p| {
                p.iter().all(|v| v.is_finite())
                    && (0.25..0.75).contains(&p[0])
                    && (0.45..0.95).contains(&p[1])
            })
            && self.email[1] < self.password[1]
            && self.password[1] < self.submit[1]
    }

    pub fn fits(&self, width: u32, height: u32) -> bool {
        self.valid()
            && width > 0
            && height > 0
            && ((width as f32 / height as f32)
                / (self.capture_width as f32 / self.capture_height as f32)
                - 1.0)
                .abs()
                <= 0.02
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calibration_is_versioned_finite_ordered_and_aspect_bound() {
        let value = LoginCalibration {
            version: 1,
            capture_width: 1920,
            capture_height: 1080,
            email: [0.5, 0.65],
            password: [0.5, 0.71],
            submit: [0.5, 0.84],
        };
        assert!(value.fits(1280, 720));
        assert!(!value.fits(1280, 1024));
        for bad in [f32::NAN, f32::INFINITY, -0.1, 1.1] {
            let mut copy = value.clone();
            copy.email[0] = bad;
            assert!(!copy.valid());
        }
        let mut copy = value.clone();
        copy.version = 2;
        assert!(!copy.valid());
        let mut copy = value.clone();
        copy.password[1] = 0.6;
        assert!(!copy.valid());
        assert!(!value.fits(0, 0));
    }
}
