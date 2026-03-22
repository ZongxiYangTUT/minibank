use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserStats {
    /// Next `account_id` to allocate when creating a new savings account.
    pub next_account_id: u64,
}
