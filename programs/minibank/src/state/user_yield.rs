use anchor_lang::prelude::*;

/// Per-owner 余额宝 position: principal in the vault + accrued yield (simple interest on principal).
#[account]
#[derive(InitSpace)]
pub struct UserYieldPosition {
    pub owner: Pubkey,
    pub principal_lamports: u64,
    pub accrued_yield_lamports: u64,
    pub last_yield_ts: i64,
}
