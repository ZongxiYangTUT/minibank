use anchor_lang::prelude::*;

use crate::contexts::DeleteAccount;
use crate::errors::ErrorCode;

pub fn process(ctx: Context<DeleteAccount>, account_id: u64) -> Result<()> {
    require!(
        ctx.accounts.mini_account.account_id == account_id,
        ErrorCode::InvalidAccountId
    );
    msg!("Deleting account");
    require!(
        ctx.accounts.mini_account.balance == 0,
        ErrorCode::AccountNotEmpty
    );
    msg!("Account deleted successfully");
    Ok(())
}
