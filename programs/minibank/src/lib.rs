//! Minibank program entry: declares modules and dispatches `#[program]` instructions to `instructions::*`.

use anchor_lang::prelude::*;

pub mod constants;
pub mod contexts;
pub mod error;
pub mod instructions;
pub mod state;
pub mod yield_accrue;

pub use contexts::*;
pub use error::ErrorCode;
pub use state::{MiniAccount, UserStats, UserYieldPosition, YieldVault};

declare_id!("9Sa5rGRUsm8SikPFcDYSCEAHLch1xdqSvK6A8xbhb6nr");

#[program]
pub mod minibank {
    use super::*;

    pub fn init_user_stats(ctx: Context<InitUserStats>) -> Result<()> {
        instructions::init_user_stats::process(ctx)
    }

    pub fn create_account(ctx: Context<CreateAccount>, name: String) -> Result<()> {
        instructions::create_account::process(ctx, name)
    }

    pub fn deposit(ctx: Context<Deposit>, account_id: u64, amount: u64) -> Result<()> {
        instructions::deposit::process(ctx, account_id, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, account_id: u64, amount: u64) -> Result<()> {
        instructions::withdraw::process(ctx, account_id, amount)
    }

    pub fn delete_account(ctx: Context<DeleteAccount>, account_id: u64) -> Result<()> {
        instructions::delete_account::process(ctx, account_id)
    }

    pub fn yield_deposit(ctx: Context<YieldDeposit>, account_id: u64, amount: u64) -> Result<()> {
        instructions::yield_deposit::process(ctx, account_id, amount)
    }

    pub fn yield_withdraw(ctx: Context<YieldWithdraw>, target_account_id: u64, amount: u64) -> Result<()> {
        instructions::yield_withdraw::process(ctx, target_account_id, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, target_account_id: u64, amount: u64) -> Result<()> {
        instructions::borrow::process(ctx, target_account_id, amount)
    }

    pub fn repay(ctx: Context<Repay>, source_account_id: u64, amount: u64) -> Result<()> {
        instructions::repay::process(ctx, source_account_id, amount)
    }
}
