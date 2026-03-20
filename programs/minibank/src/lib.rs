use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");

const MAX_NAME_LEN: usize = 32;

#[program]
pub mod minibank {
    use super::*;

    pub fn create_account(
        ctx: Context<CreateAccount>,
        account_id: u64,
        name: String,
    ) -> Result<()> {
        require!(!name.is_empty(), ErrorCode::EmptyName);
        require!(name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);

        msg!("Creating account for {}", name);
        ctx.accounts.mini_account.owner = ctx.accounts.payer.key();
        ctx.accounts.mini_account.account_id = account_id;
        ctx.accounts.mini_account.name = name;
        ctx.accounts.mini_account.balance = 0;
        msg!("Account created successfully");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, _account_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
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

    pub fn withdraw(ctx: Context<Withdraw>, _account_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        msg!("Withdrawing {} lamports from account", amount);

        if ctx.accounts.mini_account.balance < amount {
            return Err(ErrorCode::InsufficientBalance.into());
        }

        let mini_info = ctx.accounts.mini_account.to_account_info();
        let recipient_info = ctx.accounts.recipient.to_account_info();

        require!(mini_info.lamports() >= amount, ErrorCode::InsufficientVaultLamports);

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

    pub fn delete_account(ctx: Context<DeleteAccount>, _account_id: u64) -> Result<()> {
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
#[instruction(account_id: u64)]
pub struct CreateAccount<'info> {
    #[account(
        init,
        seeds = [b"mini_account", payer.key().as_ref(), &account_id.to_le_bytes()],
        bump,
        payer = payer,
        space = MiniAccount::SPACE
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
pub struct MiniAccount {
    owner: Pubkey,
    name: String,
    balance: u64,
    account_id: u64,
}

impl MiniAccount {
    pub const SPACE: usize = 8 + 32 + 4 + MAX_NAME_LEN + 8 + 8;
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
}
