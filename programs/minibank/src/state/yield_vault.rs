use anchor_lang::prelude::*;

/// Global pool state for share-based yield + borrow market.
#[account]
#[derive(InitSpace)]
pub struct YieldVault {
    pub bump: u8,
    /// Total underlying assets owned by depositors (vault cash + outstanding borrows).
    pub total_assets: u64,
    /// Total shares minted to depositors.
    pub total_shares: u64,
    /// Outstanding borrowed principal + accrued borrow interest.
    pub total_borrowed: u64,
    /// Last timestamp when global borrow interest was accrued.
    pub last_accrual_ts: i64,
}
