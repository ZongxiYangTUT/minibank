use anchor_lang::prelude::*;

use crate::constants::MAX_NAME_LEN;

#[account]
#[derive(InitSpace)]
pub struct MiniAccount {
    pub owner: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    pub balance: u64,
    pub account_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserStats {
    /// 下一个创建账户时使用的 account_id
    pub next_account_id: u64,
}
