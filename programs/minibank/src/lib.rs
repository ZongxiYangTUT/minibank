use anchor_lang::prelude::*;

declare_id!("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");

#[program]
pub mod minibank {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
