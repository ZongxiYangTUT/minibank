use anchor_lang::prelude::*;

use crate::contexts::YieldWithdraw;
use crate::error::ErrorCode;
use crate::yield_accrue::accrue_interest;

pub fn process(ctx: Context<YieldWithdraw>, target_account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
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
    let vault = &mut ctx.accounts.yield_vault;
    accrue_interest(vault, now)?;

    require!(vault.total_assets > 0 && vault.total_shares > 0, ErrorCode::NoYieldPosition);

    let burn_shares = ((amount as u128)
        .checked_mul(vault.total_shares as u128)
        .and_then(|v| v.checked_add(vault.total_assets as u128 - 1))
        .and_then(|v| v.checked_div(vault.total_assets as u128))
        .ok_or(ErrorCode::MathOverflow)?) as u64;
    require!(burn_shares > 0, ErrorCode::InvalidShareAmount);

    let uy = &mut ctx.accounts.user_yield;
    require!(uy.shares >= burn_shares, ErrorCode::InsufficientShares);

    let assets_out = ((burn_shares as u128)
        .checked_mul(vault.total_assets as u128)
        .and_then(|v| v.checked_div(vault.total_shares as u128))
        .ok_or(ErrorCode::MathOverflow)?) as u64;
    require!(assets_out > 0, ErrorCode::InvalidAmount);

    let dest_info = ctx.accounts.dest_mini_account.to_account_info();
    let vault_info = vault.to_account_info();

    let new_vault = vault_info
        .lamports()
        .checked_sub(assets_out)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_dest = dest_info
        .lamports()
        .checked_add(assets_out)
        .ok_or(ErrorCode::MathOverflow)?;

    **vault_info.try_borrow_mut_lamports()? = new_vault;
    **dest_info.try_borrow_mut_lamports()? = new_dest;

    vault.total_assets = vault
        .total_assets
        .checked_sub(assets_out)
        .ok_or(ErrorCode::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_sub(burn_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    uy.shares = uy
        .shares
        .checked_sub(burn_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    ctx.accounts.dest_mini_account.balance = ctx
        .accounts
        .dest_mini_account
        .balance
        .checked_add(assets_out)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!(
        "Yield withdraw ok; burned shares {} -> assets {}",
        burn_shares,
        assets_out
    );
    Ok(())
}
