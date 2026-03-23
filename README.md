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

### Yield feature (share-based vault)

Stage-1 protocol now uses a **share model** (instead of per-user accrued interest fields):

- `yield_deposit(account_id, amount)` mints user shares using:
  - `minted_shares = amount * total_shares / total_assets` (or `amount` when pool is empty)
- `yield_withdraw(target_account_id, amount)` burns shares based on requested assets
- User account stores `shares` only; value is derived by:
  - `user_assets = user_shares * total_assets / total_shares`

`YieldVault` tracks:

- `total_assets` (pool assets)
- `total_shares`
- `total_borrowed`
- `last_accrual_ts`

This means share count stays constant while per-share value can grow.

### Borrow/repay + utilization rate model

The pool includes borrow-side accounting:

- `borrow(target_account_id, amount)`
- `repay(source_account_id, amount)`

Interest is accrued globally before state-changing ops (`deposit/withdraw/borrow/repay`):

- `utilization = total_borrowed / total_assets`
- piecewise borrow rate (`base + slope1/slope2` with kink)
- accrued interest increases both:
  - `total_borrowed` (liability side)
  - `total_assets` (supplier side yield source)

This implements automatic compounding at pool level.

### Funding the reward pool

Yield does **not** appear from nowhere. For users to actually receive interest, someone must add SOL to the global vault beyond principal:

- In UI: use **Fund vault / 注资收益池** in the yield card.
- Or transfer SOL directly to the `YieldVault` PDA address shown in the app.

If reward pool is zero, users will still be able to redeem principal, but paid yield may be zero.

### Quick test flow (recommended)

1. Deposit some SOL from a savings account into yield (`yield_deposit`).
2. Deposit from another user and verify share ratio.
3. Borrow from the vault, wait a few seconds, then repay.
4. Observe `total_assets/total_shares` and user-estimated assets.
5. Withdraw (`yield_withdraw`) and verify burn-shares behavior.

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
