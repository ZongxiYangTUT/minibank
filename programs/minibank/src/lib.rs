use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");

#[program]
pub mod minibank {
    use super::*;

    pub fn create_account(ctx: Context<CreateAccount>, name: String) -> Result<()> {
        msg!("Creating account for {}", name);
        ctx.accounts.mini_account.name = name;
        ctx.accounts.mini_account.balance = 0;
        msg!("Account created successfully");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        msg!("Depositing {} lamports into account", amount);

        let from_pubkey = ctx.accounts.sender.to_account_info();
        let to_pubkey = ctx.accounts.mini_account.to_account_info();

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: from_pubkey,
                to: to_pubkey,
            },
        );
        transfer(cpi_context, amount)?;
        ctx.accounts.mini_account.balance += amount; // 更新账户余额
        msg!("Deposit successful");
        msg!("New balance: {}", ctx.accounts.mini_account.balance);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeBank {}

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(init_if_needed, seeds = [b"mini_account", payer.key().as_ref()], bump, payer = payer, space = 8 + std::mem::size_of::<MiniAccount>())]
    mini_account: Account<'info, MiniAccount>,
    #[account(mut)]
    payer: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    sender: Signer<'info>,
    #[account(mut, seeds = [b"mini_account", sender.key().as_ref()], bump)]
    mini_account: Account<'info, MiniAccount>,
    system_program: Program<'info, System>,
}
/// 包含银行账户的配置信息
#[account]
pub struct BankConfig {}

// 这种储蓄账户必须是PDA，否则无法转出余额
#[account]
pub struct MiniAccount {
    name: String, // 账户名称
    balance: u64, // 账户余额(solana lamports)
}
