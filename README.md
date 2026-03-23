# Minibank

A minimal **Solana + Anchor** demo: per-user savings accounts (`MiniAccount` PDAs), deposits, withdrawals, account close, and a **余额宝-like yield position** backed by a global vault. Includes a **React + Vite** UI with wallet or local keypair signing.

## Repository layout

| Path | Description |
|------|-------------|
| `programs/minibank/` | Anchor program (`lib.rs`, `instructions/`, `state/`, `contexts.rs`, `error.rs`, `constants.rs`) |
| `app/` | Frontend (`npm run dev` / `npm run build`) |
| `tests/` | TypeScript integration tests (`anchor test`) |
| `target/idl/` | Generated IDL after `anchor build` (copy into `app/src/idl/` when the program changes) |

## Prerequisites

- Rust, Solana CLI, Anchor CLI
- Node.js (for frontend and tests)

## On-chain program

```bash
anchor build
anchor test
```

Deploy to the cluster configured in `Anchor.toml` (`[provider]`):

```bash
anchor deploy
```

The deployed program id must match `declare_id!` in `programs/minibank/src/lib.rs` and the IDL consumed by the app.

### Module layout (Rust)

- `programs/minibank/src/lib.rs` — program entry and `#[program]` dispatch
- `instructions/` — per-instruction handlers
- `state/` — `#[account]` structs (`MiniAccount`, `UserStats`, `UserYieldPosition`, `YieldVault`)
- `contexts.rs` — `#[derive(Accounts)]` validation contexts (named `contexts` because `#[program]` macro reserves a `accounts` module name at the crate root)
- `error.rs` — `#[error_code]`
- `constants.rs` — seeds and limits

### Yield feature (余额宝-style)

The program now includes two additional instructions:

- `yield_deposit(account_id, amount)`:
  - moves lamports from the selected `MiniAccount` PDA to global `YieldVault` PDA
  - decreases `mini_account.balance`
  - increases user principal in `UserYieldPosition`
- `yield_withdraw(target_account_id)`:
  - accrues interest up to `Clock::unix_timestamp`
  - withdraws the full position back to the selected savings account
  - principal is guaranteed first; yield paid is capped by vault reward liquidity

### Floating APY model

This project uses a **floating APY** instead of a fixed APY.

- Units are in **bps** (basis points):
  - `1 bps = 0.01%`
  - `100 bps = 1%`
  - `10_000 bps = 100%`
- Dynamic APY formula:
  - `APY = clamp(MIN_APY + reward_pool_ratio_bps / APY_RATIO_DIVISOR, MIN_APY, MAX_APY)`
  - `reward_pool_ratio_bps = reward_pool / total_principal * 10_000`
- Current on-chain constants (see `programs/minibank/src/constants.rs`):
  - `MIN_YIELD_APY_BPS = 100` (1.00%)
  - `MAX_YIELD_APY_BPS = 2000` (20.00%)
  - `APY_RATIO_DIVISOR = 2` (reduces sensitivity; APY reacts more smoothly to pool changes)

In plain language: when reward pool grows relative to total principal, APY rises; when reward pool shrinks, APY moves back toward the minimum.

Important accounting rule:

- `YieldVault.total_principal_lamports` tracks the sum of all users' principal.
- Reward pool is computed as:
  - `reward_pool = vault_lamports - rent_exempt - total_principal_lamports`
- This avoids paying one user's yield using another user's principal.

### Funding the reward pool

Yield does **not** appear from nowhere. For users to actually receive interest, someone must add SOL to the global vault beyond principal:

- In UI: use **Fund vault / 注资收益池** in the yield card.
- Or transfer SOL directly to the `YieldVault` PDA address shown in the app.

If reward pool is zero, users will still be able to redeem principal, but paid yield may be zero.

### Quick test flow (recommended)

1. Deposit some SOL from a savings account into yield (`yield_deposit`).
2. Fund vault with extra SOL using **Fund vault / 注资收益池**.
3. Wait 10s+ and refresh UI to see updated estimated APY/yield.
4. Withdraw (`yield_withdraw`) back to a target savings account.
5. Compare:
   - principal always returns first
   - paid yield is limited by current reward pool liquidity

## Frontend (`app/`)

```bash
cd app
npm install
npm run dev
```

### Environment

| Variable | Purpose |
|----------|---------|
| `VITE_SOLANA_RPC` | Optional. If set, used to choose initial RPC cluster (devnet vs localhost). The UI can still switch network in the header. |
| `VITE_LOCAL_KEYPAIR_JSON` | Optional. JSON array of byte values for a local dev keypair. If omitted, `vite.config.ts` can inject `~/.config/solana/id.json` at build time for convenience. |

Copy `app/.env.example` to `app/.env.local` and adjust.

### Connection & signing

- **Connect** opens a menu: browser wallet (Phantom / Solflare) or **local keypair** (same bytes as `id.json` / env).
- **Network** selector: **Devnet** (`https://api.devnet.solana.com`) or **Localhost** (`http://127.0.0.1:8899`). All reads and transactions use the selected RPC; local keypair only affects **who signs**, not which cluster unless you pick Localhost.

### Balance & cluster

- Native SOL balance comes from `connection.getBalance` against the **RPC endpoint** you selected. If you choose **Localhost** but no `solana-test-validator` is listening on `8899`, RPC calls will fail until you start a validator or switch back to Devnet.
- Keep the **program deployed** on the same cluster as the RPC URL; otherwise instructions will fail or point at the wrong program.

### IDL sync

After changing the program, run `anchor build` and copy the generated `target/idl/minibank.json` to `app/src/idl/minibank.json` (or your bundler path) so the client matches the on-chain IDL.

When account layout changes (for example, adding fields to `YieldVault`), make sure existing on-chain accounts are migrated/recreated in your test environment.

## License

ISC (see root `package.json`).
