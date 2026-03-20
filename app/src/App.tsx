import React, { useEffect, useMemo, useState } from "react";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import idl from "./idl/minibank.json";

const programId = new PublicKey("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");
const accountSeed = "mini_account";

type MiniAccountData = {
  name: string;
  balance: BN;
  accountId?: BN;
};

type ListedAccount = {
  pubkey: string;
  accountId: string;
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

  const [amountByAccountId, setAmountByAccountId] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>("alice-savings");
  const [newAccountId, setNewAccountId] = useState<string>("1");
  const [createModalError, setCreateModalError] = useState<string>("");
  const [isCreatingAccount, setIsCreatingAccount] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const [balance, setBalance] = useState<MiniAccountData | null>(null);
  const [accountsList, setAccountsList] = useState<ListedAccount[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [selectedAccountId, setSelectedAccountId] = useState<string>("1");

  function parseU64ToBN(s: string): BN | null {
    const trimmed = s.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    return new BN(trimmed);
  }

  const selectedAccountIdBn = useMemo(() => parseU64ToBN(selectedAccountId), [selectedAccountId]);

  function accountIdToLeBytes(accountIdBn: BN): Uint8Array {
    return accountIdBn.toArrayLike(Buffer, "le", 8);
  }

  const pda = useMemo(() => {
    if (!walletPublicKey || !selectedAccountIdBn) return null;
    return PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(selectedAccountIdBn)
      ],
      programId
    )[0];
  }, [walletPublicKey, selectedAccountIdBn]);

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
    try {
      if (!program || !walletPublicKey) {
        setAccountsList([]);
        return;
      }

      const allAccounts = await (program.account as any).miniAccount.all();
      const listed: ListedAccount[] = [];

      for (const item of allAccounts) {
        const acct = item.account as any;
        const accountIdRaw = acct.accountId ?? acct.account_id;
        if (accountIdRaw === undefined || accountIdRaw === null) continue;

        const accountIdStr = accountIdRaw.toString();
        const accountIdBn = new BN(accountIdStr);
        const expectedPda = PublicKey.findProgramAddressSync(
          [
            new TextEncoder().encode(accountSeed),
            walletPublicKey.toBuffer(),
            accountIdToLeBytes(accountIdBn)
          ],
          programId
        )[0];

        if (!item.publicKey.equals(expectedPda)) continue;

        listed.push({
          pubkey: item.publicKey.toBase58(),
          accountId: accountIdStr,
          name: acct.name,
          balance: acct.balance.toString()
        });
      }

      // 简单排序：按 account_id 升序展示
      listed.sort((a, b) => Number(a.accountId) - Number(b.accountId));
      setAccountsList(listed);
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

  async function handleCreateAccount(name: string, accountIdStr: string) {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(accountIdStr);
    if (!accountIdBn || accountIdBn.lte(new BN(0))) {
      setCreateModalError("account_id 必须是大于等于 1 的整数");
      return;
    }

    const pdaForNew = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];

    setErrorText("");
    setCreateModalError("");
    setStatus("Creating account...");
    setIsCreatingAccount(true);
    try {
      const existed = await (program.account as any).miniAccount.fetchNullable(pdaForNew);
      if (existed) {
        setCreateModalError("当前钱包的储蓄账户已存在（同一 PDA 只能创建一次）");
        setStatus("create_account skipped (already exists)");
        return;
      }

      await program.methods
        .createAccount(accountIdBn, name)
        .accounts({
          miniAccount: pdaForNew,
          payer: walletPublicKey,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setStatus("create_account confirmed");
      setSelectedAccountId(accountIdStr);
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

  async function handleDeposit(accountIdStr: string, amountSol: string) {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(accountIdStr);
    if (!accountIdBn || accountIdBn.lte(new BN(0))) return;
    const pdaForOp = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];
    const lamports = parseSolToLamports(amountSol);
    if (lamports <= 0n) {
      setErrorText("amount must be > 0");
      return;
    }

    setErrorText("");
    setStatus("Depositing...");
    try {
      await program.methods
        .deposit(accountIdBn, new BN(lamports.toString()))
        .accounts({
          sender: walletPublicKey,
          miniAccount: pdaForOp,
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

  async function handleWithdraw(accountIdStr: string, amountSol: string) {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(accountIdStr);
    if (!accountIdBn || accountIdBn.lte(new BN(0))) return;
    const pdaForOp = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];
    const lamports = parseSolToLamports(amountSol);
    if (lamports <= 0n) {
      setErrorText("amount must be > 0");
      return;
    }

    setErrorText("");
    setStatus("Withdrawing...");
    try {
      await program.methods
        .withdraw(accountIdBn, new BN(lamports.toString()))
        .accounts({
          miniAccount: pdaForOp,
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

  async function handleDeleteAccount(accountIdStr?: string) {
    if (!program || !walletPublicKey) return;
    const idStr = accountIdStr ?? selectedAccountId;
    const accountIdBn = parseU64ToBN(idStr);
    if (!accountIdBn || accountIdBn.lte(new BN(0))) {
      setErrorText("account_id 非法");
      return;
    }

    const pdaForDelete = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];

    setErrorText("");
    setDeleteError("");
    setStatus(`Deleting account ${idStr}...`);
    setIsDeletingAccount(true);
    try {
      await program.methods
        .deleteAccount(accountIdBn)
        .accounts({
          miniAccount: pdaForDelete,
          recipient: walletPublicKey,
          systemProgram: SystemProgram.programId
        })
        .rpc();

      setStatus(`delete_account confirmed (account_id=${idStr})`);
      await refreshAccountsList();
      await refreshWalletBalance();

      if (idStr === selectedAccountId) {
        setBalance(null);
      }
    } catch (e: any) {
      const raw = e?.message || "Delete account failed";
      const friendly =
        raw.includes("AccountNotEmpty") || raw.includes("Account not empty")
          ? "关闭失败：账户余额不为 0，请先把该账户提到 0 再关闭"
          : raw;
      setErrorText(friendly);
      setDeleteError(friendly);
      setStatus("delete_account failed");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  const walletState = walletPublicKey ? "Connected" : "Disconnected";

  const balanceLamports = balance ? BigInt(balance.balance.toString()) : 0n;
  const balanceSolStr = balance ? lamportsToSolStr(balanceLamports) : "0.0";

  function truncateAddress(addr: string, chars = 4): string {
    if (!addr || addr.length <= chars * 2 + 3) return addr;
    return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制到剪贴板");
      setTimeout(() => setStatus(""), 1500);
    } catch {
      setStatus("复制失败");
    }
  }

  const SolIcon = () => (
    <svg className="sol-icon" viewBox="0 0 397 311" fill="none">
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 9.2 6.5 6.1 11.2l-62.7 92.1c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-9.2-6.5-6.1-11.2l64.2-92.1z" fill="url(#sol-grad)" />
      <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 9.2 6.5 6.1 11.2l-62.7 92.1c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-9.2-6.5-6.1-11.2L64.6 3.8z" fill="url(#sol-grad)" />
      <path d="M332.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H5.5c-5.8 0-9.2 6.5-6.1 11.2l62.7 92.1c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 9.2-6.5 6.1-11.2l-62.7-92.1z" fill="url(#sol-grad)" />
      <defs>
        <linearGradient id="sol-grad" x1="0" y1="0" x2="1" y2="1" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
    </svg>
  );

  const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );

  return (
    <div className="container">
      <header className="app-header">
        <h1 className="app-logo">Minibank</h1>
        <div className="header-actions">
          <div className="wallet-info">
            {walletPublicKey ? (
              <>
                <span className="wallet-badge">{walletState}</span>
                <div className="address-box">
                  <span className="mono">{truncateAddress(walletPublicKey.toBase58())}</span>
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(walletPublicKey.toBase58())}
                    title="复制地址"
                  >
                    <CopyIcon />
                  </button>
                </div>
                <div className="sol-balance">
                  <SolIcon />
                  <span>{walletSol} SOL</span>
                </div>
              </>
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                未配置钱包 (VITE_LOCAL_KEYPAIR_JSON)
              </span>
            )}
          </div>
          <div className="row">
            <button className="primary" onClick={handleAirdrop} disabled={!walletPublicKey}>
              Airdrop 1 SOL
            </button>
            <button onClick={refreshWalletBalance} disabled={!walletPublicKey}>
              Refresh
            </button>
          </div>
        </div>
      </header>

      {walletPublicKey && (
        <div className="meta-compact" style={{ marginBottom: 8 }}>
          <span>account_id: <span>{selectedAccountId}</span></span>
          <span>PDA: <span className="mono">{pda ? truncateAddress(pda.toBase58()) : "-"}</span></span>
        </div>
      )}

      <div className="card">
        <h2>账户 & 余额</h2>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              setCreateModalError("");
              setShowCreateModal(true);
            }}
            disabled={!walletPublicKey || !program}
          >
            创建账户
          </button>
          <button onClick={refreshBalance} disabled={!walletPublicKey || !program || !pda || isRefreshing}>
            {isRefreshing ? "刷新中..." : "刷新余额"}
          </button>
          <button onClick={refreshAccountsList} disabled={!walletPublicKey || !program}>
            刷新列表
          </button>
        </div>

        <div className="balance">
          <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>MiniAccount · {balance?.name ?? "-"}</div>
          <div className="balanceLine" style={{ marginTop: 12 }}>
            <span className="balance-hero">{balance ? balanceSolStr : "0.0"}</span>
            <span className="muted">SOL</span>
          </div>
          <div className="balanceLine">
            <span className="muted">{balance ? balance.balance.toString() : "0"} lamports</span>
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
              <div
                key={acct.pubkey}
                className={`accountItem ${acct.accountId === selectedAccountId ? "selected" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelectedAccountId(acct.accountId);
                  refreshBalance();
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="mono">{truncateAddress(acct.pubkey)}</span>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(acct.pubkey);
                    }}
                    title="复制 PDA"
                  >
                    <CopyIcon />
                  </button>
                </div>
                <div>account_id: {acct.accountId}</div>
                <div>name: {acct.name}</div>
                <div>balance: {acct.balance} lamports</div>
                <div className="field">
                  <label>amount (SOL)</label>
                  <input
                    value={amountByAccountId[acct.accountId] ?? "0.1"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAmountByAccountId((prev) => ({ ...prev, [acct.accountId]: value }));
                    }}
                    placeholder="0.1"
                  />
                </div>
                <div className="row">
                  <button
                    className="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeposit(acct.accountId, amountByAccountId[acct.accountId] ?? "0.1");
                    }}
                  >
                    存入
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleWithdraw(acct.accountId, amountByAccountId[acct.accountId] ?? "0.1");
                    }}
                  >
                    取出
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAccount(acct.accountId);
                    }}
                    disabled={isDeletingAccount}
                  >
                    关闭账户
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {deleteError ? <div className="error">{deleteError}</div> : null}
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
            <div className="field">
              <label>account_id (u64)</label>
              <input
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="row">
              <button
                onClick={() => handleCreateAccount(newAccountName.trim(), newAccountId.trim())}
                disabled={
                  !newAccountName.trim() ||
                  !newAccountId.trim() ||
                  !walletPublicKey ||
                  !program ||
                  isCreatingAccount
                }
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

