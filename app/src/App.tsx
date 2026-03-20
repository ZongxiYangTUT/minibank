import React, { useEffect, useMemo, useState } from "react";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import idl from "./idl/minibank.json";

const programId = new PublicKey("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");
const accountSeed = "mini_account";

type MiniAccountData = {
  name: string;
  balance: BN;
};

type ListedAccount = {
  pubkey: string;
  name: string;
  balance: string;
};

function parseSolToLamports(solStr: string): bigint {
  const trimmed = solStr.trim();
  if (!trimmed) return 0n;
  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  const whole = BigInt(wholeRaw || "0");
  const frac = fracRaw.padEnd(9, "0").slice(0, 9);
  return whole * 1_000_000_000n + BigInt(frac || "0");
}

function lamportsToSolStr(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = lamports % 1_000_000_000n;
  const fracStr = frac.toString().padStart(9, "0");
  return `${whole.toString()}.${fracStr}`;
}

export default function App() {
  const endpoint = "http://127.0.0.1:8899";

  const connection = useMemo(() => new Connection(endpoint, "confirmed"), [endpoint]);
  const localKeypairRaw = (import.meta as any).env?.VITE_LOCAL_KEYPAIR_JSON as string | undefined;
  const localKeypair = useMemo(() => {
    if (!localKeypairRaw) return null;
    try {
      const arr = JSON.parse(localKeypairRaw);
      if (!Array.isArray(arr)) return null;
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      return null;
    }
  }, [localKeypairRaw]);
  const walletPublicKey = localKeypair?.publicKey ?? null;
  const [walletSol, setWalletSol] = useState<string>("0.0");

  const [status, setStatus] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");

  const [amountSol, setAmountSol] = useState<string>("0.1");
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>("alice-savings");
  const [createModalError, setCreateModalError] = useState<string>("");
  const [isCreatingAccount, setIsCreatingAccount] = useState<boolean>(false);

  const [balance, setBalance] = useState<MiniAccountData | null>(null);
  const [accountsList, setAccountsList] = useState<ListedAccount[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const pda = useMemo(() => {
    if (!walletPublicKey) return null;
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(accountSeed), walletPublicKey.toBuffer()],
      programId
    )[0];
  }, [walletPublicKey]);

  const program = useMemo(() => {
    if (!walletPublicKey || !localKeypair) return null;

    const walletForAnchor: any = {
      publicKey: walletPublicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(localKeypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach((tx) => tx.partialSign(localKeypair));
        return txs;
      }
    };

    const provider = new AnchorProvider(connection, walletForAnchor, {});
    return new Program(idl as any, provider as any);
  }, [connection, walletPublicKey, localKeypair]);

  async function refreshBalance() {
    setErrorText("");
    if (!program || !pda) return;
    setIsRefreshing(true);
    try {
      const acct = (await (program.account as any).miniAccount.fetch(pda)) as MiniAccountData;
      setBalance(acct);
      setStatus("Balance refreshed");
    } catch (e: any) {
      setBalance(null);
      setStatus("MiniAccount not found (need create_account first)");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshAccountsList() {
    if (!program || !pda) {
      setAccountsList([]);
      return;
    }
    try {
      const acct = (await (program.account as any).miniAccount.fetch(pda)) as MiniAccountData;
      setAccountsList([
        {
          pubkey: pda.toBase58(),
          name: acct.name,
          balance: acct.balance.toString()
        }
      ]);
    } catch (e: any) {
      setAccountsList([]);
    }
  }

  useEffect(() => {
    if (walletPublicKey && program && pda) {
      refreshBalance();
      refreshWalletBalance();
      refreshAccountsList();
    }
    if (!walletPublicKey) {
      setBalance(null);
      setStatus("未配置本地 keypair，请先配置 VITE_LOCAL_KEYPAIR_JSON");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletPublicKey, program, pda]);

  async function refreshWalletBalance() {
    if (!walletPublicKey) return;
    const lamports = await connection.getBalance(walletPublicKey);
    setWalletSol(lamportsToSolStr(BigInt(lamports)));
  }

  async function handleAirdrop() {
    if (!walletPublicKey) return;
    setErrorText("");
    setStatus("Airdrop 1 SOL...");
    try {
      const sig = await connection.requestAirdrop(walletPublicKey, 1_000_000_000);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus("Airdrop confirmed");
      await refreshWalletBalance();
    } catch (e: any) {
      setErrorText(e?.message || "Airdrop failed");
      setStatus("Airdrop failed");
    }
  }

  async function handleCreateAccount(name: string) {
    if (!program || !pda || !walletPublicKey) return;
    setErrorText("");
    setCreateModalError("");
    setStatus("Creating account...");
    setIsCreatingAccount(true);
    try {
      const existed = await (program.account as any).miniAccount.fetchNullable(pda);
      if (existed) {
        setCreateModalError("当前钱包的储蓄账户已存在（同一 PDA 只能创建一次）");
        setStatus("create_account skipped (already exists)");
        return;
      }

      await program.methods
        .createAccount(name)
        .accounts({
          miniAccount: pda,
          payer: walletPublicKey,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setStatus("create_account confirmed");
      await refreshBalance();
      await refreshAccountsList();
      setShowCreateModal(false);
    } catch (e: any) {
      const msg = e?.message || "Create account failed";
      setErrorText(msg);
      setCreateModalError(msg);
      setStatus("create_account failed");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleDeposit() {
    if (!program || !pda || !walletPublicKey) return;
    const lamports = parseSolToLamports(amountSol);
    if (lamports <= 0n) {
      setErrorText("amount must be > 0");
      return;
    }

    setErrorText("");
    setStatus("Depositing...");
    try {
      await program.methods
        .deposit(new BN(lamports.toString()))
        .accounts({
          sender: walletPublicKey,
          miniAccount: pda,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setStatus("deposit confirmed");
      await refreshBalance();
      await refreshAccountsList();
    } catch (e: any) {
      setErrorText(e?.message || "Deposit failed");
      setStatus("deposit failed");
    }
  }

  async function handleWithdraw() {
    if (!program || !pda || !walletPublicKey) return;
    const lamports = parseSolToLamports(amountSol);
    if (lamports <= 0n) {
      setErrorText("amount must be > 0");
      return;
    }

    setErrorText("");
    setStatus("Withdrawing...");
    try {
      await program.methods
        .withdraw(new BN(lamports.toString()))
        .accounts({
          miniAccount: pda,
          recipient: walletPublicKey,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setStatus("withdraw confirmed");
      await refreshBalance();
      await refreshAccountsList();
    } catch (e: any) {
      setErrorText(e?.message || "Withdraw failed");
      setStatus("withdraw failed");
    }
  }

  const walletState = walletPublicKey ? "Connected" : "Disconnected";

  const balanceLamports = balance ? BigInt(balance.balance.toString()) : 0n;
  const balanceSolStr = balance ? lamportsToSolStr(balanceLamports) : "0.0";

  return (
    <div className="container">
      <h1>Minibank</h1>

      <div className="row">
        <button onClick={handleAirdrop} disabled={!walletPublicKey}>
          Airdrop 1 SOL
        </button>
        <button onClick={refreshWalletBalance} disabled={!walletPublicKey}>
          Refresh Wallet Balance
        </button>
        <div className="meta">
          <div>
            Wallet Mode: <b>{walletState}</b> (Local Keypair)
          </div>
          <div>
            Address:{" "}
            <span className="mono">{walletPublicKey ? walletPublicKey.toBase58() : "-"}</span>
          </div>
          <div>
            Wallet SOL: <span className="mono">{walletSol}</span>
          </div>
          <div>
            PDA: <span className="mono">{pda ? pda.toBase58() : "-"}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>账户 & 余额</h2>
        <div className="row">
          <button
            onClick={() => {
              setCreateModalError("");
              setShowCreateModal(true);
            }}
            disabled={!walletPublicKey || !program || !pda}
          >
            create_account
          </button>
          <button onClick={refreshBalance} disabled={!walletPublicKey || !program || !pda || isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={refreshAccountsList} disabled={!walletPublicKey || !program}>
            Refresh Accounts List
          </button>
        </div>

        <div className="balance">
          <div>MiniAccount</div>
          <div className="balanceLine">
            <span className="mono">{balance?.name ?? "-"}</span>
          </div>
          <div className="balanceLine">
            <span>balance:</span>
            <b>{balance ? balance.balance.toString() : "0"}</b>
            <span className="muted">lamports</span>
          </div>
          <div className="balanceLine">
            <b>{balance ? balanceSolStr : "0.0"}</b>
            <span className="muted">SOL</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>储蓄账户列表</h2>
        {accountsList.length === 0 ? (
          <div className="muted">暂无账户（或读取失败）</div>
        ) : (
          <div className="accountList">
            {accountsList.map((acct) => (
              <div key={acct.pubkey} className="accountItem">
                <div className="mono">{acct.pubkey}</div>
                <div>name: {acct.name}</div>
                <div>balance: {acct.balance} lamports</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>存取款</h2>
        <div className="field">
          <label>amount (SOL)</label>
          <input value={amountSol} onChange={(e) => setAmountSol(e.target.value)} placeholder="0.1" />
        </div>

        <div className="row">
          <button onClick={handleDeposit} disabled={!walletPublicKey || !program || !pda}>
            deposit
          </button>
          <button onClick={handleWithdraw} disabled={!walletPublicKey || !program || !pda}>
            withdraw
          </button>
        </div>
      </div>

      <div className="status">
        <div>
          <b>Status:</b> {status}
        </div>
        {errorText ? (
          <div className="error">
            <b>Error:</b> {errorText}
          </div>
        ) : null}
      </div>

      {showCreateModal ? (
        <div className="modalMask" onClick={() => setShowCreateModal(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>创建储蓄账户</h3>
            <div className="field">
              <label>账户名称</label>
              <input
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="alice-savings"
              />
            </div>
            <div className="row">
              <button
                onClick={() => handleCreateAccount(newAccountName.trim())}
                disabled={!newAccountName.trim() || !walletPublicKey || !program || !pda || isCreatingAccount}
              >
                {isCreatingAccount ? "创建中..." : "确认创建"}
              </button>
              <button onClick={() => setShowCreateModal(false)}>取消</button>
            </div>
            {createModalError ? <div className="error">{createModalError}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

