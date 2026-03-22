import React, { useEffect, useMemo, useRef, useState } from "react";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useTranslation } from "react-i18next";

import idl from "./idl/minibank.json";
import { SolanaNetwork, useSolanaNetwork } from "./SolanaWalletProvider";

const programId = new PublicKey("qBgWbfhi9cWqYRDQABUWdtd2NQA69kRVXeJEkpoEM82");
const accountSeed = "mini_account";
const userStatsSeed = "user_stats";

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

type SignerMode = "none" | "browser" | "local";

export default function App() {
  const { t, i18n } = useTranslation();
  const { selectedNetwork, setSelectedNetwork } = useSolanaNetwork();
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions, connected, disconnect } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();

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

  const walletAdapterSigner = useMemo(() => {
    if (!connected || !publicKey || !signTransaction || !signAllTransactions) return null;
    return { publicKey, signTransaction, signAllTransactions };
  }, [connected, publicKey, signTransaction, signAllTransactions]);

  const localSigner = useMemo(() => {
    if (!localKeypair) return null;
    return {
      publicKey: localKeypair.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(localKeypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach((tx) => tx.partialSign(localKeypair));
        return txs;
      }
    };
  }, [localKeypair]);

  const [signerMode, setSignerMode] = useState<SignerMode>("none");

  const browserReady = !!walletAdapterSigner;
  const localReady = !!localSigner;

  /** 连接方式二选一：浏览器钱包或本地密钥 */
  const activeSigner = useMemo(() => {
    if (signerMode === "none") return null;
    if (signerMode === "local") return localSigner;
    return walletAdapterSigner;
  }, [signerMode, localSigner, walletAdapterSigner]);
  const walletPublicKey = activeSigner?.publicKey ?? null;
  const usingLocalSigner = signerMode === "local";

  /** 供 getBalance 使用，避免 useEffect 里调用 refreshWalletBalance 时闭包仍指向旧 publicKey */
  const walletPublicKeyForBalanceRef = useRef<PublicKey | null>(null);
  walletPublicKeyForBalanceRef.current = walletPublicKey;

  const addressMismatch = useMemo(
    () =>
      !!(connected && publicKey && localKeypair && !publicKey.equals(localKeypair.publicKey)),
    [connected, publicKey, localKeypair]
  );

  const [walletSol, setWalletSol] = useState<string>("0.0");
  const [walletSolFetchError, setWalletSolFetchError] = useState<string | null>(null);
  const [showConnectMenu, setShowConnectMenu] = useState(false);

  type StatusTone = "default" | "error";
  const [statusLine, setStatusLine] = useState<{ text: string; tone: StatusTone }>({ text: "", tone: "default" });

  /** 复制地址后延迟恢复状态的定时器，需在其它提示前清掉，否则会盖住错误信息 */
  const copyRestoreTimerRef = useRef<number | null>(null);
  /** 用户操作触发的拉取（会改状态栏/刷新按钮）：与 invalidate 共用，用于丢弃过期请求 */
  const balanceFetchEpochRef = useRef(0);
  /** 仅 useEffect 静默拉取：单独计数，避免与上一条并存时把 interaction 的 epoch 顶掉，导致存/取成功后永远不执行 setAppStatus */
  const silentFetchGenRef = useRef(0);

  function invalidatePendingBalanceFetch() {
    balanceFetchEpochRef.current += 1;
    silentFetchGenRef.current += 1;
    setIsRefreshing(false);
  }

  /** 文案与色调均未变时不 setState，避免「同一条提示」因连续两次 setState 仍触发重渲染而闪烁 */
  function setAppStatus(text: string, tone: StatusTone = "default") {
    if (copyRestoreTimerRef.current) {
      clearTimeout(copyRestoreTimerRef.current);
      copyRestoreTimerRef.current = null;
    }
    setStatusLine((prev) => (prev.text === text && prev.tone === tone ? prev : { text, tone }));
  }

  const [amountByAccountId, setAmountByAccountId] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>("alice-savings");
  const [isCreatingAccount, setIsCreatingAccount] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);

  const [balance, setBalance] = useState<MiniAccountData | null>(null);
  const balanceRef = useRef<MiniAccountData | null>(null);
  balanceRef.current = balance;
  const [accountsList, setAccountsList] = useState<ListedAccount[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [selectedAccountId, setSelectedAccountId] = useState<string>("0");

  /** 仅当按下与点击都发生在遮罩本身时才关闭，避免从输入框拖选文字到遮罩外松开时误关弹窗 */
  const createModalBackdropMouseDownRef = useRef(false);

  function friendlyError(e: any): string {
    const raw = e?.message || "";
    if (raw.includes("AccountNotEmpty") || raw.includes("Account not empty")) return t("deleteNonZero");
    if (raw.includes("Account does not exist") || raw.includes("could not find account")) return t("accountNotFound");
    if (raw.includes("already in use") || raw.includes("already exists")) return t("accountExists");
    if (raw.includes("InsufficientBalance") || raw.includes("Insufficient balance")) {
      return i18n.language === "zh" ? "余额不足" : "Insufficient balance";
    }
    if (raw.includes("InsufficientVaultLamports") || raw.includes("does not have enough lamports")) {
      return i18n.language === "zh" ? "金库 lamports 不足" : "Insufficient vault lamports";
    }
    if (raw.includes("InvalidRecipient") || raw.includes("Recipient must match")) {
      return i18n.language === "zh" ? "收款方必须是账户所有者" : "Recipient must be account owner";
    }
    if (raw.includes("InvalidAccountId") || raw.includes("Account id does not match")) {
      return t("invalidAccountId");
    }
    return raw || t("txFailed");
  }

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

  function getUserStatsPda(pubkey: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(userStatsSeed), pubkey.toBuffer()],
      programId
    )[0];
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
    if (!walletPublicKey || !activeSigner) return null;
    const provider = new AnchorProvider(connection, activeSigner as any, {});
    return new Program(idl as any, provider as any);
  }, [connection, walletPublicKey, activeSigner]);

  /**
   * @param accountIdOverride 若传入，则按该 account_id 拉取余额（避免 setState 异步导致仍用旧的 selectedAccountId）
   * @param opts.updateStatus 为 false 时不改写底部状态文案（用于紧跟在存/取后的 pda effect，避免重复「余额已刷新」）
   * @param opts.showRefreshing 为 false 时不切换「刷新中」按钮状态（避免与主流程重复闪烁）
   */
  async function refreshBalance(
    accountIdOverride?: string,
    opts?: { updateStatus?: boolean; showRefreshing?: boolean }
  ) {
    const updateStatus = opts?.updateStatus !== false;
    const showRefreshing = opts?.showRefreshing !== false;
    const idStr = accountIdOverride ?? selectedAccountId;
    const accountIdBn = parseU64ToBN(idStr);
    if (!program || !walletPublicKey || !accountIdBn) return;
    const pdaFetch = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];
    const isSilent = !updateStatus && !showRefreshing;
    let myInteractionEpoch = 0;
    let mySilentGen = 0;
    if (isSilent) {
      silentFetchGenRef.current += 1;
      mySilentGen = silentFetchGenRef.current;
    } else {
      balanceFetchEpochRef.current += 1;
      myInteractionEpoch = balanceFetchEpochRef.current;
    }
    if (showRefreshing) setIsRefreshing(true);
    try {
      const acct = (await (program.account as any).miniAccount.fetch(pdaFetch)) as MiniAccountData;
      if (isSilent) {
        if (mySilentGen !== silentFetchGenRef.current) return;
      } else if (myInteractionEpoch !== balanceFetchEpochRef.current) return;
      setBalance(acct);
      if (updateStatus) setAppStatus(t("balanceRefreshed"), "default");
    } catch (e: any) {
      if (isSilent) {
        if (mySilentGen !== silentFetchGenRef.current) return;
      } else if (myInteractionEpoch !== balanceFetchEpochRef.current) return;
      setBalance(null);
      if (updateStatus) setAppStatus(t("accountNotFound"), "error");
    } finally {
      if (showRefreshing && myInteractionEpoch === balanceFetchEpochRef.current) setIsRefreshing(false);
    }
  }

  /** 链上 `miniAccount.all()` + 按当前钱包过滤，等价于「该钱包下全部储蓄账户」的 getAll */
  async function fetchAllSavingsAccounts(): Promise<ListedAccount[]> {
    try {
      if (!program || !walletPublicKey) {
        setAccountsList([]);
        return [];
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

      listed.sort((a, b) => Number(a.accountId) - Number(b.accountId));
      setAccountsList(listed);
      return listed;
    } catch (e: any) {
      setAccountsList([]);
      return [];
    }
  }

  useEffect(() => {
    if (walletPublicKey && program) {
      /* 列表只依赖钱包 + Program，不必等当前选中账户的 PDA；一连上即可 getAll 储蓄账户 */
      void fetchAllSavingsAccounts();
      refreshWalletBalance();
      if (pda) {
        /* 仅同步当前选中账户的链上余额，不写底部状态栏 */
        void refreshBalance(undefined, { updateStatus: false, showRefreshing: false });
      }
    }
    if (!walletPublicKey) {
      setBalance(null);
      setAppStatus(t("walletDisconnected"), "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletPublicKey, program, pda]);

  async function refreshWalletBalance() {
    const pk = walletPublicKeyForBalanceRef.current;
    if (!pk) return;
    setWalletSolFetchError(null);
    try {
      const lamports = await connection.getBalance(pk, "confirmed");
      setWalletSol(lamportsToSolStr(BigInt(lamports)));
    } catch (e: unknown) {
      console.error("refreshWalletBalance failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      setWalletSolFetchError(msg.slice(0, 120));
    }
  }

  const walletOwnerBase58 = walletPublicKey?.toBase58() ?? "";

  /** 同一地址在 local / Phantom 间切换时，依赖引用可能不触发主 effect；连接状态或地址变化时强制重拉 SOL */
  useEffect(() => {
    if (!walletOwnerBase58) return;
    void refreshWalletBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, walletOwnerBase58, connection]);

  async function ensureUserStatsInitialized() {
    if (!program || !walletPublicKey || !localKeypair) return;
    const userStatsPda = getUserStatsPda(walletPublicKey);
    const exists = await (program.account as any).userStats.fetchNullable(userStatsPda);
    if (exists) return;
    await program.methods
      .initUserStats()
      .accounts({
        userStats: userStatsPda,
        owner: walletPublicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function handleAirdrop() {
    if (!walletPublicKey) return;
    invalidatePendingBalanceFetch();
    setAppStatus(t("airdrop"), "default");
    try {
      const sig = await connection.requestAirdrop(walletPublicKey, 1_000_000_000);
      await connection.confirmTransaction(sig, "confirmed");
      setAppStatus(t("airdropConfirmed"), "default");
      await refreshWalletBalance();
    } catch (e: any) {
      setAppStatus(`${t("airdropFailed")} — ${friendlyError(e)}`, "error");
    }
  }

  async function handleCreateAccount(name: string) {
    if (!program || !walletPublicKey) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setAppStatus(i18n.language.startsWith("zh") ? "名称不能为空" : "Name cannot be empty", "error");
      return;
    }

    invalidatePendingBalanceFetch();
    setAppStatus(t("statusCreating"), "default");
    setIsCreatingAccount(true);
    try {
      await ensureUserStatsInitialized();
      const userStatsPda = getUserStatsPda(walletPublicKey);
      const stats = await (program.account as any).userStats.fetch(userStatsPda);
      const nextIdBn: BN = stats.nextAccountId;
      const pdaForNew = PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode(accountSeed),
          walletPublicKey.toBuffer(),
          accountIdToLeBytes(nextIdBn)
        ],
        programId
      )[0];

      await program.methods
        .createAccount(trimmed)
        .accounts({
          userStats: userStatsPda,
          miniAccount: pdaForNew,
          payer: walletPublicKey,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      const newIdStr = nextIdBn.toString();
      setSelectedAccountId(newIdStr);
      await refreshBalance(newIdStr);
      await fetchAllSavingsAccounts();
      setShowCreateModal(false);
    } catch (e: any) {
      setAppStatus(friendlyError(e), "error");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function handleDeposit(accountIdStr: string, amountSol: string) {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(accountIdStr);
    if (!accountIdBn) return;
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
      setAppStatus(t("invalidAmount"), "error");
      return;
    }

    invalidatePendingBalanceFetch();
    setAppStatus(t("statusDepositing"), "default");
    try {
      await program.methods
        .deposit(accountIdBn, new BN(lamports.toString()))
        .accounts({
          owner: walletPublicKey,
          miniAccount: pdaForOp,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setSelectedAccountId(accountIdStr);
      await refreshBalance(accountIdStr);
      await fetchAllSavingsAccounts();
    } catch (e: any) {
      setAppStatus(friendlyError(e), "error");
    }
  }

  async function handleWithdraw(accountIdStr: string, amountSol: string) {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(accountIdStr);
    if (!accountIdBn) return;
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
      setAppStatus(t("invalidAmount"), "error");
      return;
    }

    invalidatePendingBalanceFetch();
    setAppStatus(t("statusWithdrawing"), "default");
    try {
      await program.methods
        .withdraw(accountIdBn, new BN(lamports.toString()))
        .accounts({
          miniAccount: pdaForOp,
          owner: walletPublicKey,
          recipient: walletPublicKey
        })
        .rpc();
      setSelectedAccountId(accountIdStr);
      await refreshBalance(accountIdStr);
      await fetchAllSavingsAccounts();
    } catch (e: any) {
      setAppStatus(friendlyError(e), "error");
    }
  }

  async function handleDeleteAccount(accountIdStr?: string) {
    if (!program || !walletPublicKey) return;
    const idStr = accountIdStr ?? selectedAccountId;
    const prevSelected = selectedAccountId;
    const accountIdBn = parseU64ToBN(idStr);
    if (!accountIdBn) {
      setAppStatus(t("invalidAccountId"), "error");
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

    invalidatePendingBalanceFetch();
    setAppStatus(t("deletingAccount"), "default");
    setIsDeletingAccount(true);
    try {
      await program.methods
        .deleteAccount(accountIdBn)
        .accounts({
          miniAccount: pdaForDelete,
          owner: walletPublicKey,
          recipient: walletPublicKey
        })
        .rpc();

      const listed = await fetchAllSavingsAccounts();
      await refreshWalletBalance();

      if (listed.length === 0) {
        setSelectedAccountId("0");
        setBalance(null);
        setAppStatus(t("accountNotFound"), "error");
      } else if (idStr === prevSelected) {
        const nextId = listed[0].accountId;
        setSelectedAccountId(nextId);
        await refreshBalance(nextId);
      } else {
        setAppStatus(t("accountClosed"), "default");
      }
    } catch (e: any) {
      const raw = e?.message || "Delete account failed";
      const friendly =
        raw.includes("AccountNotEmpty") || raw.includes("Account not empty") ? t("deleteNonZero") : raw;
      setAppStatus(friendly, "error");
    } finally {
      setIsDeletingAccount(false);
    }
  }

  /** 状态徽标按当前连接方式显示：浏览器钱包或本地密钥 */
  const walletState = usingLocalSigner
    ? localReady
      ? t("walletLocalDev")
      : ""
    : browserReady
      ? t("connected")
      : "";

  const balanceLamports = balance ? BigInt(balance.balance.toString()) : 0n;
  const balanceSolStr = balance ? lamportsToSolStr(balanceLamports) : "0.0";

  function truncateAddress(addr: string, chars = 4): string {
    if (!addr || addr.length <= chars * 2 + 3) return addr;
    return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setAppStatus(t("copied"), "default");
      copyRestoreTimerRef.current = window.setTimeout(() => {
        copyRestoreTimerRef.current = null;
        setAppStatus(balanceRef.current ? t("balanceRefreshed") : t("statusIdle"), "default");
      }, 1500);
    } catch {
      setAppStatus(t("copyFailed"), "error");
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

  async function handleDisconnectCurrentMode() {
    if (signerMode === "none") return;
    if (signerMode === "browser" && connected) {
      await disconnect();
    }
    setSignerMode("none");
    setAppStatus(t("walletDisconnected"), "error");
  }

  function handleConnectWithMode(mode: Exclude<SignerMode, "none">) {
    setSignerMode(mode);
    setShowConnectMenu(false);
    if (mode === "browser") setWalletModalVisible(true);
  }

  const canUseApp = signerMode !== "none" && !!activeSigner && !!walletPublicKey && !!program;

  return (
    <div className="container">
      <div className="lang-corner">
        <label className="lang-select-wrap">
          <span>{t("langLabel")}</span>
          <select
            className="lang-select"
            value={i18n.language.startsWith("zh") ? "zh" : "en"}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            <option value="zh">{t("langZh")}</option>
            <option value="en">{t("langEn")}</option>
          </select>
        </label>
      </div>

      <header className="app-header">
        <h1 className="app-logo">{t("title")}</h1>
        <div className="header-actions">
          <div className="wallet-info">
            <div className="wallet-toolbar">
              <div className="connect-entry">
                <button
                  className="connect-btn"
                  onClick={() => setShowConnectMenu((v) => !v)}
                  type="button"
                >
                  {t("connect")}
                </button>
                {showConnectMenu ? (
                  <div className="connect-menu">
                    <button type="button" onClick={() => handleConnectWithMode("browser")}>
                      {t("signerBrowserWallet")}
                    </button>
                    <button type="button" onClick={() => handleConnectWithMode("local")}>
                      {t("walletLocalDev")}
                    </button>
                  </div>
                ) : null}
              </div>
              <label className="toolbar-select-wrap">
                <span>{t("network")}</span>
                <select
                  className="toolbar-select"
                  value={selectedNetwork}
                  onChange={(e) => setSelectedNetwork(e.target.value as SolanaNetwork)}
                >
                  <option value="devnet">Devnet</option>
                  <option value="localhost">Localhost</option>
                </select>
              </label>
            </div>
            {walletPublicKey ? (
              <>
                <div className="wallet-summary-strip">
                  {walletState ? (
                    <span
                      className={`wallet-badge ${usingLocalSigner ? "wallet-badge--local" : ""}`}
                    >
                      {walletState}
                    </span>
                  ) : null}
                  <div className="address-box address-box--wallet">
                    <span
                      className="mono wallet-pubkey-line"
                      title={walletPublicKey.toBase58()}
                    >
                      {truncateAddress(walletPublicKey.toBase58(), 6)}
                    </span>
                    <button
                      className="copy-btn"
                      onClick={() => copyToClipboard(walletPublicKey.toBase58())}
                      title={t("copyAddressTitle")}
                    >
                      <CopyIcon />
                    </button>
                  </div>
                  <div className="sol-balance">
                    <SolIcon />
                    <span>{walletSol} SOL</span>
                  </div>
                </div>
                {walletSolFetchError ? (
                  <p className="wallet-sol-fetch-error">{t("walletSolFetchError", { message: walletSolFetchError })}</p>
                ) : null}
                {addressMismatch && usingLocalSigner ? (
                  <p className="wallet-address-mismatch">
                    {t("addressMismatchHint", {
                      phantom: publicKey?.toBase58() ?? "",
                      local: localKeypair?.publicKey.toBase58() ?? ""
                    })}
                  </p>
                ) : null}
              </>
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                {signerMode === "local" && !localKeypair
                  ? t("localKeypairMissing")
                  : signerMode === "browser"
                    ? t("walletDisconnected")
                    : t("notConfigured")}
              </span>
            )}
          </div>
          <div className="row">
            <button className="primary" onClick={handleAirdrop} disabled={!canUseApp}>
              {t("airdrop")}
            </button>
            <button onClick={refreshWalletBalance} disabled={!canUseApp}>
              {t("refresh")}
            </button>
            <button onClick={() => void handleDisconnectCurrentMode()} disabled={signerMode === "none"}>
              {t("disconnectWallet")}
            </button>
          </div>
        </div>
      </header>

      {walletPublicKey && (
        <div className="meta-compact" style={{ marginBottom: 8, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          {t("viewingHint")}: <strong>{balance?.name ?? "—"}</strong>
        </div>
      )}

      <div className="card">
        <h2>{t("accountAndBalance")}</h2>
        <div className="row">
          <button
            className="primary"
            onClick={() => setShowCreateModal(true)}
            disabled={!canUseApp}
          >
            {t("createAccount")}
          </button>
          <button
            onClick={() => void refreshBalance()}
            disabled={!canUseApp || !pda || isRefreshing}
          >
            {isRefreshing ? "..." : t("refreshBalance")}
          </button>
          <button onClick={() => void fetchAllSavingsAccounts()} disabled={!canUseApp}>
            {t("refreshList")}
          </button>
        </div>

        <div className="balance">
          <div style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
            {t("selectedAccountLabel")} · <strong>{balance?.name ?? "—"}</strong>
          </div>
          <div className="balanceLine" style={{ marginTop: 12 }}>
            <span className="balance-hero">{balance ? balanceSolStr : "0.0"}</span>
            <span className="muted">SOL</span>
          </div>
          <div className="balanceLine">
            <span className="muted">
              {t("balanceLamports")}: {balance ? balance.balance.toString() : "0"}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{t("accountList")}</h2>
        {accountsList.length === 0 ? (
          <div className="muted">{t("emptyList")}</div>
        ) : (
          <div className="accountList">
            {accountsList.map((acct) => (
              <div
                key={acct.pubkey}
                className={`accountItem ${acct.accountId === selectedAccountId ? "selected" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedAccountId(acct.accountId)}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{acct.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: "0.9rem" }}>
                  <span className="muted">{t("onChainAddress")}</span>
                  <span className="mono">{truncateAddress(acct.pubkey)}</span>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(acct.pubkey);
                    }}
                    title={t("copyAddressTitle")}
                  >
                    <CopyIcon />
                  </button>
                </div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  {t("balanceLamports")}: {acct.balance}
                </div>
                <div className="field">
                  <label>{t("amountSol")}</label>
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
                    disabled={!canUseApp}
                  >
                    {t("deposit")}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleWithdraw(acct.accountId, amountByAccountId[acct.accountId] ?? "0.1");
                    }}
                    disabled={!canUseApp}
                  >
                    {t("withdraw")}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAccount(acct.accountId);
                    }}
                    disabled={!canUseApp || isDeletingAccount}
                  >
                    {t("closeAccount")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`status ${statusLine.tone === "error" ? "status--error" : ""}`}>
        <div className="status-line">
          <b>{t("status")}:</b> {statusLine.text || "\u00a0"}
        </div>
      </div>

      {showCreateModal ? (
        <div
          className="modalMask"
          onMouseDown={(e) => {
            createModalBackdropMouseDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (createModalBackdropMouseDownRef.current) {
              setShowCreateModal(false);
            }
            createModalBackdropMouseDownRef.current = false;
          }}
        >
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h3>{t("createModalTitle")}</h3>
            <div className="field">
              <label>{t("accountName")}</label>
              <input
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="alice-savings"
              />
            </div>
            <div className="row">
              <button
                onClick={() => handleCreateAccount(newAccountName.trim())}
                disabled={
                  !newAccountName.trim() ||
                  !canUseApp ||
                  isCreatingAccount
                }
              >
                {isCreatingAccount ? t("creating") : t("confirmCreate")}
              </button>
              <button onClick={() => setShowCreateModal(false)}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

