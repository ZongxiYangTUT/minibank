import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Minibank } from "../target/types/minibank";

describe("minibank", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.minibank as Program<Minibank>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const owner = provider.wallet.publicKey;

  const toLe8 = (n: number) => new anchor.BN(n).toArrayLike(Buffer, "le", 8);

  const getUserStatsPda = (ownerPk: anchor.web3.PublicKey) => {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_stats"), ownerPk.toBuffer()],
      program.programId
    );
  };

  const getMiniAccountPda = (ownerPk: anchor.web3.PublicKey, accountId: number) => {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mini_account"), ownerPk.toBuffer(), toLe8(accountId)],
      program.programId
    );
  };

  const ensureUserStats = async () => {
    const [userStatsPda] = getUserStatsPda(owner);
    const exists = await program.account.userStats.fetchNullable(userStatsPda);
    if (!exists) {
      await program.methods
        .initUserStats()
        .accountsPartial({
          userStats: userStatsPda,
          owner,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }
  };

  const createAccount = async (name: string) => {
    await ensureUserStats();
    const [userStatsPda] = getUserStatsPda(owner);
    const stats = await program.account.userStats.fetch(userStatsPda);
    const accountId = stats.nextAccountId.toNumber();
    const [miniAccountPda] = getMiniAccountPda(owner, accountId);

    // Let Anchor resolve accounts from the IDL (same PDAs as manual passes; avoids ordering/encoding issues).
    await program.methods
      .createAccount(name)
      .accounts({
        payer: owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    return { accountId, miniAccountPda };
  };

  it("create_account works with sequential account_id from UserStats", async () => {
    const { accountId, miniAccountPda } = await createAccount("alice-savings");

    const created = await program.account.miniAccount.fetch(miniAccountPda);
    assert.equal(created.accountId.toString(), accountId.toString());
    assert.equal(created.balance.toString(), "0");
    assert.equal(created.owner.toBase58(), owner.toBase58());
  });

  it("deposit and withdraw update tracked balance", async () => {
    const { accountId, miniAccountPda } = await createAccount("flow-account");

    const depositAmount = new anchor.BN(1_000_000_000);
    await program.methods
      .deposit(new anchor.BN(accountId), depositAmount)
      .accountsPartial({
        owner,
        miniAccount: miniAccountPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const afterDeposit = await program.account.miniAccount.fetch(miniAccountPda);
    assert.equal(afterDeposit.balance.toString(), depositAmount.toString());

    const withdrawAmount = new anchor.BN(400_000_000);
    await program.methods
      .withdraw(new anchor.BN(accountId), withdrawAmount)
      .accountsPartial({
        owner,
        recipient: owner,
        miniAccount: miniAccountPda,
      })
      .rpc();

    const afterWithdraw = await program.account.miniAccount.fetch(miniAccountPda);
    assert.equal(afterWithdraw.balance.toString(), "600000000");
  });

  it("withdraw fails when amount exceeds tracked balance", async () => {
    const { accountId, miniAccountPda } = await createAccount("insufficient-test");

    const withdrawTooMuch = new anchor.BN(1);

    let threw = false;
    try {
      await program.methods
        .withdraw(new anchor.BN(accountId), withdrawTooMuch)
        .accountsPartial({
          owner,
          recipient: owner,
          miniAccount: miniAccountPda,
        })
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected withdraw to fail on insufficient balance");
  });

  it("delete_account fails when non-empty, succeeds after empty", async () => {
    const { accountId, miniAccountPda } = await createAccount("delete-test");

    const amount = new anchor.BN(200_000_000);
    await program.methods
      .deposit(new anchor.BN(accountId), amount)
      .accountsPartial({
        owner,
        miniAccount: miniAccountPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    let deleteFailed = false;
    try {
      await program.methods
        .deleteAccount(new anchor.BN(accountId))
        .accountsPartial({
          owner,
          recipient: owner,
          miniAccount: miniAccountPda,
        })
        .rpc();
    } catch {
      deleteFailed = true;
    }
    assert.isTrue(deleteFailed, "expected delete_account to fail when balance > 0");

    await program.methods
      .withdraw(new anchor.BN(accountId), amount)
      .accountsPartial({
        owner,
        recipient: owner,
        miniAccount: miniAccountPda,
      })
      .rpc();

    await program.methods
      .deleteAccount(new anchor.BN(accountId))
      .accountsPartial({
        owner,
        recipient: owner,
        miniAccount: miniAccountPda,
      })
      .rpc();

    const deleted = await program.account.miniAccount.fetchNullable(miniAccountPda);
    assert.isNull(deleted);
  });
});
