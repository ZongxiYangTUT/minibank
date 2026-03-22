use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserStats {
    /// 下一个创建账户时使用的 account_id
    pub next_account_id: u64,
}
