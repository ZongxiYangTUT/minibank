use anchor_lang::prelude::*;

use crate::contexts::InitUserStats;

pub fn process(ctx: Context<InitUserStats>) -> Result<()> {
    ctx.accounts.user_stats.next_account_id = 0;
    Ok(())
}
