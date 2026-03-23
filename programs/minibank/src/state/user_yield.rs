use anchor_lang::prelude::*;

/// Per-owner share position in the global vault.
#[account]
#[derive(InitSpace)]
pub struct UserYieldPosition {
    pub owner: Pubkey,
    pub shares: u64,
}
