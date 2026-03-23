use anchor_lang::prelude::*;

use crate::constants::{SEED_MINI_ACCOUNT, SEED_USER_STATS, SEED_USER_YIELD, SEED_YIELD_VAULT};
use crate::error::ErrorCode;
use crate::state::{MiniAccount, UserStats, UserYieldPosition, YieldVault};

#[derive(Accounts)]
pub struct InitUserStats<'info> {
    #[account(init,
         seeds = [SEED_USER_STATS, owner.key().as_ref()],
         bump,
         payer = owner,
         space = 8 + UserStats::INIT_SPACE)]
    pub user_stats: Account<'info, UserStats>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(mut, seeds = [SEED_USER_STATS, payer.key().as_ref()], bump)]
    pub user_stats: Account<'info, UserStats>,
    #[account(
        init,
        seeds = [SEED_MINI_ACCOUNT, payer.key().as_ref(), &user_stats.next_account_id.to_le_bytes()],
        bump,
        payer = payer,
        space = 8 + MiniAccount::INIT_SPACE
    )]
    pub mini_account: Account<'info, MiniAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_MINI_ACCOUNT, owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    pub mini_account: Account<'info, MiniAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [SEED_MINI_ACCOUNT, owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    pub mini_account: Account<'info, MiniAccount>,
    pub owner: Signer<'info>,
    #[account(mut, constraint = recipient.key() == owner.key() @ ErrorCode::InvalidRecipient)]
    pub recipient: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct DeleteAccount<'info> {
    #[account(
        mut,
        seeds = [SEED_MINI_ACCOUNT, owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner,
        close = recipient
    )]
    pub mini_account: Account<'info, MiniAccount>,
    pub owner: Signer<'info>,
    #[account(mut, constraint = recipient.key() == owner.key() @ ErrorCode::InvalidRecipient)]
    pub recipient: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(account_id: u64, amount: u64)]
pub struct YieldDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_MINI_ACCOUNT, owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    pub mini_account: Account<'info, MiniAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [SEED_USER_YIELD, owner.key().as_ref()],
        bump,
        space = 8 + UserYieldPosition::INIT_SPACE
    )]
    pub user_yield: Account<'info, UserYieldPosition>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [SEED_YIELD_VAULT],
        bump,
        space = 8 + YieldVault::INIT_SPACE
    )]
    pub yield_vault: Account<'info, YieldVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(target_account_id: u64)]
pub struct YieldWithdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_USER_YIELD, owner.key().as_ref()],
        bump,
        has_one = owner,
        close = owner
    )]
    pub user_yield: Account<'info, UserYieldPosition>,
    #[account(
        mut,
        seeds = [SEED_YIELD_VAULT],
        bump
    )]
    pub yield_vault: Account<'info, YieldVault>,
    #[account(
        mut,
        seeds = [SEED_MINI_ACCOUNT, owner.key().as_ref(), &target_account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    pub dest_mini_account: Account<'info, MiniAccount>,
    pub system_program: Program<'info, System>,
}
