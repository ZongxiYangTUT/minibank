import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Minibank } from "../target/types/minibank";

describe("minibank", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.minibank as Program<Minibank>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const payerKp = (provider.wallet as any).payer as anchor.web3.Keypair;
  const payer = payerKp.publicKey;

  const getMiniAccountPda = (owner: anchor.web3.PublicKey) => {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mini_account"), owner.toBuffer()],
      program.programId
    );
  };

  it("create_account works with PDA", async () => {
    const [miniAccountPda] = getMiniAccountPda(payer);
    const name = "alice-savings";

    const tx = await program.methods
      .createAccount(name)
      .accountsPartial({
        miniAccount: miniAccountPda,
        payer,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    console.log("create_account tx:", tx);

    const created = await program.account.miniAccount.fetch(
      miniAccountPda
    );
    assert.equal(created.name, name);
    assert.equal(created.balance.toNumber(), 0);
  });

  it("deposit increases mini_account balance", async () => {
    const [miniAccountPda] = getMiniAccountPda(payer);
    const amount = new anchor.BN(1_000_000_000);

    const tx = await program.methods
      .deposit(amount)
      .accountsPartial({
        sender: payer,
        miniAccount: miniAccountPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    console.log("deposit tx:", tx);

    const accountAfter = await program.account.miniAccount.fetch(miniAccountPda);
    assert.equal(accountAfter.balance.toNumber(), amount.toNumber());
  });

  it("withdraw decreases mini_account balance", async () => {
    const [miniAccountPda] = getMiniAccountPda(payer);
    const withdrawAmount = new anchor.BN(400_000_000);

    const before = await program.account.miniAccount.fetch(miniAccountPda);

    const tx = await program.methods
      .withdraw(withdrawAmount)
      .accountsPartial({
        recipient: payer,
        miniAccount: miniAccountPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("withdraw tx:", tx);

    const after = await program.account.miniAccount.fetch(miniAccountPda);
    const expected = before.balance.sub(withdrawAmount);
    assert.equal(after.balance.toString(), expected.toString());
  });
});
