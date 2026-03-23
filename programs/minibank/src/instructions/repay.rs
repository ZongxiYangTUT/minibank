use anchor_lang::prelude::*;

use crate::contexts::Repay;
use crate::error::ErrorCode;
use crate::yield_accrue::accrue_interest;

pub fn process(ctx: Context<Repay>, source_account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.source_mini_account.account_id == source_account_id,
        ErrorCode::InvalidAccountId
    );

    if ctx.accounts.source_mini_account.balance < amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    let source_info = ctx.accounts.source_mini_account.to_account_info();
    require!(source_info.lamports() >= amount, ErrorCode::InsufficientVaultLamports);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let vault = &mut ctx.accounts.yield_vault;
    accrue_interest(vault, now)?;

    let repay_amount = core::cmp::min(amount, vault.total_borrowed);
    require!(repay_amount > 0, ErrorCode::InvalidAmount);

    let vault_info = vault.to_account_info();
    let new_source = source_info
        .lamports()
        .checked_sub(repay_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    let new_vault = vault_info
        .lamports()
        .checked_add(repay_amount)
        .ok_or(ErrorCode::MathOverflow)?;

    **source_info.try_borrow_mut_lamports()? = new_source;
    **vault_info.try_borrow_mut_lamports()? = new_vault;

    ctx.accounts.source_mini_account.balance = ctx
        .accounts
        .source_mini_account
        .balance
        .checked_sub(repay_amount)
        .ok_or(ErrorCode::MathOverflow)?;

    vault.total_borrowed = vault
        .total_borrowed
        .checked_sub(repay_amount)
        .ok_or(ErrorCode::MathOverflow)?;
    // total_assets unchanged on repay (cash in, debt down).

    msg!("Repay ok: {} lamports", repay_amount);
    Ok(())
}
