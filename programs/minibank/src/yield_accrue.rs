use anchor_lang::prelude::*;

use crate::constants::{SECONDS_PER_YEAR, YIELD_APY_BPS};
use crate::error::ErrorCode;
use crate::state::UserYieldPosition;

/// Simple interest on `principal` since `last_yield_ts`; accumulates into `accrued_yield_lamports`.
pub fn accrue_yield(position: &mut UserYieldPosition, now: i64) -> Result<()> {
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
        .checked_mul(YIELD_APY_BPS as u128)
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
