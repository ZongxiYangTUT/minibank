//! Program-wide constants (PDA seeds, string length limits).

pub const MAX_NAME_LEN: usize = 32;

pub const SEED_USER_STATS: &[u8] = b"user_stats";
pub const SEED_MINI_ACCOUNT: &[u8] = b"mini_account";
pub const SEED_YIELD_VAULT: &[u8] = b"yield_vault";
pub const SEED_USER_YIELD: &[u8] = b"user_yield";

/// Floating APY bounds in basis points (10000 = 100%).
pub const MIN_YIELD_APY_BPS: u64 = 100;
pub const MAX_YIELD_APY_BPS: u64 = 2_000;
/// `reward_pool_ratio_bps / APY_RATIO_DIVISOR` contributes to APY above minimum.
pub const APY_RATIO_DIVISOR: u64 = 2;
pub const SECONDS_PER_YEAR: u64 = 31_536_000;
