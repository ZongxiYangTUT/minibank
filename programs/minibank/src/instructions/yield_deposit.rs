use anchor_lang::prelude::*;

use crate::contexts::YieldDeposit;
use crate::error::ErrorCode;
use crate::yield_accrue::accrue_interest;

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
    // 校验余额
    if ctx.accounts.mini_account.balance < amount {
        return Err(ErrorCode::InsufficientBalance.into());
    }

    let mini_info = ctx.accounts.mini_account.to_account_info();
    require!(
        mini_info.lamports() >= amount,
        ErrorCode::InsufficientVaultLamports
    );

    let uy = &mut ctx.accounts.user_yield;
    if uy.owner == Pubkey::default() {
        uy.owner = ctx.accounts.owner.key();
    }
    require!(
        uy.owner == ctx.accounts.owner.key(),
        ErrorCode::InvalidRecipient
    );
    // 获取当前链上时间
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let vault = &mut ctx.accounts.yield_vault;
    // 计算利息
    accrue_interest(vault, now)?;

    // 资金池里隐含一个“加个”，每一份share的价值 = 总资产 / 总份额
    // 如果不这样算，后存入的用户会稀释早期权益
    // 把资产转成对应的份额，向下取整
    let minted_shares = if vault.total_shares == 0 || vault.total_assets == 0 {
        // 首次存入，资产:份额 = 1:1
        amount
    } else {
        // 非首次存入，份额 = 资产 / 每一份share的价值
        ((amount as u128)
            .checked_mul(vault.total_shares as u128)
            .and_then(|v| v.checked_div(vault.total_assets as u128))
            .ok_or(ErrorCode::MathOverflow)?) as u64
    };

    // 校验份额是否大于0
    require!(minted_shares > 0, ErrorCode::InvalidShareAmount);

    let vault_info = vault.to_account_info();

    // 从储蓄账户中扣除资产
    let mini_lamports = mini_info
        .lamports()
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    // 增加资金池中的资产
    let vault_lamports = vault_info
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    **mini_info.try_borrow_mut_lamports()? = mini_lamports;
    **vault_info.try_borrow_mut_lamports()? = vault_lamports;

    // 更新余额字段
    ctx.accounts.mini_account.balance = ctx
        .accounts
        .mini_account
        .balance
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    // 更新份额字段
    uy.shares = uy
        .shares
        .checked_add(minted_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    vault.bump = ctx.bumps.yield_vault;
    vault.total_assets = vault
        .total_assets
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    vault.total_shares = vault
        .total_shares
        .checked_add(minted_shares)
        .ok_or(ErrorCode::MathOverflow)?;

    msg!(
        "Yield deposit ok; assets {} -> minted shares {}",
        amount,
        minted_shares
    );
    Ok(())
}
