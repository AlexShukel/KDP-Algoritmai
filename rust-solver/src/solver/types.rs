#[derive(Clone, Copy, Debug)]
pub struct PathBuffer {
    pub nodes: [u8; 16],
    pub len: u8,
}

impl Default for PathBuffer {
    fn default() -> Self {
        Self { nodes: [0; 16], len: 0 }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct InternalTspResult {
    pub path: PathBuffer,
    pub total_dist: f64,
    pub total_empty: f64,
    pub total_price: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct InternalBestResults {
    pub min_dist: InternalTspResult,
    pub min_price: InternalTspResult,
    pub min_empty: InternalTspResult,
    pub valid: bool,
}