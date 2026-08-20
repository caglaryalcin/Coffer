import type { VaultPayloadCipher } from "./vault-crypto";

export type VaultMutationBlockReason =
  | "locking"
  | "locked"
  | "conflict-pending"
  | "conflict";

export type VaultSessionPhase = "closed" | "opening" | "ready" | "locking";

export type VaultSessionTransition = Readonly<{
  epoch: number;
  phase: VaultSessionPhase;
}>;

/**
 * Starts a new, exclusive session transition. The monotonically increasing
 * epoch lets late async work prove that it still owns the transition before it
 * publishes or clears live key material.
 */
export function beginVaultSessionTransition(
  current: VaultSessionTransition,
  phase: VaultSessionPhase,
): VaultSessionTransition {
  const epoch = current.epoch + 1;
  if (!Number.isSafeInteger(epoch)) {
    throw new Error("The vault session transition counter is exhausted.");
  }
  return { epoch, phase };
}

/**
 * Completes a transition only for its current owner. A null result means that
 * newer work superseded this completion and its caller must not publish state.
 */
export function completeVaultSessionTransition(
  current: VaultSessionTransition,
  ownerEpoch: number,
  expectedPhase: VaultSessionPhase,
  nextPhase: VaultSessionPhase,
): VaultSessionTransition | null {
  if (current.epoch !== ownerEpoch || current.phase !== expectedPhase) return null;
  return { epoch: current.epoch, phase: nextPhase };
}

export function isVaultSessionTransition(
  current: VaultSessionTransition,
  ownerEpoch: number,
  phase: VaultSessionPhase,
): boolean {
  return current.epoch === ownerEpoch && current.phase === phase;
}

export type VaultMutationState = {
  phase: VaultSessionPhase;
  runtimeAvailable: boolean;
  vaultAvailable: boolean;
  conflictPending: boolean;
  conflictPresent: boolean;
};

/**
 * Mutation access is derived from the live vault session rather than a second
 * boolean that can get out of sync with unlock and conflict recovery.
 */
export function vaultMutationBlockReason(
  state: VaultMutationState,
): VaultMutationBlockReason | null {
  if (state.phase === "locking") return "locking";
  if (
    state.phase !== "ready" ||
    !state.runtimeAvailable ||
    !state.vaultAvailable
  ) {
    return "locked";
  }
  if (state.conflictPending) return "conflict-pending";
  if (state.conflictPresent) return "conflict";
  return null;
}

export type VaultSaveRecoveryDecision = "already-saved" | "retry" | "conflict";

export type HiddenLockTransition = {
  armed: boolean;
  shouldLock: boolean;
};

/**
 * A freshly unlocked session is allowed to become visible before the optional
 * hidden-tab rule is armed. This avoids immediately locking when browser tools
 * briefly report the document as hidden during the unlock transition.
 */
export function hiddenLockTransition(
  armed: boolean,
  hidden: boolean,
  lockWhenHidden: boolean,
): HiddenLockTransition {
  return {
    armed: armed || !hidden,
    shouldLock: armed && hidden && lockWhenHidden,
  };
}

/**
 * A failed save is a conflict only when the server actually moved to another
 * revision. Re-authenticating against the same revision must remain retryable.
 */
export function classifyVaultSaveRecovery(
  expectedRevision: number,
  pendingPayload: VaultPayloadCipher,
  current: { revision: number; payload: VaultPayloadCipher },
): VaultSaveRecoveryDecision {
  if (
    pendingPayload.algorithm === current.payload.algorithm &&
    pendingPayload.tagLength === current.payload.tagLength &&
    pendingPayload.iv === current.payload.iv &&
    pendingPayload.ciphertext === current.payload.ciphertext
  ) {
    return "already-saved";
  }
  return current.revision === expectedRevision ? "retry" : "conflict";
}
