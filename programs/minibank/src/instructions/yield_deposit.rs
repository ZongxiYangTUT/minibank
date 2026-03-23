use anchor_lang::prelude::*;

use crate::contexts::YieldDeposit;
use crate::error::ErrorCode;
use crate::yield_accrue::accrue_interest;

pub fn process(ctx: Context<YieldDeposit>, account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.mini_account.account_id == account_id,
        ErrorCode::InvalidAccountId
    );
    msg!(
        "Yield deposit {} lamports from savings account_id {}",
        amount,
        account_id
    );

    if ctx.accounts.mini_account.balance < amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    let mini_info = ctx.accounts.mini_account.to_account_info();
    require!(
        mini_info.lamports() >= amount,
        ErrorCode::InsufficientVaultLamports
    );

    let uy = &mut ctx.accounts.user_yield;
    if uy.owner == Pubkey::default() {
        uy.owner = ctx.accounts.owner.key();
    }
    require!(
        uy.owner == ctx.accounts.owner.key(),
        ErrorCode::InvalidRecipient
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let vault = &mut ctx.accounts.yield_vault;
    accrue_interest(vault, now)?;

    // assets->shares conversion (round down).
    let minted_shares = if vault.total_shares == 0 || vault.total_assets == 0 {
        amount
    } else {
        ((amount as u128)
            .checked_mul(vault.total_shares as u128)
            .and_then(|v| v.checked_div(vault.total_assets as u128))
            .ok_or(ErrorCode::MathOverflow)?) as u64
    };
    require!(minted_shares > 0, ErrorCode::InvalidShareAmount);

    let vault_info = vault.to_account_info();

    let mini_lamports = mini_info
        .lamports()
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    let vault_lamports = vault_info
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    **mini_info.try_borrow_mut_lamports()? = mini_lamports;
    **vault_info.try_borrow_mut_lamports()? = vault_lamports;

    ctx.accounts.mini_account.balance = ctx
        .accounts
        .mini_account
        .balance
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    uy.shares = uy
        .shares
        .checked_add(minted_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    vault.bump = ctx.bumps.yield_vault;
    vault.total_assets = vault
        .total_assets
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(minted_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!(
        "Yield deposit ok; assets {} -> minted shares {}",
        amount,
        minted_shares
    );
    Ok(())
}
