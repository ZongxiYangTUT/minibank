import React, { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import "@solana/wallet-adapter-react-ui/styles.css";

/** 默认公网 Devnet（非 localhost）。可改 VITE_SOLANA_RPC 为 Testnet：https://api.testnet.solana.com */
export const SOLANA_RPC_ENDPOINT =
  (import.meta as any).env?.VITE_SOLANA_RPC ?? "https://api.devnet.solana.com";

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  /* wallet-adapter 与 React 18 类型在部分版本下 FC 签名不兼容 */
  const Conn = ConnectionProvider as React.ComponentType<{
    endpoint: string;
    children?: React.ReactNode;
  }>;
  const Wall = WalletProvider as React.ComponentType<{
    wallets: unknown[];
    autoConnect?: boolean;
    children?: React.ReactNode;
  }>;
  const WallMod = WalletModalProvider as React.ComponentType<{ children?: React.ReactNode }>;

  return (
    <Conn endpoint={SOLANA_RPC_ENDPOINT}>
      <Wall wallets={wallets} autoConnect>
        <WallMod>{children}</WallMod>
      </Wall>
    </Conn>
  );
}
