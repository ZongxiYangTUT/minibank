use anchor_lang::prelude::*;

use crate::contexts::Borrow;
use crate::error::ErrorCode;
use crate::yield_accrue::accrue_interest;

pub fn process(ctx: Context<Borrow>, target_account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.dest_mini_account.account_id == target_account_id,
        ErrorCode::InvalidAccountId
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let vault = &mut ctx.accounts.yield_vault;
    accrue_interest(vault, now)?;

    let vault_info = vault.to_account_info();
    require!(vault_info.lamports() >= amount, ErrorCode::InsufficientBorrowLiquidity);

    let dest_info = ctx.accounts.dest_mini_account.to_account_info();
    let new_vault = vault_info
        .lamports()
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_dest = dest_info
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    **vault_info.try_borrow_mut_lamports()? = new_vault;
    **dest_info.try_borrow_mut_lamports()? = new_dest;

    vault.total_borrowed = vault
        .total_borrowed
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    // total_assets unchanged on borrow (cash out, debt up).

    ctx.accounts.dest_mini_account.balance = ctx
        .accounts
        .dest_mini_account
        .balance
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!("Borrow ok: {} lamports", amount);
    Ok(())
}
