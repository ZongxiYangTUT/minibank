use anchor_lang::prelude::*;

use crate::contexts::Withdraw;
use crate::error::ErrorCode;

pub fn process(ctx: Context<Withdraw>, account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.mini_account.account_id == account_id,
        ErrorCode::InvalidAccountId
    );
    msg!("Withdrawing {} lamports from account", amount);

    if ctx.accounts.mini_account.balance < amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    let mini_info = ctx.accounts.mini_account.to_account_info();
    let recipient_info = ctx.accounts.recipient.to_account_info();

    require!(
        mini_info.lamports() >= amount,
        ErrorCode::InsufficientVaultLamports
    );

    let recipient_new = recipient_info
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    **mini_info.try_borrow_mut_lamports()? -= amount;
    **recipient_info.try_borrow_mut_lamports()? = recipient_new;

    ctx.accounts.mini_account.balance = ctx
        .accounts
        .mini_account
        .balance
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!("Withdrawal successful");
    msg!("New balance: {}", ctx.accounts.mini_account.balance);
    Ok(())
}
