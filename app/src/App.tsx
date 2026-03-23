import React, { useEffect, useMemo, useRef, useState } from "react";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useTranslation } from "react-i18next";

import idl from "./idl/minibank.json";
import { SolanaNetwork, useSolanaNetwork } from "./SolanaWalletProvider";

const programId = new PublicKey("9Sa5rGRUsm8SikPFcDYSCEAHLch1xdqSvK6A8xbhb6nr");
const accountSeed = "mini_account";
const userStatsSeed = "user_stats";
const yieldVaultSeed = "yield_vault";
const userYieldSeed = "user_yield";
/** Must match on-chain floating APY constants in `constants.rs`. */
const MIN_YIELD_APY_BPS = 100;
const MAX_YIELD_APY_BPS = 2000;
const APY_RATIO_DIVISOR = 2;
const SECONDS_PER_YEAR = 31_536_000;

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

type UserYieldPositionData = {
  principalLamports: bigint;
  accruedYieldLamports: bigint;
  lastYieldTs: number;
};

/** Simple-interest pending accrual since `lastYieldTs` (matches on-chain `accrue_yield`). */
function estimateYieldTotalLamports(
  principal: bigint,
  accrued: bigint,
  lastYieldTs: number,
  nowSec: number,
  currentApyBps: number
): bigint {
  let pending = 0n;
  if (lastYieldTs > 0 && principal > 0n) {
    const elapsed = Math.max(0, Math.floor(nowSec - lastYieldTs));
    pending = (principal * BigInt(currentApyBps) * BigInt(elapsed)) / (10000n * BigInt(SECONDS_PER_YEAR));
  }
  return principal + accrued + pending;
}

function dynamicApyBpsFromPool(rewardPoolLamports: bigint, totalPrincipalLamports: bigint): number {
  if (totalPrincipalLamports <= 0n) return MIN_YIELD_APY_BPS;
  const ratioBps = Number((rewardPoolLamports * 10_000n) / totalPrincipalLamports);
  const dynamic = MIN_YIELD_APY_BPS + Math.floor(ratioBps / APY_RATIO_DIVISOR);
  return Math.max(MIN_YIELD_APY_BPS, Math.min(MAX_YIELD_APY_BPS, dynamic));
}

function getYieldVaultPda(): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode(yieldVaultSeed)], programId)[0];
}

function getUserYieldPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(userYieldSeed), owner.toBuffer()],
    programId
  )[0];
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

  /** Signer source: browser wallet or local keypair (mutually exclusive by mode). */
  const activeSigner = useMemo(() => {
    if (signerMode === "none") return null;
    if (signerMode === "local") return localSigner;
    return walletAdapterSigner;
  }, [signerMode, localSigner, walletAdapterSigner]);
  const walletPublicKey = activeSigner?.publicKey ?? null;
  const usingLocalSigner = signerMode === "local";

  /** Latest pubkey for getBalance; avoids stale closure when effects call refreshWalletBalance. */
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

  /** Timer to restore status after copy; cleared before other toasts so errors stay visible. */
  const copyRestoreTimerRef = useRef<number | null>(null);
  /** Epoch for user-driven balance fetches; paired with invalidatePendingBalanceFetch to drop stale responses. */
  const balanceFetchEpochRef = useRef(0);
  /** Epoch for silent effect-only fetches so they do not clobber interaction epoch after deposit/withdraw. */
  const silentFetchGenRef = useRef(0);

  function invalidatePendingBalanceFetch() {
    balanceFetchEpochRef.current += 1;
    silentFetchGenRef.current += 1;
    setIsRefreshing(false);
  }

  /** Skip setState when text and tone unchanged to avoid flicker from identical consecutive updates. */
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

  const [yieldDepositAmount, setYieldDepositAmount] = useState<string>("0.1");
  const [yieldFundAmount, setYieldFundAmount] = useState<string>("0.1");
  const [yieldSourceAccountId, setYieldSourceAccountId] = useState<string>("0");
  const [yieldDestAccountId, setYieldDestAccountId] = useState<string>("0");
  const [userYieldPosition, setUserYieldPosition] = useState<UserYieldPositionData | null>(null);
  const [yieldVaultSummary, setYieldVaultSummary] = useState<{
    totalPrincipalLamports: bigint;
    rewardPoolLamports: bigint;
  } | null>(null);
  /** Bumps every 10s so estimated yield re-renders without polling chain. */
  const [yieldUiTick, setYieldUiTick] = useState(0);

  /** Close create modal only when mousedown and mouseup both target the backdrop (not drag-select from inputs). */
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
    if (raw.includes("NoYieldPosition") || raw.includes("No 余额宝")) {
      return i18n.language === "zh" ? "暂无余额宝持仓" : "No yield position";
    }
    if (raw.includes("YieldVaultInsufficient") || raw.includes("Yield vault does not have enough")) {
      return i18n.language === "zh" ? "收益池 SOL 不足，请先向 Vault 地址转入" : "Yield vault has insufficient SOL; fund the vault";
    }
    if (raw.includes("YieldVaultAccountingMismatch") || raw.includes("total_principal")) {
      return i18n.language === "zh"
        ? "Vault 账目异常（需重新部署或重置链上 YieldVault 账户）"
        : "Yield vault accounting mismatch (reset/redeploy may be required)";
    }
    if (raw.includes("insufficient funds")) {
      return i18n.language === "zh" ? "钱包余额不足（含手续费）" : "Insufficient wallet SOL (including fee)";
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
   * @param accountIdOverride When set, fetch balance for this account id (avoids stale selectedAccountId after setState).
   * @param opts.updateStatus If false, do not write the bottom status line (e.g. after deposit/withdraw + PDA effect).
   * @param opts.showRefreshing If false, do not toggle the refreshing button state.
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

  /** On-chain `miniAccount.all()` filtered by current wallet PDAs — getAll savings accounts for this owner. */
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

  async function fetchYieldVaultSummary() {
    if (!program) {
      setYieldVaultSummary(null);
      return;
    }
    const vaultPk = getYieldVaultPda();
    try {
      const v = await (program.account as any).yieldVault.fetchNullable(vaultPk);
      if (!v) {
        setYieldVaultSummary(null);
        return;
      }
      const totalP = BigInt((v.totalPrincipalLamports ?? v.total_principal_lamports).toString());
      const info = await connection.getAccountInfo(vaultPk, "confirmed");
      const dataLen = info?.data.length ?? 17;
      const minRent = BigInt(await connection.getMinimumBalanceForRentExemption(dataLen, "confirmed"));
      const lamports = BigInt(await connection.getBalance(vaultPk, "confirmed"));
      const available = lamports > minRent ? lamports - minRent : 0n;
      const rewardPool = available > totalP ? available - totalP : 0n;
      setYieldVaultSummary({ totalPrincipalLamports: totalP, rewardPoolLamports: rewardPool });
    } catch {
      setYieldVaultSummary(null);
    }
  }

  async function fetchUserYield() {
    if (!program || !walletPublicKey) {
      setUserYieldPosition(null);
      return;
    }
    const pda = getUserYieldPda(walletPublicKey);
    try {
      const y = await (program.account as any).userYieldPosition.fetchNullable(pda);
      if (!y) {
        setUserYieldPosition(null);
        return;
      }
      const pr = y.principalLamports ?? y.principal_lamports;
      const ac = y.accruedYieldLamports ?? y.accrued_yield_lamports;
      const ts = y.lastYieldTs ?? y.last_yield_ts;
      setUserYieldPosition({
        principalLamports: BigInt(pr.toString()),
        accruedYieldLamports: BigInt(ac.toString()),
        lastYieldTs: Number(ts.toString())
      });
    } catch {
      setUserYieldPosition(null);
    }
  }

  useEffect(() => {
    setYieldSourceAccountId(selectedAccountId);
    setYieldDestAccountId(selectedAccountId);
  }, [selectedAccountId]);

  useEffect(() => {
    if (!walletPublicKey || !program) return;
    const id = window.setInterval(() => setYieldUiTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [walletPublicKey, program]);

  useEffect(() => {
    if (walletPublicKey && program) {
      /* List needs wallet + program only; no need to wait for selected-account PDA. */
      void fetchAllSavingsAccounts();
      void fetchUserYield();
      void fetchYieldVaultSummary();
      refreshWalletBalance();
      if (pda) {
        /* Sync selected account balance from chain; do not touch bottom status line. */
        void refreshBalance(undefined, { updateStatus: false, showRefreshing: false });
      }
    }
    if (!walletPublicKey) {
      setBalance(null);
      setYieldVaultSummary(null);
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

  /** When wallet address or connection changes, refetch native SOL (main effect deps may not fire in all cases). */
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

  async function handleYieldDeposit() {
    if (!program || !walletPublicKey) return;
    const accountIdBn = parseU64ToBN(yieldSourceAccountId);
    if (!accountIdBn) return;
    const pdaForOp = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(accountIdBn)
      ],
      programId
    )[0];
    const lamports = parseSolToLamports(yieldDepositAmount);
    if (lamports <= 0n) {
      setAppStatus(t("invalidAmount"), "error");
      return;
    }

    const userYieldPda = getUserYieldPda(walletPublicKey);
    const yieldVaultPda = getYieldVaultPda();

    invalidatePendingBalanceFetch();
    setAppStatus(t("statusYieldDepositing"), "default");
    try {
      await program.methods
        .yieldDeposit(accountIdBn, new BN(lamports.toString()))
        .accounts({
          owner: walletPublicKey,
          miniAccount: pdaForOp,
          userYield: userYieldPda,
          yieldVault: yieldVaultPda,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      await fetchUserYield();
      await fetchYieldVaultSummary();
      await fetchAllSavingsAccounts();
      await refreshBalance(yieldSourceAccountId);
      setAppStatus(t("balanceRefreshed"), "default");
    } catch (e: any) {
      setAppStatus(friendlyError(e), "error");
    }
  }

  async function handleFundYieldVault() {
    if (!walletPublicKey || !activeSigner) return;
    const lamports = parseSolToLamports(yieldFundAmount);
    if (lamports <= 0n) {
      setAppStatus(t("invalidAmount"), "error");
      return;
    }
    const lamportsNum = Number(lamports);
    if (!Number.isSafeInteger(lamportsNum)) {
      setAppStatus(t("invalidAmount"), "error");
      return;
    }

    const yieldVaultPda = getYieldVaultPda();
    invalidatePendingBalanceFetch();
    setAppStatus(t("statusFundingYield"), "default");
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: walletPublicKey,
        recentBlockhash: blockhash
      }).add(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: yieldVaultPda,
          lamports: lamportsNum
        })
      );
      const signed = await activeSigner.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      await refreshWalletBalance();
      await fetchYieldVaultSummary();
      setAppStatus(t("balanceRefreshed"), "default");
    } catch (e: any) {
      setAppStatus(friendlyError(e), "error");
    }
  }

  async function handleYieldWithdraw() {
    if (!program || !walletPublicKey) return;
    const targetBn = parseU64ToBN(yieldDestAccountId);
    if (!targetBn) return;

    const pdaDest = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode(accountSeed),
        walletPublicKey.toBuffer(),
        accountIdToLeBytes(targetBn)
      ],
      programId
    )[0];
    const userYieldPda = getUserYieldPda(walletPublicKey);
    const yieldVaultPda = getYieldVaultPda();

    invalidatePendingBalanceFetch();
    setAppStatus(t("statusYieldWithdrawing"), "default");
    try {
      await program.methods
        .yieldWithdraw(targetBn)
        .accounts({
          owner: walletPublicKey,
          userYield: userYieldPda,
          yieldVault: yieldVaultPda,
          destMiniAccount: pdaDest,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      setUserYieldPosition(null);
      await fetchYieldVaultSummary();
      await fetchAllSavingsAccounts();
      await refreshBalance(yieldDestAccountId);
      setAppStatus(t("balanceRefreshed"), "default");
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

  /** Badge label: browser wallet vs local keypair mode. */
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
  const currentYieldApyBps = yieldVaultSummary
    ? dynamicApyBpsFromPool(yieldVaultSummary.rewardPoolLamports, yieldVaultSummary.totalPrincipalLamports)
    : MIN_YIELD_APY_BPS;

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

      <div className="card" data-yield-tick={yieldUiTick}>
        <h2>{t("yieldTitle")}</h2>
        <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12 }}>
          {t("yieldApyHint", { apy: (currentYieldApyBps / 100).toFixed(2) })}
        </p>
        <div style={{ marginBottom: 12, fontSize: "0.9rem" }}>
          <span className="muted">{t("yieldVaultAddress")}: </span>
          <span className="mono">{truncateAddress(getYieldVaultPda().toBase58(), 8)}</span>
          <button
            className="copy-btn"
            type="button"
            onClick={() => copyToClipboard(getYieldVaultPda().toBase58())}
            title={t("copyAddressTitle")}
          >
            <CopyIcon />
          </button>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 16 }}>
          {t("yieldVaultHint")}
        </p>

        <div className="field">
          <label>{t("yieldFundAmount")}</label>
          <input
            value={yieldFundAmount}
            onChange={(e) => setYieldFundAmount(e.target.value)}
            placeholder="0.1"
          />
        </div>
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="primary" type="button" onClick={() => void handleFundYieldVault()} disabled={!canUseApp}>
            {t("yieldFundBtn")}
          </button>
        </div>

        {yieldVaultSummary ? (
          <div className="muted" style={{ marginBottom: 12, fontSize: "0.9rem" }}>
            <div>
              {t("yieldRewardPool")}: {yieldVaultSummary.rewardPoolLamports.toString()}
            </div>
            <div style={{ marginTop: 6, fontSize: "0.85rem" }}>{t("yieldRewardPoolHint")}</div>
          </div>
        ) : null}

        {userYieldPosition ? (
          <div style={{ marginBottom: 16 }}>
            <div className="muted" style={{ marginBottom: 4 }}>
              {t("yieldPrincipal")}: {userYieldPosition.principalLamports.toString()}
            </div>
            <div className="muted" style={{ marginBottom: 4 }}>
              {t("yieldAccrued")}: {userYieldPosition.accruedYieldLamports.toString()}
            </div>
            <div style={{ fontWeight: 600 }}>
              {t("yieldEstimatedTotal")}:{" "}
              {estimateYieldTotalLamports(
                userYieldPosition.principalLamports,
                userYieldPosition.accruedYieldLamports,
                userYieldPosition.lastYieldTs,
                Math.floor(Date.now() / 1000),
                currentYieldApyBps
              ).toString()}
            </div>
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 16 }}>
            {t("yieldNoPosition")}
          </div>
        )}

        <div className="field">
          <label>{t("yieldFromAccount")}</label>
          <select
            value={yieldSourceAccountId}
            onChange={(e) => setYieldSourceAccountId(e.target.value)}
            disabled={!canUseApp || accountsList.length === 0}
          >
            {accountsList.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                #{a.accountId} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("amountSol")}</label>
          <input
            value={yieldDepositAmount}
            onChange={(e) => setYieldDepositAmount(e.target.value)}
            placeholder="0.1"
          />
        </div>
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="primary" type="button" onClick={() => void handleYieldDeposit()} disabled={!canUseApp}>
            {t("yieldDepositBtn")}
          </button>
        </div>

        <div className="field">
          <label>{t("yieldToAccount")}</label>
          <select
            value={yieldDestAccountId}
            onChange={(e) => setYieldDestAccountId(e.target.value)}
            disabled={!canUseApp || accountsList.length === 0}
          >
            {accountsList.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                #{a.accountId} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button type="button" onClick={() => void handleYieldWithdraw()} disabled={!canUseApp}>
            {t("yieldWithdrawBtn")}
          </button>
        </div>
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

