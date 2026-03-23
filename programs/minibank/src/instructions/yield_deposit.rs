use anchor_lang::prelude::*;

use crate::contexts::YieldDeposit;
use crate::error::ErrorCode;
use crate::yield_accrue::{accrue_yield, dynamic_apy_bps};

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

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let uy = &mut ctx.accounts.user_yield;
    if uy.owner == Pubkey::default() {
        uy.owner = ctx.accounts.owner.key();
    }
    require!(
        uy.owner == ctx.accounts.owner.key(),
        ErrorCode::InvalidRecipient
    );

    let vault_info = ctx.accounts.yield_vault.to_account_info();
    let rent = Rent::get()?;
    let vault_space = 8 + crate::state::YieldVault::INIT_SPACE;
    let min_vault_rent = rent.minimum_balance(vault_space);
    let available = vault_info
        .lamports()
        .checked_sub(min_vault_rent)
        .ok_or(ErrorCode::MathOverflow)?;
    let current_apy_bps = dynamic_apy_bps(available, ctx.accounts.yield_vault.total_principal_lamports);

    accrue_yield(uy, now, current_apy_bps)?;

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

    uy.principal_lamports = uy
        .principal_lamports
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    let v = &mut ctx.accounts.yield_vault;
    v.bump = ctx.bumps.yield_vault;
    v.total_principal_lamports = v
        .total_principal_lamports
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!(
        "Yield deposit ok; principal {}, dynamic apy {} bps",
        uy.principal_lamports,
        current_apy_bps
    );
    Ok(())
}
