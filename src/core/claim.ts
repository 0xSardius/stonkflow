import { StonkFunClient } from '../stonkfun/client';
import type { Ledger } from '../ledger/store';
import type { Signer } from './signer';
import { LaunchError } from './launch';

// Creator fee claims for standard-mode launches.
//   self    -> the agent is creator; we return the unsigned claim tx and relay its signature.
//   managed -> the treasury is creator; we claim, then the forward job pays payoutWallet.
// LaunchLab launches forward creator fees automatically, so most claims answer
// "nothing to claim" and that is not an error.

export class ClaimCore {
  constructor(private readonly deps: { stonkfun: StonkFunClient; ledger: Ledger; treasury: Signer | null }) {}

  async claimable(mint: string) {
    return this.deps.stonkfun.getClaimableFees(mint);
  }

  /** Returns an unsigned claim transaction for the creator wallet to sign. */
  async prepare(mint: string, creatorWallet: string) {
    const res = await this.deps.stonkfun.prepareClaim(mint, creatorWallet);
    await this.deps.ledger.eventForMint(mint, 'claim_prepared', { creatorWallet, intentId: res.intentId, amounts: res.amounts ?? null });
    return {
      mint,
      creatorWallet,
      intentId: res.intentId,
      unsignedTransaction: res.transaction,
      amounts: res.amounts ?? null,
      next: `Sign unsignedTransaction with ${creatorWallet}, then POST /v1/fees/claim/submit { mint, creatorWallet, intentId, signedTransaction }.`,
    };
  }

  async submit(mint: string, body: { creatorWallet: string; intentId: string; signedTransaction: string }) {
    const res = await this.deps.stonkfun.submitClaim(mint, body);
    await this.deps.ledger.eventForMint(mint, 'claim_submitted', { creatorWallet: body.creatorWallet, signature: res.signature, alreadySubmitted: res.alreadySubmitted ?? false });
    return { mint, signature: res.signature, alreadySubmitted: res.alreadySubmitted ?? false };
  }

  /** Managed launches: the treasury claims for itself. The forward job moves the share to payoutWallet. */
  async claimManaged(mint: string) {
    const launch = await this.deps.ledger.findByMint(mint);
    if (!launch || launch.signingMode !== 'managed') throw new LaunchError('not_managed', `mint ${mint} is not a managed launch`, 404);
    if (!this.deps.treasury) throw new LaunchError('managed_unavailable', 'no treasury on this deployment', 503);
    const prepared = await this.deps.stonkfun.prepareClaim(mint, this.deps.treasury.publicKey);
    const signed = this.deps.treasury.sign(prepared.transaction);
    const res = await this.deps.stonkfun.submitClaim(mint, { creatorWallet: this.deps.treasury.publicKey, intentId: prepared.intentId, signedTransaction: signed.signedBase64 });
    await this.deps.ledger.eventForMint(mint, 'managed_claim', { signature: res.signature, amounts: prepared.amounts ?? null, payoutWallet: launch.agentWallet });
    return { mint, signature: res.signature, payoutWallet: launch.agentWallet, amounts: prepared.amounts ?? null };
  }
}
