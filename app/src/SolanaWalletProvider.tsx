import React, { ReactNode, createContext, useContext, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import "@solana/wallet-adapter-react-ui/styles.css";

export type SolanaNetwork = "devnet" | "localhost";

const NETWORK_ENDPOINTS: Record<SolanaNetwork, string> = {
  devnet: "https://api.devnet.solana.com",
  localhost: "http://127.0.0.1:8899"
};

function normalizeNetworkFromEndpoint(endpoint: string): SolanaNetwork {
  const v = endpoint.toLowerCase();
  if (v.includes("127.0.0.1") || v.includes("localhost")) return "localhost";
  return "devnet";
}

const endpointFromEnv = ((import.meta as any).env?.VITE_SOLANA_RPC as string | undefined)?.trim();
const initialNetwork = endpointFromEnv
  ? normalizeNetworkFromEndpoint(endpointFromEnv)
  : "localhost";

type SolanaNetworkContextValue = {
  selectedNetwork: SolanaNetwork;
  setSelectedNetwork: (v: SolanaNetwork) => void;
  rpcEndpoint: string;
};

const SolanaNetworkContext = createContext<SolanaNetworkContextValue | null>(null);

export function useSolanaNetwork() {
  const ctx = useContext(SolanaNetworkContext);
  if (!ctx) throw new Error("useSolanaNetwork must be used inside SolanaWalletProvider");
  return ctx;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [selectedNetwork, setSelectedNetwork] = useState<SolanaNetwork>(initialNetwork);
  const rpcEndpoint = NETWORK_ENDPOINTS[selectedNetwork];
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  /* wallet-adapter vs React 18: FC typings sometimes disagree; cast below. */
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
    <SolanaNetworkContext.Provider value={{ selectedNetwork, setSelectedNetwork, rpcEndpoint }}>
      <Conn endpoint={rpcEndpoint}>
        <Wall wallets={wallets} autoConnect>
          <WallMod>{children}</WallMod>
        </Wall>
      </Conn>
    </SolanaNetworkContext.Provider>
  );
}
