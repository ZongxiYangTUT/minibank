use anchor_lang::prelude::*;

/// Global vault PDA that holds all 余额宝 principal plus reward pool lamports.
///
/// `total_principal_lamports` must equal the sum of all [`UserYieldPosition::principal_lamports`].
/// Reward liquidity = `vault.lamports() - rent_exempt - total_principal_lamports` (funded by transfers in).
#[account]
#[derive(InitSpace)]
pub struct YieldVault {
    pub bump: u8,
    pub total_principal_lamports: u64,
}
