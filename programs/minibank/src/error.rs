use anchor_lang::prelude::*;

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
    #[msg("No 余额宝 position to withdraw")]
    NoYieldPosition,
    #[msg("Yield vault does not have enough lamports for principal and interest")]
    YieldVaultInsufficient,
    #[msg("Yield vault total_principal does not match expected invariants")]
    YieldVaultAccountingMismatch,
    #[msg("Invalid share amount")]
    InvalidShareAmount,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Vault has no liquidity for borrow")]
    InsufficientBorrowLiquidity,
}
