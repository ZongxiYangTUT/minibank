use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");

const MAX_NAME_LEN: usize = 32;

#[program]
pub mod minibank {
    use super::*;

    pub fn init_user_stats(ctx: Context<InitUserStats>) -> Result<()> {
        ctx.accounts.user_stats.next_account_id = 0;
        Ok(())
    }

    pub fn create_account(ctx: Context<CreateAccount>, name: String) -> Result<()> {
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

    pub fn deposit(ctx: Context<Deposit>, account_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        // account_id 必须与指令数据一致（PDA 已校验，此处防调用方传错）
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

    pub fn withdraw(ctx: Context<Withdraw>, account_id: u64, amount: u64) -> Result<()> {
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

        // Data account cannot be used as `from` in system_program::transfer,
        // so we move lamports directly between accounts.
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

    pub fn delete_account(ctx: Context<DeleteAccount>, account_id: u64) -> Result<()> {
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
}

#[derive(Accounts)]
pub struct InitUserStats<'info> {
    #[account(init,
         seeds = [b"user_stats", owner.key().as_ref()], 
         bump, 
         payer = owner, 
         space = 8 + UserStats::INIT_SPACE)]
    user_stats: Account<'info, UserStats>,
    #[account(mut)]
    owner: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(mut, seeds = [b"user_stats", payer.key().as_ref()], bump)]
    user_stats: Account<'info, UserStats>,
    #[account(
        init,
        seeds = [b"mini_account", payer.key().as_ref(), &user_stats.next_account_id.to_le_bytes()],
        bump,
        payer = payer,
        space = 8 + MiniAccount::INIT_SPACE
    )]
    mini_account: Account<'info, MiniAccount>,
    #[account(mut)]
    payer: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mini_account", owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    mini_account: Account<'info, MiniAccount>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"mini_account", owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner
    )]
    mini_account: Account<'info, MiniAccount>,
    owner: Signer<'info>,
    #[account(mut, constraint = recipient.key() == owner.key() @ ErrorCode::InvalidRecipient)]
    recipient: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(account_id: u64)]
pub struct DeleteAccount<'info> {
    #[account(
        mut,
        seeds = [b"mini_account", owner.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        has_one = owner,
        close = recipient
    )]
    mini_account: Account<'info, MiniAccount>,
    owner: Signer<'info>,
    #[account(mut, constraint = recipient.key() == owner.key() @ ErrorCode::InvalidRecipient)]
    recipient: SystemAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct MiniAccount {
    pub owner: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    pub balance: u64,
    pub account_id: u64,
}

#[account]
#[derive(InitSpace)]
pub struct UserStats {
    pub next_account_id: u64, // The next account ID to be used for a new account
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Account not empty")]
    AccountNotEmpty,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Name cannot be empty")]
    EmptyName,
    #[msg("Name is too long")]
    NameTooLong,
    #[msg("Recipient must match account owner")]
    InvalidRecipient,
    #[msg("Mini account does not have enough lamports")]
    InsufficientVaultLamports,
    #[msg("Account id does not match instruction")]
    InvalidAccountId,
}
