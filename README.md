# minibank

Solana / Anchor 学习项目。

## 前端 RPC（浏览器）

- 默认使用 **Devnet**：`https://api.devnet.solana.com`（**不使用 localhost**）。
- **Phantom 选 Testnet、页面仍用 Devnet 时，头部 SOL 余额会显示 0**（两条链上同一地址余额无关）。在 `app/.env` 设 `VITE_SOLANA_RPC=https://api.testnet.solana.com` 并重启，与钱包一致即可。
- 同一 **Devnet** 下，用 Alchemy / Helius / `api.devnet.solana.com` 等**任意 Devnet RPC** 都是同一套链上状态，只是接入点不同；与「Devnet vs Testnet 混用」不是一回事。
- 若要用官方 **Testnet** 集群：在 `app/.env` 里设置  
  `VITE_SOLANA_RPC=https://api.testnet.solana.com`，并在 Phantom 里切到同一网络。
- 本地 `solana-test-validator` 仅在你显式把 `VITE_SOLANA_RPC` 指到 `http://127.0.0.1:8899` 时使用。

链上程序需部署在与 RPC 相同的集群；`app/src/idl/minibank.json` 里的 program id 需与该集群上一致。
