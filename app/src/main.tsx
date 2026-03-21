import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer/";

import App from "./App";
import { SolanaWalletProvider } from "./SolanaWalletProvider";
import "./i18n";
import "./styles.css";

// Anchor/web3 in browser runtime needs global Buffer.
(globalThis as any).Buffer = Buffer;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SolanaWalletProvider>
      <App />
    </SolanaWalletProvider>
  </React.StrictMode>
);

