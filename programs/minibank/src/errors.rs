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
}
