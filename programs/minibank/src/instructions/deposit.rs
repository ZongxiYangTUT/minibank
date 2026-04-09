use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::contexts::Deposit;
use crate::error::ErrorCode;

pub fn process(ctx: Context<Deposit>, account_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        ctx.accounts.mini_account.account_id == account_id,
        ErrorCode::InvalidAccountId
    );
    msg!("Depositing {} lamports into account", amount);

    let from_pubkey = ctx.accounts.owner.to_account_info();
    let to_pubkey = ctx.accounts.mini_account.to_account_info();

    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: from_pubkey,
            to: to_pubkey,
        },
    );
    transfer(cpi_context, amount)?;
    // 更新余额
    ctx.accounts.mini_account.balance = ctx
        .accounts
        .mini_account
        .balance
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!("Deposit successful");
    msg!("New balance: {}", ctx.accounts.mini_account.balance);
    Ok(())
}
