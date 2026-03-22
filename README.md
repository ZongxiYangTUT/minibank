# Minibank

A minimal **Solana + Anchor** demo: per-user savings accounts (`MiniAccount` PDAs), deposits, withdrawals, and account close. Includes a **React + Vite** UI with wallet or local keypair signing.

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
- `state/` — `#[account]` structs (`MiniAccount`, `UserStats`)
- `contexts.rs` — `#[derive(Accounts)]` validation contexts (named `contexts` because `#[program]` macro reserves a `accounts` module name at the crate root)
- `error.rs` — `#[error_code]`
- `constants.rs` — seeds and limits

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

## License

ISC (see root `package.json`).
