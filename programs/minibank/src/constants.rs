//! Program-wide constants (PDA seeds, string length limits).

pub const MAX_NAME_LEN: usize = 32;

pub const SEED_USER_STATS: &[u8] = b"user_stats";
pub const SEED_MINI_ACCOUNT: &[u8] = b"mini_account";
pub const SEED_YIELD_VAULT: &[u8] = b"yield_vault_v2";
pub const SEED_USER_YIELD: &[u8] = b"user_yield";

/// Piecewise utilization model params in basis points.
pub const RATE_BASE_BPS: u64 = 100; // 1%
pub const RATE_SLOPE1_BPS: u64 = 400; // up to +4% before kink
pub const RATE_SLOPE2_BPS: u64 = 2_000; // up to +20% after kink
pub const RATE_KINK_UTIL_BPS: u64 = 8_000; // 80%
pub const SECONDS_PER_YEAR: u64 = 31_536_000;
