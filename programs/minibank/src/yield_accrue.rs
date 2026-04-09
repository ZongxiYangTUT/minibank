use anchor_lang::prelude::*;

use crate::constants::{
    RATE_BASE_BPS, RATE_KINK_UTIL_BPS, RATE_SLOPE1_BPS, RATE_SLOPE2_BPS, SECONDS_PER_YEAR,
};
use crate::error::ErrorCode;
use crate::state::YieldVault;
/// 计算资金利用率（1bps = 0.01%）
/// 资金利用率 = 总借款 / 总资产
pub fn utilization_bps(total_assets: u64, total_borrowed: u64) -> u64 {
    if total_assets == 0 {
        return 0;
    }
    let u = ((total_borrowed as u128) * 10_000u128 / (total_assets as u128)) as u64;
    core::cmp::min(u, 10_000)
}

/// 分段计算利率
pub fn get_interest_rate_bps(util_bps: u64) -> u64 {
    // 80%是利率拐点
    // rate = base + u / k * slope
    if util_bps <= RATE_KINK_UTIL_BPS {
        let x = (util_bps as u128)
            .checked_mul(RATE_SLOPE1_BPS as u128)
            .and_then(|v| v.checked_div(RATE_KINK_UTIL_BPS as u128))
            .unwrap_or(0) as u64;
        RATE_BASE_BPS.saturating_add(x)
    } else {
        // 第一段已经吃满：base + slope1
        // 第二段继续增长：+ (u - k) / (10000 - k) * slope2
        let tail_util = util_bps.saturating_sub(RATE_KINK_UTIL_BPS);
        let tail_range = 10_000u64.saturating_sub(RATE_KINK_UTIL_BPS);
        let y = if tail_range == 0 {
            RATE_SLOPE2_BPS
        } else {
            ((tail_util as u128)
                .checked_mul(RATE_SLOPE2_BPS as u128)
                .and_then(|v| v.checked_div(tail_range as u128))
                .unwrap_or(0)) as u64
        };
        RATE_BASE_BPS
            .saturating_add(RATE_SLOPE1_BPS)
            .saturating_add(y)
    }
}

/// Accrue global borrow interest into vault accounting.
pub fn accrue_interest(vault: &mut YieldVault, now: i64) -> Result<()> {
    if vault.last_accrual_ts == 0 {
        vault.last_accrual_ts = now;
        return Ok(());
    }
    if now <= vault.last_accrual_ts {
        return Ok(());
    }
    let elapsed = (now - vault.last_accrual_ts) as u64;
    if elapsed == 0 || vault.total_borrowed == 0 {
        vault.last_accrual_ts = now;
        return Ok(());
    }
    // 计算资金利用率
    let util = utilization_bps(vault.total_assets, vault.total_borrowed);
    // 计算利率
    let rate_bps = get_interest_rate_bps(util);

    // 计算收益，收益 = 总借款 * 利率 * 时间 / 一年
    // 把收益添加到总资产和总借款中，表示“借款人需要支付的利息”，这些利息将作为“存款人”的收益
    let delta = (vault.total_borrowed as u128)
        .checked_mul(rate_bps as u128)
        .and_then(|x| x.checked_mul(elapsed as u128))
        .and_then(|x| x.checked_div(10_000u128))
        .and_then(|x| x.checked_div(SECONDS_PER_YEAR as u128))
        .ok_or(ErrorCode::MathOverflow)? as u64;

    vault.total_borrowed = vault
        .total_borrowed
        .checked_add(delta)
        .ok_or(ErrorCode::MathOverflow)?;
    vault.total_assets = vault
        .total_assets
        .checked_add(delta)
        .ok_or(ErrorCode::MathOverflow)?;
    vault.last_accrual_ts = now;
    Ok(())
}
