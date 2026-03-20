import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer/";

import App from "./App";
import "./styles.css";

// Anchor/web3 in browser runtime needs global Buffer.
(globalThis as any).Buffer = Buffer;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

