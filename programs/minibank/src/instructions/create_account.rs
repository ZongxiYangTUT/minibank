use anchor_lang::prelude::*;

use crate::contexts::CreateAccount;
use crate::constants::MAX_NAME_LEN;
use crate::errors::ErrorCode;

pub fn process(ctx: Context<CreateAccount>, name: String) -> Result<()> {
    require!(!name.is_empty(), ErrorCode::EmptyName);
    require!(name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);

    msg!("Creating account for {}", name);
    ctx.accounts.mini_account.owner = ctx.accounts.payer.key();
    ctx.accounts.mini_account.account_id = ctx.accounts.user_stats.next_account_id;
    ctx.accounts.mini_account.name = name;
    ctx.accounts.mini_account.balance = 0;
    ctx.accounts.user_stats.next_account_id = ctx
        .accounts
        .mini_account
        .account_id
        .checked_add(1)
        .ok_or(ErrorCode::MathOverflow)?;
    msg!("Account created successfully");
    Ok(())
}
