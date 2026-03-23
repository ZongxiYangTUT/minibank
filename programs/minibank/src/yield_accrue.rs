use anchor_lang::prelude::*;

use crate::constants::{
    APY_RATIO_DIVISOR, MAX_YIELD_APY_BPS, MIN_YIELD_APY_BPS, SECONDS_PER_YEAR,
};
use crate::error::ErrorCode;
use crate::state::UserYieldPosition;

/// Dynamic APY based on reward pool size vs total principal.
pub fn dynamic_apy_bps(available_lamports: u64, total_principal_lamports: u64) -> u64 {
    if total_principal_lamports == 0 {
        return MIN_YIELD_APY_BPS;
    }

    let reward_pool = available_lamports.saturating_sub(total_principal_lamports);
    let reward_ratio_bps = ((reward_pool as u128) * 10_000u128 / (total_principal_lamports as u128)) as u64;
    let dynamic = MIN_YIELD_APY_BPS.saturating_add(reward_ratio_bps / APY_RATIO_DIVISOR);
    dynamic.clamp(MIN_YIELD_APY_BPS, MAX_YIELD_APY_BPS)
}

/// Simple interest on `principal` since `last_yield_ts`; accumulates into `accrued_yield_lamports`.
pub fn accrue_yield(position: &mut UserYieldPosition, now: i64, current_apy_bps: u64) -> Result<()> {
    if position.last_yield_ts == 0 {
        position.last_yield_ts = now;
        return Ok(());
    }
    if now <= position.last_yield_ts {
        return Ok(());
    }
    let elapsed = (now - position.last_yield_ts) as u64;
    if elapsed == 0 || position.principal_lamports == 0 {
        position.last_yield_ts = now;
        return Ok(());
    }
    let delta = (position.principal_lamports as u128)
        .checked_mul(current_apy_bps as u128)
        .and_then(|x| x.checked_mul(elapsed as u128))
        .and_then(|x| x.checked_div(10_000u128))
        .and_then(|x| x.checked_div(SECONDS_PER_YEAR as u128))
        .ok_or(ErrorCode::MathOverflow)? as u64;
    position.accrued_yield_lamports = position
        .accrued_yield_lamports
        .checked_add(delta)
        .ok_or(ErrorCode::MathOverflow)?;
    position.last_yield_ts = now;
    Ok(())
}
