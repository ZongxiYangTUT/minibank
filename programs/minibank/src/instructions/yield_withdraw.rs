use anchor_lang::prelude::*;

use crate::contexts::YieldWithdraw;
use crate::error::ErrorCode;
use crate::yield_accrue::{accrue_yield, dynamic_apy_bps};

pub fn process(ctx: Context<YieldWithdraw>, target_account_id: u64) -> Result<()> {
    require!(
        ctx.accounts.dest_mini_account.account_id == target_account_id,
        ErrorCode::InvalidAccountId
    );
    msg!(
        "Yield withdraw full position to savings account_id {}",
        target_account_id
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let rent = Rent::get()?;
    let vault_space = 8 + crate::state::YieldVault::INIT_SPACE;
    let min_vault_rent = rent.minimum_balance(vault_space);
    let vault_info = ctx.accounts.yield_vault.to_account_info();
    let available = vault_info
        .lamports()
        .checked_sub(min_vault_rent)
        .ok_or(ErrorCode::MathOverflow)?;
    let current_apy_bps = dynamic_apy_bps(available, ctx.accounts.yield_vault.total_principal_lamports);

    let uy = &mut ctx.accounts.user_yield;
    accrue_yield(uy, now, current_apy_bps)?;

    let principal = uy.principal_lamports;
    let accrued = uy.accrued_yield_lamports;
    require!(
        principal > 0 || accrued > 0,
        ErrorCode::NoYieldPosition
    );
    // Principal must always be withdrawable; yield only from liquidity not reserved as principal.
    require!(available >= principal, ErrorCode::YieldVaultInsufficient);
    let total_principal = ctx.accounts.yield_vault.total_principal_lamports;
    require!(
        total_principal >= principal,
        ErrorCode::YieldVaultAccountingMismatch
    );
    let reward_pool = available
        .checked_sub(total_principal)
        .ok_or(ErrorCode::MathOverflow)?;
    let paid_yield = core::cmp::min(accrued, reward_pool);
    let total = principal
        .checked_add(paid_yield)
        .ok_or(ErrorCode::MathOverflow)?;

    let dest_info = ctx.accounts.dest_mini_account.to_account_info();

    let new_vault = vault_info
        .lamports()
        .checked_sub(total)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_dest = dest_info
        .lamports()
        .checked_add(total)
        .ok_or(ErrorCode::MathOverflow)?;

    **vault_info.try_borrow_mut_lamports()? = new_vault;
    **dest_info.try_borrow_mut_lamports()? = new_dest;

    ctx.accounts.yield_vault.total_principal_lamports = ctx
        .accounts
        .yield_vault
        .total_principal_lamports
        .checked_sub(principal)
        .ok_or(ErrorCode::MathOverflow)?;

    ctx.accounts.dest_mini_account.balance = ctx
        .accounts
        .dest_mini_account
        .balance
        .checked_add(total)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!(
        "Yield withdraw ok; paid {} lamports (principal {} + yield {} of accrued {}), dynamic apy {} bps",
        total,
        principal,
        paid_yield,
        accrued,
        current_apy_bps
    );
    Ok(())
}
