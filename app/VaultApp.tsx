"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountEditor, { type AccountEditorCodePreview } from "./AccountEditor";
import BulkGroupActions, { AccountSelectionIndicator, ArchiveBulkActions, normalizeGroupName } from "./BulkGroupActions";
import CardViewMenu, { CARD_VIEW_STORAGE_KEY, parseCardView, readCardViewPreference, writeCardViewPreference, type CardView } from "./CardViewMenu";
import GroupCustomizationDialog from "./GroupCustomizationDialog";
import OverflowingIdentity from "./OverflowingIdentity";
import QrScanner from "./QrScanner";
import ServiceLogo, { isServiceBrandId, serviceBrandById, serviceBrandIds } from "./ServiceLogo";
import SettingsCenter, { type UserProfile, type UserProfilePatch } from "./SettingsCenter";
import SignInScreen from "./SignInScreen";
import ThemeToggle from "./ThemeToggle";
import TransferCenter, { type ImportDecision } from "./TransferCenter";
import { formatCode, generateTotp, isTotpExpiring, isValidBase32, normalizeSecret, parseOtpAuthUri, totpWindow, type TotpAlgorithm } from "../lib/totp";
import { claimLegacyVault, deleteVaultAccount, getVaultBootstrap, identifyVault, loginVault, logoutVault, saveVault, setupVault, VAULT_API_TIMEOUT_MS, VaultApiError } from "../lib/vault-api";
import { createAuthProof, createEncryptedVault, decryptVaultPayload, encryptVaultPayload, unlockVaultHeader, VaultCryptoError, type EncryptedVaultHeader, type VaultPayloadCipher, type VaultRuntime } from "../lib/vault-crypto";
import { createEmptyVault, parsePersistedVault, withVaultUpdate, type PersistedVault, type VaultAccount, type VaultGroupColor, type VaultGroupCustomization, type VaultGroupIcon, type VaultTheme } from "../lib/vault-model";
import { classifyVaultOutbox, clearVaultOutbox, createVaultOutboxRecord, readVaultOutbox, writeVaultOutbox, type VaultOutboxRecord } from "../lib/vault-outbox";
import { clearVaultResumeSession, readVaultResumeSession, saveVaultResumeSession, touchVaultResumeSession } from "../lib/vault-resume";
import { remainingAutoLockMs } from "../lib/auto-lock";
import type { EditableAccountPatch } from "../lib/account-editor";
import {
  beginVaultSessionTransition,
  classifyVaultSaveRecovery,
  completeVaultSessionTransition,
  hiddenLockTransition,
  isVaultSessionTransition,
  vaultMutationBlockReason,
  type VaultSessionPhase,
  type VaultSessionTransition,
} from "../lib/vault-session";

type Group = string;
type View = "all" | "favorites" | "archive" | "transfer" | "settings";
type Account = VaultAccount;
type AuthStatus = "loading" | "access" | "ready" | "locking";
type SaveStatus = "saved" | "saving" | "error" | "conflict";
type GeneratedCodePair = { counter: number; configKey: string; current: string; next: string };
type PendingVaultStage = { vault: PersistedVault; version: number; generation: number };
type StagedVaultSave = {
  payload: VaultPayloadCipher;
  version: number;
  generation: number;
  durablyQueued: boolean;
};
type SaveDrain = { generation: number; promise: Promise<void> };
type SaveAttempt =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; revision: number; payload: VaultPayloadCipher };
type VaultConflict = {
  localVault: PersistedVault | null;
  localPayload: VaultPayloadCipher;
  serverVault: PersistedVault;
  serverPayload: VaultPayloadCipher;
  serverRevision: number;
  outbox: VaultOutboxRecord;
};
type ReadyVaultSessionPublication = {
  transitionEpoch: number;
  generation: number;
  revision: number;
  mutationVersion: number;
  savedVersion: number;
  runtime: VaultRuntime;
  vault: PersistedVault;
  header: EncryptedVaultHeader;
  conflict: VaultConflict | null;
  staged: StagedVaultSave | null;
  saveStatus: SaveStatus;
  saveError: string | null;
};
const EMPTY_ACCOUNTS: Account[] = [];
const ADD_ACCOUNT_PALETTE: Account["color"][] = ["violet", "green", "blue", "orange"];
const ACCOUNT_ICON_OPTIONS = serviceBrandIds
  .flatMap((id) => {
    const brand = serviceBrandById(id);
    return brand ? [{ id, label: brand.title }] : [];
  })
  .sort((left, right) => left.label.localeCompare(right.label, "en"));
const LOCK_SAVE_GRACE_MS = VAULT_API_TIMEOUT_MS + 750;
const RESUME_ACTIVITY_WRITE_INTERVAL_MS = 1_000;
const ACCOUNT_EVENT_CHANNEL_NAME = "coffer-account-events-v1";
const ACCOUNT_DELETION_CLEANUP_MS = VAULT_API_TIMEOUT_MS + 6_000;

async function settleWithin<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<{ status: "fulfilled"; value: T } | { status: "rejected" | "timeout" }> {
  if (milliseconds <= 0) return { status: "timeout" };
  let timeout = 0;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ status: "fulfilled", value }) as const,
        () => ({ status: "rejected" }) as const,
      ),
      new Promise<{ status: "timeout" }>((resolve) => {
        timeout = window.setTimeout(() => resolve({ status: "timeout" }), milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

const EMPTY_GROUP_CUSTOMIZATIONS: VaultGroupCustomization[] = [];
const DEFAULT_GROUP_ICONS: readonly VaultGroupIcon[] = ["dot", "folder", "briefcase", "person", "shield", "star", "home", "code"];
const DEFAULT_GROUP_COLORS: readonly VaultGroupColor[] = ["rose", "amber", "lime", "emerald", "sky", "blue", "violet", "slate"];
const COMMON_GROUP_STYLES: Readonly<Record<string, Pick<VaultGroupCustomization, "icon" | "color">>> = {
  personal: { icon: "person", color: "blue" },
  work: { icon: "briefcase", color: "amber" },
  finance: { icon: "shield", color: "lime" },
};

function groupKey(value: string) {
  return normalizeGroupName(value).normalize("NFKC").toLocaleLowerCase("en");
}

function defaultGroupCustomization(name: string): VaultGroupCustomization {
  const normalizedName = normalizeGroupName(name);
  const key = groupKey(normalizedName);
  const common = COMMON_GROUP_STYLES[key];
  if (common) return { name: normalizedName, ...common };

  const score = [...key].reduce(
    (total, character, index) => ((total * 33) + (character.codePointAt(0) ?? 0) + index) >>> 0,
    5381,
  );
  return {
    name: normalizedName,
    icon: DEFAULT_GROUP_ICONS[score % DEFAULT_GROUP_ICONS.length],
    color: DEFAULT_GROUP_COLORS[Math.floor(score / DEFAULT_GROUP_ICONS.length) % DEFAULT_GROUP_COLORS.length],
  };
}

function initials(service: string) {
  const words = service.trim().split(/\s+/);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : service.slice(0, 2)).slice(0, 3).toUpperCase();
}

function profileInitials(name: string) {
  return name.trim().split(/\s+/u).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "CO";
}

function totpConfigKey(account: Account) {
  let hash = 2_166_136_261;
  const configuration = `${account.secret}\0${account.algorithm}\0${account.digits}\0${account.period}`;
  for (const character of configuration) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `${account.id}:${configuration.length}:${(hash >>> 0).toString(36)}`;
}

function accountCodePreview(account: Account, timestamp: number, storedPair?: GeneratedCodePair): AccountEditorCodePreview {
  const window = totpWindow(timestamp, account.period);
  const pairMatchesConfig = storedPair?.configKey === totpConfigKey(account);
  return {
    current: pairMatchesConfig && storedPair.counter === window.counter
      ? storedPair.current
      : pairMatchesConfig && storedPair.counter === window.counter - 1
        ? storedPair.next
        : null,
    next: pairMatchesConfig && storedPair.counter === window.counter ? storedPair.next : null,
    remaining: account.period - (Math.floor(timestamp / 1000) % account.period),
    period: account.period,
  };
}

export default function VaultApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [vault, setVault] = useState<PersistedVault | null>(null);
  const [runtime, setRuntime] = useState<VaultRuntime | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<VaultConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [codePairs, setCodePairs] = useState<Record<string, GeneratedCodePair>>({});
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"All" | Group>("All");
  const [view, setView] = useState<View>("all");
  const [cardView, setCardView] = useState<CardView>("default");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"qr" | "link" | "manual">("qr");
  const [accountMenuId, setAccountMenuId] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountEditorReturnFocusTo, setAccountEditorReturnFocusTo] = useState<HTMLButtonElement | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set());
  const [customizingGroup, setCustomizingGroup] = useState<string | null>(null);
  const [groupCustomizationReturnFocusTo, setGroupCustomizationReturnFocusTo] = useState<HTMLElement | null>(null);
  const [setupLink, setSetupLink] = useState("");
  const [service, setService] = useState("");
  const [identity, setIdentity] = useState("");
  const [secret, setSecret] = useState("");
  const [newGroup, setNewGroup] = useState<Group>("Personal");
  const [newAlgorithm, setNewAlgorithm] = useState<TotpAlgorithm>("SHA-1");
  const [newDigits, setNewDigits] = useState<6 | 8>(6);
  const [newPeriod, setNewPeriod] = useState(30);
  const [formError, setFormError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const addDialogRef = useRef<HTMLElement>(null);
  const addTriggerRef = useRef<HTMLElement | null>(null);
  const addOriginViewRef = useRef<View>("all");
  const runtimeRef = useRef<VaultRuntime | null>(null);
  const vaultRef = useRef<PersistedVault | null>(null);
  const bootstrapHeaderRef = useRef<EncryptedVaultHeader | null>(null);
  const conflictRef = useRef<VaultConflict | null>(null);
  const revisionRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const pendingStageRef = useRef<PendingVaultStage | null>(null);
  const stagedSaveRef = useRef<StagedVaultSave | null>(null);
  const stagingPromiseRef = useRef<Promise<void> | null>(null);
  const drainRef = useRef<SaveDrain | null>(null);
  const flushVaultSavesRef = useRef<() => Promise<void>>(async () => undefined);
  const lockPromiseRef = useRef<Promise<void> | null>(null);
  const lockingRef = useRef(false);
  const conflictBusyRef = useRef(false);
  const conflictPendingRef = useRef(false);
  const clipboardClearTimersRef = useRef<Set<number>>(new Set());
  const sessionGenerationRef = useRef(0);
  const sessionTransitionRef = useRef<VaultSessionTransition>({
    epoch: 0,
    phase: "closed",
  });
  const lastActivityAtRef = useRef<number | null>(null);
  const hiddenLockArmedRef = useRef(false);
  const resumeAvailableRef = useRef(false);
  const resumeAbsoluteExpiresAtRef = useRef(0);
  const resumeSavePromiseRef = useRef<Promise<void> | null>(null);
  const lastResumeRetryAtRef = useRef(0);
  const lastResumeTouchAtRef = useRef(0);

  const signedIn = authStatus === "ready" && Boolean(vault && runtime);
  const locked = !signedIn;
  const profile: UserProfile = vault?.profile ?? { name: "Coffer owner", email: "Encrypted vault", avatarDataUrl: null };
  const accounts = vault?.accounts ?? EMPTY_ACCOUNTS;
  const groupCustomizations = vault?.groupCustomizations ?? EMPTY_GROUP_CUSTOMIZATIONS;
  const editingAccount = editingAccountId ? accounts.find((account) => account.id === editingAccountId) ?? null : null;
  const autoLockMinutes = vault?.settings.autoLockMinutes ?? 5;
  const lockWhenHidden = vault?.settings.lockWhenHidden ?? false;
  const clearClipboard = vault?.settings.clearClipboard ?? true;
  const theme: VaultTheme = vault?.settings.theme ?? "dark";

  const groups = useMemo(() => Array.from(new Set(accounts.filter((account) => !account.archived).map((account) => account.group))), [accounts]);
  const entryGroups = useMemo(() => Array.from(new Set(["Personal", "Work", "Finance", ...groups])), [groups]);
  const groupCustomizationMap = useMemo(
    () => new Map(groupCustomizations.map((customization) => [groupKey(customization.name), customization])),
    [groupCustomizations],
  );
  const customizationForGroup = useCallback((name: string) => (
    groupCustomizationMap.get(groupKey(name)) ?? defaultGroupCustomization(name)
  ), [groupCustomizationMap]);
  const activeGroupCustomization = customizingGroup ? customizationForGroup(customizingGroup) : null;
  const editingCodePreview = editingAccount && signedIn
    ? accountCodePreview(editingAccount, tick, codePairs[editingAccount.id])
    : undefined;

  const beginSessionTransition = useCallback((phase: VaultSessionPhase) => {
    const next = beginVaultSessionTransition(sessionTransitionRef.current, phase);
    sessionTransitionRef.current = next;
    return next.epoch;
  }, []);

  const mutationBlockReason = useCallback(() => vaultMutationBlockReason({
    phase: sessionTransitionRef.current.phase,
    runtimeAvailable: Boolean(runtimeRef.current),
    vaultAvailable: Boolean(vaultRef.current),
    conflictPending: conflictPendingRef.current,
    conflictPresent: Boolean(conflictRef.current),
  }), []);

  const saveResumeSession = useCallback((
    activeRuntime: VaultRuntime,
    activeHeader: EncryptedVaultHeader,
    notifyOnFailure = true,
  ): Promise<void> => {
    if (resumeSavePromiseRef.current) return resumeSavePromiseRef.current;
    const transitionEpoch = sessionTransitionRef.current.epoch;
    const task = saveVaultResumeSession(activeHeader.vaultId, activeRuntime)
      .then((metadata) => {
        if (
          transitionEpoch !== sessionTransitionRef.current.epoch ||
          sessionTransitionRef.current.phase === "locking"
        ) {
          return;
        }
        resumeAvailableRef.current = true;
        resumeAbsoluteExpiresAtRef.current = metadata.absoluteExpiresAt;
      })
      .catch(() => {
        if (transitionEpoch !== sessionTransitionRef.current.epoch) return;
        resumeAvailableRef.current = false;
        if (notifyOnFailure) {
          setToast("This browser cannot keep the vault unlocked after a refresh.");
        }
      });
    const tracked = task.finally(() => {
      if (resumeSavePromiseRef.current === tracked) {
        resumeSavePromiseRef.current = null;
      }
    });
    resumeSavePromiseRef.current = tracked;
    return tracked;
  }, []);

  const touchOrRestoreResumeSession = useCallback((): void => {
    const activeRuntime = runtimeRef.current;
    const activeHeader = bootstrapHeaderRef.current;
    if (
      !activeRuntime ||
      !activeHeader ||
      lockingRef.current ||
      conflictPendingRef.current
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastResumeTouchAtRef.current < RESUME_ACTIVITY_WRITE_INTERVAL_MS) {
      return;
    }
    if (touchVaultResumeSession(activeHeader.vaultId, now)) {
      resumeAvailableRef.current = true;
      lastResumeTouchAtRef.current = now;
      return;
    }

    resumeAvailableRef.current = false;
    if (
      resumeSavePromiseRef.current ||
      (resumeAbsoluteExpiresAtRef.current > 0 && now >= resumeAbsoluteExpiresAtRef.current) ||
      now - lastResumeRetryAtRef.current < 60_000
    ) {
      return;
    }
    lastResumeRetryAtRef.current = now;
    void saveResumeSession(activeRuntime, activeHeader, false);
  }, [saveResumeSession]);

  const beginOpeningSession = useCallback(async (): Promise<number> => {
    const pendingLock = lockPromiseRef.current;
    if (pendingLock) {
      await pendingLock.catch(() => undefined);
      if (lockPromiseRef.current === pendingLock) {
        lockPromiseRef.current = null;
      }
    }
    if (lockPromiseRef.current) {
      throw new Error("A vault lock is still pending.");
    }

    // A settled promise or flag may survive a development refresh. Opening is
    // the normalization boundary, before an epoch and any live keys are owned.
    lockingRef.current = false;
    return beginSessionTransition("opening");
  }, [beginSessionTransition]);

  const prepareOpeningSession = useCallback(async (
    transitionEpoch: number,
  ): Promise<void> => {
    const pendingLock = lockPromiseRef.current;
    if (pendingLock) {
      await pendingLock.catch(() => undefined);
      if (lockPromiseRef.current === pendingLock) {
        lockPromiseRef.current = null;
      }
    }
    if (
      !isVaultSessionTransition(
        sessionTransitionRef.current,
        transitionEpoch,
        "opening",
      )
    ) {
      throw new Error("Vault opening was superseded by another session transition.");
    }
    if (lockPromiseRef.current) {
      throw new Error("A vault lock is still pending.");
    }

    // The owning lock promise has settled. Normalize a stale development or
    // interrupted-render flag before any ready session can be published.
    lockingRef.current = false;
  }, []);

  const publishReadySession = useCallback((
    publication: ReadyVaultSessionPublication,
  ): void => {
    const readyTransition = completeVaultSessionTransition(
      sessionTransitionRef.current,
      publication.transitionEpoch,
      "opening",
      "ready",
    );
    if (
      !readyTransition ||
      lockingRef.current ||
      lockPromiseRef.current
    ) {
      throw new Error("The vault session is not ready to be published.");
    }

    sessionGenerationRef.current = publication.generation;
    revisionRef.current = publication.revision;
    mutationVersionRef.current = publication.mutationVersion;
    savedVersionRef.current = publication.savedVersion;
    pendingStageRef.current = null;
    stagedSaveRef.current = publication.staged;
    runtimeRef.current = publication.runtime;
    vaultRef.current = publication.vault;
    bootstrapHeaderRef.current = publication.header;
    conflictRef.current = publication.conflict;
    conflictPendingRef.current = false;
    conflictBusyRef.current = false;
    lockingRef.current = false;
    lockPromiseRef.current = null;
    sessionTransitionRef.current = readyTransition;

    setRuntime(publication.runtime);
    setVault(publication.vault);
    setSaveConflict(publication.conflict);
    setConflictBusy(false);
    setSaveStatus(publication.saveStatus);
    setSaveError(publication.saveError);
    setAuthError(null);
    setAuthStatus("ready");
  }, []);

  const stagePendingVaults = useCallback((): Promise<void> => {
    if (stagingPromiseRef.current) return stagingPromiseRef.current;
    const generation = sessionGenerationRef.current;
    const task = (async () => {
      while (pendingStageRef.current?.generation === generation) {
        const pending = pendingStageRef.current;
        pendingStageRef.current = null;
        const activeRuntime = runtimeRef.current;
        const header = bootstrapHeaderRef.current;
        if (!activeRuntime || !header || generation !== sessionGenerationRef.current) return;

        let payload: VaultPayloadCipher;
        try {
          payload = await encryptVaultPayload(pending.vault, activeRuntime.vaultKey);
        } catch (error) {
          if (generation === sessionGenerationRef.current && !pendingStageRef.current) {
            pendingStageRef.current = pending;
            setSaveStatus("error");
            setSaveError("The latest vault changes could not be encrypted.");
          }
          throw error;
        }
        if (generation !== sessionGenerationRef.current) return;

        const newer = pendingStageRef.current as PendingVaultStage | null;
        if (newer?.generation === generation && newer.version > pending.version) continue;

        const staged: StagedVaultSave = {
          payload,
          version: pending.version,
          generation,
          durablyQueued: false,
        };
        stagedSaveRef.current = staged;
        const record = createVaultOutboxRecord(
          header.vaultId,
          revisionRef.current,
          payload,
        );
        try {
          await writeVaultOutbox(record);
          staged.durablyQueued = true;
        } catch {
          if (generation === sessionGenerationRef.current) {
            setSaveStatus("error");
            setSaveError("Encrypted browser recovery is unavailable. Keep this tab open until the server save succeeds.");
          }
        }
      }
    })();
    const tracked = task.finally(() => {
      if (stagingPromiseRef.current === tracked) stagingPromiseRef.current = null;
    });
    stagingPromiseRef.current = tracked;
    return tracked;
  }, []);

  const attemptVaultSave = useCallback(async (
    payload: VaultPayloadCipher,
    expectedRevision: number,
    generation: number,
  ): Promise<SaveAttempt> => {
    const vaultId = bootstrapHeaderRef.current?.vaultId;
    if (!vaultId) {
      throw new Error("The active vault identifier is unavailable.");
    }
    const assertRevision = (revision: number) => {
      if (revision !== expectedRevision + 1) {
        throw new VaultApiError("The vault server returned an unexpected revision.", "invalid_response", 200);
      }
      return { kind: "saved", revision } as const;
    };
    const loadCurrent = async () => {
      const activeRuntime = runtimeRef.current;
      if (!activeRuntime || generation !== sessionGenerationRef.current) {
        throw new Error("The vault session changed while saving.");
      }
      const proof = await createAuthProof(activeRuntime.authKey);
      const identifier = vaultRef.current?.profile.email;
      if (!identifier) {
        throw new Error("The vault account identifier is unavailable.");
      }
      const current = await loginVault(proof, identifier);
      if (generation !== sessionGenerationRef.current) {
        throw new Error("The vault session changed while saving.");
      }
      return current;
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await saveVault(vaultId, expectedRevision, payload);
        return assertRevision(result.revision);
      } catch (error) {
        if (
          !(error instanceof VaultApiError) ||
          (error.status !== 401 && error.code !== "revision_conflict")
        ) {
          throw error;
        }
        const current = await loadCurrent();
        const recovery = classifyVaultSaveRecovery(expectedRevision, payload, current);
        if (recovery === "already-saved") {
          return { kind: "saved", revision: current.revision };
        }
        if (recovery === "conflict") {
          return { kind: "conflict", revision: current.revision, payload: current.payload };
        }
      }
    }

    const current = await loadCurrent();
    const recovery = classifyVaultSaveRecovery(expectedRevision, payload, current);
    if (recovery === "already-saved") {
      return { kind: "saved", revision: current.revision };
    }
    if (recovery === "conflict") {
      return { kind: "conflict", revision: current.revision, payload: current.payload };
    }
    throw new VaultApiError(
      "The vault session could not be established for saving.",
      "unauthorized",
      401,
    );
  }, []);

  const publishConflict = useCallback(async (
    localPayload: VaultPayloadCipher,
    localVersion: number,
    serverRevision: number,
    serverPayload: VaultPayloadCipher,
    outbox: VaultOutboxRecord,
    generation: number,
    durablyQueued: boolean,
  ) => {
    const activeRuntime = runtimeRef.current;
    if (!activeRuntime || generation !== sessionGenerationRef.current) return;
    const serverVault = parsePersistedVault(
      await decryptVaultPayload<unknown>(serverPayload, activeRuntime.vaultKey),
    );
    let localVault: PersistedVault | null = null;
    try {
      localVault = parsePersistedVault(
        await decryptVaultPayload<unknown>(localPayload, activeRuntime.vaultKey),
      );
    } catch {
      // The server version remains available when a stale local record is unreadable.
    }
    if (generation !== sessionGenerationRef.current) return;
    const conflict: VaultConflict = {
      localVault,
      localPayload,
      serverVault,
      serverPayload,
      serverRevision,
      outbox,
    };
    conflictRef.current = conflict;
    revisionRef.current = serverRevision;
    stagedSaveRef.current = {
      payload: localPayload,
      version: localVersion,
      generation,
      durablyQueued,
    };
    mutationVersionRef.current = Math.max(mutationVersionRef.current, localVersion);
    vaultRef.current = localVault ?? serverVault;
    setVault(localVault ?? serverVault);
    setSaveConflict(conflict);
    setSaveStatus("conflict");
    setSaveError(
      localVault
        ? "This browser has encrypted changes based on an older server revision. Choose which version to keep."
        : "An unreadable encrypted browser recovery record conflicts with the server version. Choose the server version to continue.",
    );
  }, []);

  const flushVaultSaves = useCallback((): Promise<void> => {
    const generation = sessionGenerationRef.current;
    const existing = drainRef.current;
    if (existing?.generation === generation) return existing.promise;
    let restartAfterDrain = true;

    const task = (async () => {
      if (lockingRef.current || conflictRef.current) return;
      setSaveStatus("saving");
      setSaveError(null);

      while (
        generation === sessionGenerationRef.current &&
        !lockingRef.current &&
        !conflictRef.current
      ) {
        if (stagingPromiseRef.current) {
          try {
            await stagingPromiseRef.current;
          } catch {
            restartAfterDrain = false;
            setSaveStatus("error");
            setSaveError("The latest vault changes could not be encrypted.");
            return;
          }
        }
        if (generation !== sessionGenerationRef.current) return;
        const staged = stagedSaveRef.current;
        const header = bootstrapHeaderRef.current;
        if (!staged || staged.generation !== generation || !header) break;

        const baseRevision = revisionRef.current;
        const record = createVaultOutboxRecord(header.vaultId, baseRevision, staged.payload);
        try {
          await writeVaultOutbox(record);
          if (stagedSaveRef.current === staged) staged.durablyQueued = true;
        } catch {
          // The server save can still succeed; a failure below explains the durability risk.
        }

        let result: SaveAttempt;
        try {
          result = await attemptVaultSave(staged.payload, baseRevision, generation);
        } catch (error) {
          if (generation !== sessionGenerationRef.current) return;
          restartAfterDrain = false;
          setSaveStatus("error");
          setSaveError(
            error instanceof VaultApiError && error.code === "request_timeout"
              ? "The server save timed out. The encrypted change remains in this browser for retry."
              : "Encrypted changes could not be saved. They remain in this browser for retry.",
          );
          return;
        }
        if (generation !== sessionGenerationRef.current) return;

        if (result.kind === "conflict") {
          conflictPendingRef.current = true;
          try {
            if (stagingPromiseRef.current) {
              try {
                await stagingPromiseRef.current;
              } catch {
                restartAfterDrain = false;
                setSaveStatus("error");
                setSaveError("The latest vault changes could not be encrypted before conflict handling.");
                return;
              }
            }
            const latest = stagedSaveRef.current ?? staged;
            const conflictRecord = createVaultOutboxRecord(
              header.vaultId,
              record.baseRevision,
              latest.payload,
            );
            let conflictDurablyQueued = latest.durablyQueued;
            try {
              await writeVaultOutbox(conflictRecord);
              conflictDurablyQueued = true;
            } catch {
              // The already-written encrypted record is retained when possible.
            }
            try {
              await publishConflict(
                latest.payload,
                latest.version,
                result.revision,
                result.payload,
                conflictRecord,
                generation,
                conflictDurablyQueued,
              );
            } catch {
              restartAfterDrain = false;
              if (sessionTransitionRef.current.phase !== "ready") return;
              sessionTransitionRef.current = beginVaultSessionTransition(
                sessionTransitionRef.current,
                "closed",
              );
              sessionGenerationRef.current += 1;
              runtimeRef.current = null;
              vaultRef.current = null;
              bootstrapHeaderRef.current = null;
              conflictRef.current = null;
              revisionRef.current = 0;
              stagedSaveRef.current = null;
              pendingStageRef.current = null;
              setRuntime(null);
              setVault(null);
              setCodePairs({});
              setSetupLink("");
              setSecret("");
              setSaveConflict(null);
              setAuthError("Conflicting encrypted data could not be opened safely. The browser recovery remains intact; sign in again to retry.");
              setAuthStatus("access");
              void clearVaultResumeSession().catch(() => undefined);
              void logoutVault().catch(() => undefined);
            }
          } finally {
            conflictPendingRef.current = false;
          }
          return;
        }

        revisionRef.current = result.revision;
        savedVersionRef.current = Math.max(savedVersionRef.current, staged.version);
        if (stagedSaveRef.current?.version === staged.version) {
          stagedSaveRef.current = null;
          try {
            await clearVaultOutbox(record);
          } catch {
            // Exact ciphertext reconciliation clears a stale record on the next unlock.
          }
        }
      }

      if (
        generation === sessionGenerationRef.current &&
        restartAfterDrain &&
        !pendingStageRef.current &&
        !stagedSaveRef.current &&
        !conflictRef.current
      ) {
        setSaveStatus("saved");
        setSaveError(null);
      }
    })();
    const tracked = task.finally(() => {
      if (drainRef.current?.promise === tracked) drainRef.current = null;
      if (
        generation === sessionGenerationRef.current &&
        restartAfterDrain &&
        !lockingRef.current &&
        !conflictRef.current &&
        (pendingStageRef.current || stagedSaveRef.current)
      ) {
        window.queueMicrotask(() => {
          void stagePendingVaults()
            .then(() => flushVaultSavesRef.current())
            .catch(() => undefined);
        });
      }
    });
    drainRef.current = { generation, promise: tracked };
    return tracked;
  }, [attemptVaultSave, publishConflict, stagePendingVaults]);

  useEffect(() => {
    flushVaultSavesRef.current = flushVaultSaves;
  }, [flushVaultSaves]);

  const commitVault = useCallback((update: (current: PersistedVault) => PersistedVault): boolean => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      if (blockReason === "conflict" || blockReason === "conflict-pending") {
        setToast("Resolve the encrypted save conflict before making changes.");
      } else if (blockReason === "locking") {
        setToast("Vault locking is already in progress.");
      } else {
        setToast("Unlock your vault before changing settings.");
      }
      return false;
    }
    const current = vaultRef.current;
    if (!current || !runtimeRef.current) return false;
    const next = update(current);
    const version = mutationVersionRef.current + 1;
    mutationVersionRef.current = version;
    vaultRef.current = next;
    setVault(next);
    setSaveStatus("saving");
    setSaveError(null);
    pendingStageRef.current = {
      vault: next,
      version,
      generation: sessionGenerationRef.current,
    };
    touchOrRestoreResumeSession();
    void stagePendingVaults()
      .then(() => flushVaultSaves())
      .catch(() => undefined);
    return true;
  }, [flushVaultSaves, mutationBlockReason, stagePendingVaults, touchOrRestoreResumeSession]);

  const setAccounts = useCallback((update: Account[] | ((current: Account[]) => Account[])) => {
    return commitVault((current) => {
      const next = typeof update === "function" ? update(current.accounts) : update;
      return withVaultUpdate(current, { accounts: next });
    });
  }, [commitVault]);

  const setProfile = useCallback((patch: UserProfilePatch): boolean => {
    return commitVault((current) => withVaultUpdate(current, {
      profile: { ...current.profile, ...patch },
    }));
  }, [commitVault]);

  const updateSettings = useCallback((patch: Partial<PersistedVault["settings"]>) => {
    commitVault((current) => withVaultUpdate(current, {
      settings: { ...current.settings, ...patch },
    }));
  }, [commitVault]);

  const handleCreateAccount = useCallback(async (details: { name: string; email: string; password: string }) => {
    let transitionEpoch: number | null = null;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const activeTransitionEpoch = await beginOpeningSession();
      transitionEpoch = activeTransitionEpoch;
      const ensureSetupActive = () => {
        if (
          !isVaultSessionTransition(
            sessionTransitionRef.current,
            activeTransitionEpoch,
            "opening",
          )
        ) {
          throw new Error("Account creation was superseded by another session transition.");
        }
      };
      await prepareOpeningSession(activeTransitionEpoch);
      const initialVault = createEmptyVault({ name: details.name, email: details.email });
      const created = await createEncryptedVault(details.password, initialVault);
      ensureSetupActive();
      const authProof = await createAuthProof(created.runtime.authKey);
      ensureSetupActive();
      const result = await setupVault({
        identifier: details.email,
        authProof,
        header: created.header,
        payload: created.payloadCipher,
      });
      ensureSetupActive();
      await saveResumeSession(created.runtime, created.header);
      ensureSetupActive();
      await clearVaultOutbox(created.header.vaultId).catch(() => false);
      ensureSetupActive();
      publishReadySession({
        transitionEpoch: activeTransitionEpoch,
        generation: sessionGenerationRef.current + 1,
        revision: result.revision,
        mutationVersion: 0,
        savedVersion: 0,
        runtime: created.runtime,
        vault: initialVault,
        header: created.header,
        conflict: null,
        staged: null,
        saveStatus: "saved",
        saveError: null,
      });
    } catch (error) {
      const closedTransition = transitionEpoch === null
        ? null
        : completeVaultSessionTransition(
            sessionTransitionRef.current,
            transitionEpoch,
            "opening",
            "closed",
          );
      if (closedTransition) sessionTransitionRef.current = closedTransition;
      const message = error instanceof VaultApiError && (
        error.code === "account_exists" ||
        error.code === "already_configured"
      )
        ? "An account already uses this email. Sign in instead."
        : error instanceof VaultApiError && error.code === "legacy_claim_required"
          ? "Sign in to the existing encrypted vault before creating another account."
          : "The encrypted account could not be created. Check the server storage and try again.";
      if (closedTransition) setAuthError(message);
      throw error;
    } finally {
      setAuthBusy(false);
    }
  }, [beginOpeningSession, prepareOpeningSession, publishReadySession, saveResumeSession]);

  const openVaultRuntime = useCallback(async (
    nextRuntime: VaultRuntime,
    activeHeader: EncryptedVaultHeader,
    transitionEpoch: number,
    persistResumeBeforeReady = false,
    resumeLastActivityAt?: number,
    isAttemptActive?: () => boolean,
    loginIdentifier?: string,
  ): Promise<PersistedVault> => {
    await prepareOpeningSession(transitionEpoch);

    const ensureTransitionActive = () => {
      if (
        !isVaultSessionTransition(
          sessionTransitionRef.current,
          transitionEpoch,
          "opening",
        ) ||
        lockingRef.current ||
        lockPromiseRef.current ||
        (isAttemptActive && !isAttemptActive())
      ) {
        throw new Error("Vault opening was superseded by another session transition.");
      }
    };
    ensureTransitionActive();

    let authenticated = false;
    try {
      const authProof = await createAuthProof(nextRuntime.authKey);
      let result = await loginVault(authProof, loginIdentifier);
      authenticated = true;
      ensureTransitionActive();
      let serverVault = parsePersistedVault(
        await decryptVaultPayload<unknown>(result.payload, nextRuntime.vaultKey),
      );
      if (result.legacy) {
        ensureTransitionActive();
        const claimed = await claimLegacyVault(serverVault.profile.email);
        ensureTransitionActive();
        result = { ...result, revision: claimed.revision, legacy: false };
      }
      let nextVault = serverVault;
      let nextRevision = result.revision;
      let nextStatus: SaveStatus = "saved";
      let nextError: string | null = null;
      let nextConflict: VaultConflict | null = null;
      let staged: StagedVaultSave | null = null;
      const generation = sessionGenerationRef.current + 1;

      let outbox: VaultOutboxRecord | null = null;
      try {
        outbox = await readVaultOutbox(activeHeader.vaultId);
      } catch {
        nextStatus = "error";
        nextError = "Encrypted browser recovery could not be read. Server data was opened without replacing it.";
      }

      if (outbox) {
        let decision = classifyVaultOutbox(
          outbox,
          activeHeader.vaultId,
          result.revision,
          result.payload,
        );
        if (decision === "already-stored") {
          void clearVaultOutbox(outbox).catch(() => undefined);
        } else if (decision === "replay") {
          let localVault: PersistedVault | null = null;
          try {
            localVault = parsePersistedVault(
              await decryptVaultPayload<unknown>(outbox.payload, nextRuntime.vaultKey),
            );
          } catch {
            decision = "conflict";
          }
          if (decision === "replay" && localVault) {
            try {
              ensureTransitionActive();
              const saved = await saveVault(activeHeader.vaultId, outbox.baseRevision, outbox.payload);
              if (saved.revision !== outbox.baseRevision + 1) {
                throw new VaultApiError("The vault server returned an unexpected revision.", "invalid_response", 200);
              }
              nextVault = localVault;
              nextRevision = saved.revision;
              void clearVaultOutbox(outbox).catch(() => undefined);
            } catch (error) {
              if (error instanceof VaultApiError && error.code === "revision_conflict") {
                ensureTransitionActive();
                result = await loginVault(authProof);
                ensureTransitionActive();
                serverVault = parsePersistedVault(
                  await decryptVaultPayload<unknown>(result.payload, nextRuntime.vaultKey),
                );
                decision = classifyVaultOutbox(
                  outbox,
                  activeHeader.vaultId,
                  result.revision,
                  result.payload,
                );
                nextRevision = result.revision;
                if (decision === "already-stored") {
                  nextVault = serverVault;
                  void clearVaultOutbox(outbox).catch(() => undefined);
                } else if (decision === "replay") {
                  try {
                    ensureTransitionActive();
                    const saved = await saveVault(activeHeader.vaultId, outbox.baseRevision, outbox.payload);
                    if (saved.revision !== outbox.baseRevision + 1) {
                      throw new VaultApiError("The vault server returned an unexpected revision.", "invalid_response", 200);
                    }
                    nextVault = localVault;
                    nextRevision = saved.revision;
                    void clearVaultOutbox(outbox).catch(() => undefined);
                  } catch {
                    nextVault = localVault;
                    nextStatus = "error";
                    nextError = "Pending encrypted changes are open locally and will retry when the server is available.";
                    staged = { payload: outbox.payload, version: 1, generation, durablyQueued: true };
                  }
                }
              } else {
                nextVault = localVault;
                nextStatus = "error";
                nextError = "Pending encrypted changes are open locally and will retry when the server is available.";
                staged = { payload: outbox.payload, version: 1, generation, durablyQueued: true };
              }
            }
          }
        }

        if (decision === "conflict") {
          let localVault: PersistedVault | null = null;
          if (outbox.vaultId === activeHeader.vaultId) {
            try {
              localVault = parsePersistedVault(
                await decryptVaultPayload<unknown>(outbox.payload, nextRuntime.vaultKey),
              );
            } catch {
              // A foreign or damaged record can only be discarded explicitly.
            }
          }
          nextConflict = {
            localVault,
            localPayload: outbox.payload,
            serverVault,
            serverPayload: result.payload,
            serverRevision: result.revision,
            outbox,
          };
          nextVault = localVault ?? serverVault;
          nextRevision = result.revision;
          nextStatus = "conflict";
          nextError = localVault
            ? "This browser and the server both changed. Choose which encrypted version to keep."
            : "An unreadable browser recovery record conflicts with the server. Choose the server version to continue.";
          staged = { payload: outbox.payload, version: 1, generation, durablyQueued: true };
        }
      }

      if (resumeLastActivityAt !== undefined) {
        const now = Date.now();
        const inactivityLimit = nextVault.settings.autoLockMinutes * 60_000;
        if (
          !Number.isSafeInteger(resumeLastActivityAt) ||
          resumeLastActivityAt < 0 ||
          resumeLastActivityAt > now ||
          (inactivityLimit > 0 && now - resumeLastActivityAt >= inactivityLimit)
        ) {
          throw new Error("The resumable browser session exceeded its inactivity limit.");
        }
      }

      if (persistResumeBeforeReady) {
        ensureTransitionActive();
        await saveResumeSession(nextRuntime, activeHeader);
      }

      ensureTransitionActive();
      const mutationVersion = staged ? staged.version : 0;
      publishReadySession({
        transitionEpoch,
        generation,
        revision: nextRevision,
        mutationVersion,
        savedVersion: staged ? 0 : mutationVersion,
        runtime: nextRuntime,
        vault: nextVault,
        header: activeHeader,
        conflict: nextConflict,
        staged,
        saveStatus: nextStatus,
        saveError: nextError,
      });
      return nextVault;
    } catch (error) {
      const stillOwnsTransition = isVaultSessionTransition(
        sessionTransitionRef.current,
        transitionEpoch,
        "opening",
      );
      if (stillOwnsTransition) {
        const closedTransition = completeVaultSessionTransition(
          sessionTransitionRef.current,
          transitionEpoch,
          "opening",
          "closed",
        );
        if (closedTransition) sessionTransitionRef.current = closedTransition;
        runtimeRef.current = null;
        vaultRef.current = null;
      }
      if (authenticated && stillOwnsTransition) {
        try {
          await logoutVault();
        } catch {
          // The bounded request may fail, but no local key material is retained.
        }
      }
      throw error;
    }
  }, [prepareOpeningSession, publishReadySession, saveResumeSession]);

  const handleSignIn = useCallback(async (details: { email: string; password: string }) => {
    setAuthBusy(true);
    setAuthError(null);
    let transitionEpoch: number | null = null;
    try {
      transitionEpoch = await beginOpeningSession();
      const identified = await identifyVault(details.email);
      if (!isVaultSessionTransition(sessionTransitionRef.current, transitionEpoch, "opening")) {
        throw new Error("Sign-in was superseded by another session transition.");
      }
      if (!identified.configured) {
        throw new VaultApiError("Invalid email or password.", "invalid_credentials", 401);
      }
      const nextRuntime = await unlockVaultHeader(details.password, identified.header);
      await openVaultRuntime(
        nextRuntime,
        identified.header,
        transitionEpoch,
        true,
        undefined,
        undefined,
        details.email,
      );
    } catch (error) {
      const attemptStillCurrent =
        transitionEpoch !== null &&
        sessionTransitionRef.current.epoch === transitionEpoch;
      if (transitionEpoch !== null) {
        const closedTransition = completeVaultSessionTransition(
          sessionTransitionRef.current,
          transitionEpoch,
          "opening",
          "closed",
        );
        if (closedTransition) sessionTransitionRef.current = closedTransition;
      }
      const message = error instanceof VaultApiError && error.code === "rate_limited"
        ? error.message
        : error instanceof VaultApiError && [
            "legacy_claim_failed",
            "legacy_unavailable",
            "already_configured",
            "unauthorized",
            "corrupt_store",
          ].includes(error.code)
          ? "The existing encrypted vault could not be assigned to this account. No data was moved."
          : "The email or password is incorrect, or the encrypted vault could not be opened.";
      if (attemptStillCurrent) setAuthError(message);
      throw error;
    } finally {
      setAuthBusy(false);
    }
  }, [beginOpeningSession, openVaultRuntime]);

  const clearDeletedVaultSession = useCallback((vaultId: string): Promise<void> => {
    if (bootstrapHeaderRef.current?.vaultId !== vaultId) {
      return clearVaultOutbox(vaultId).then(
        () => undefined,
        () => undefined,
      );
    }

    const pendingWork = [
      stagingPromiseRef.current,
      drainRef.current?.promise ?? null,
      resumeSavePromiseRef.current,
      lockPromiseRef.current,
    ].filter((task): task is Promise<void> => Boolean(task));
    const cleanupEpoch = beginSessionTransition("locking");
    const shouldClearClipboard = vaultRef.current?.settings.clearClipboard === true;

    lockingRef.current = true;
    lockPromiseRef.current = null;
    conflictPendingRef.current = false;
    conflictBusyRef.current = false;
    sessionGenerationRef.current += 1;
    pendingStageRef.current = null;
    stagedSaveRef.current = null;
    stagingPromiseRef.current = null;
    drainRef.current = null;
    resumeSavePromiseRef.current = null;
    runtimeRef.current = null;
    vaultRef.current = null;
    bootstrapHeaderRef.current = null;
    conflictRef.current = null;
    revisionRef.current = 0;
    mutationVersionRef.current = 0;
    savedVersionRef.current = 0;
    resumeAvailableRef.current = false;
    resumeAbsoluteExpiresAtRef.current = 0;
    lastResumeRetryAtRef.current = 0;
    lastResumeTouchAtRef.current = 0;
    lastActivityAtRef.current = null;
    hiddenLockArmedRef.current = false;

    const firstResumeCleanup = clearVaultResumeSession().then(
      () => true,
      () => false,
    );
    const firstOutboxCleanup = clearVaultOutbox(vaultId).then(
      () => true,
      () => false,
    );

    setAuthStatus("locking");
    setAuthBusy(false);
    setRuntime(null);
    setVault(null);
    setSaveConflict(null);
    setConflictBusy(false);
    setSaveStatus("saved");
    setSaveError(null);
    setCodePairs({});
    setQuery("");
    setGroup("All");
    setView("all");
    setToast(null);
    setAddOpen(false);
    setAddMode("qr");
    setAccountMenuId(null);
    setEditingAccountId(null);
    setAccountEditorReturnFocusTo(null);
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    setCustomizingGroup(null);
    setGroupCustomizationReturnFocusTo(null);
    setSetupLink("");
    setService("");
    setIdentity("");
    setSecret("");
    setNewGroup("Personal");
    setNewAlgorithm("SHA-1");
    setNewDigits(6);
    setNewPeriod(30);
    setFormError("");
    for (const timeout of clipboardClearTimersRef.current) window.clearTimeout(timeout);
    clipboardClearTimersRef.current.clear();
    if (shouldClearClipboard) {
      try {
        void navigator.clipboard.writeText("").catch(() => undefined);
      } catch {
        // Clipboard cleanup remains best-effort after account deletion.
      }
    }

    const ownsCleanupTransition = () => isVaultSessionTransition(
      sessionTransitionRef.current,
      cleanupEpoch,
      "locking",
    );
    const task = Promise.resolve().then(async () => {
      const pendingSettled = pendingWork.length === 0
        ? { status: "fulfilled" } as const
        : await settleWithin(Promise.allSettled(pendingWork), ACCOUNT_DELETION_CLEANUP_MS);
      const [resumeCleanedInitially, outboxCleanedInitially] = await Promise.all([
        firstResumeCleanup,
        firstOutboxCleanup,
      ]);
      const [resumeCleanedFinally, outboxCleanedFinally] = await Promise.all([
        clearVaultResumeSession().then(() => true, () => false),
        clearVaultOutbox(vaultId).then(() => true, () => false),
      ]);
      if (!ownsCleanupTransition()) return;

      const cleanupConfirmed =
        pendingSettled.status === "fulfilled" &&
        resumeCleanedInitially &&
        outboxCleanedInitially &&
        resumeCleanedFinally &&
        outboxCleanedFinally;
      const closedTransition = completeVaultSessionTransition(
        sessionTransitionRef.current,
        cleanupEpoch,
        "locking",
        "closed",
      );
      if (!closedTransition) return;
      sessionTransitionRef.current = closedTransition;
      setAuthError(cleanupConfirmed
        ? null
        : "The account was deleted, but browser cleanup could not be confirmed. Close this tab before leaving this device.");
      setAuthStatus("access");
    });
    const tracked = task.finally(() => {
      if (lockPromiseRef.current === tracked) {
        lockingRef.current = false;
        lockPromiseRef.current = null;
      }
    });
    lockPromiseRef.current = tracked;
    return tracked;
  }, [beginSessionTransition]);

  const deleteOwnAccount = useCallback(async (password: string): Promise<void> => {
    const header = bootstrapHeaderRef.current;
    const transition = sessionTransitionRef.current;
    const generation = sessionGenerationRef.current;
    if (
      !header ||
      !runtimeRef.current ||
      !vaultRef.current ||
      transition.phase !== "ready"
    ) {
      throw new Error("Unlock your vault again before deleting this account.");
    }

    let freshRuntime: VaultRuntime;
    try {
      freshRuntime = await unlockVaultHeader(password, header);
    } catch (error) {
      if (error instanceof VaultCryptoError && error.code === "AUTHENTICATION_FAILED") {
        throw new Error("The current password is incorrect.");
      }
      throw new Error("The current password could not be verified.");
    }
    if (
      sessionGenerationRef.current !== generation ||
      sessionTransitionRef.current.epoch !== transition.epoch ||
      sessionTransitionRef.current.phase !== "ready" ||
      bootstrapHeaderRef.current !== header
    ) {
      throw new Error("The vault session changed. Unlock it again before deleting this account.");
    }

    const authProof = await createAuthProof(freshRuntime.authKey);
    if (
      sessionGenerationRef.current !== generation ||
      sessionTransitionRef.current.epoch !== transition.epoch ||
      sessionTransitionRef.current.phase !== "ready" ||
      bootstrapHeaderRef.current !== header
    ) {
      throw new Error("The vault session changed. Unlock it again before deleting this account.");
    }

    try {
      await deleteVaultAccount(header.vaultId, authProof);
    } catch (error) {
      if (error instanceof VaultApiError && error.code === "invalid_credentials") {
        throw new Error("The current password is incorrect.");
      }
      if (error instanceof VaultApiError && error.code === "rate_limited") {
        throw new Error(error.message);
      }
      if (error instanceof VaultApiError && error.code === "unauthorized") {
        throw new Error("The vault session expired. Sign in again before deleting this account.");
      }
      if (error instanceof VaultApiError && (
        error.code === "request_timeout" ||
        error.code === "network_error"
      )) {
        throw new Error("Account deletion could not be confirmed. Check the connection and try again.");
      }
      throw new Error("The encrypted account could not be deleted. No local data was cleared.");
    }

    const localCleanup = clearDeletedVaultSession(header.vaultId);
    try {
      const channel = new BroadcastChannel(ACCOUNT_EVENT_CHANNEL_NAME);
      channel.postMessage({ type: "account-deleted", vaultId: header.vaultId });
      channel.close();
    } catch {
      // Cross-tab cleanup is best-effort; this tab still clears itself below.
    }
    await localCleanup;
  }, [clearDeletedVaultSession]);

  const lockVault = useCallback((): Promise<void> => {
    const currentTransition = sessionTransitionRef.current;
    const pendingLock = lockPromiseRef.current;
    if (currentTransition.phase === "locking" && pendingLock) return pendingLock;
    if (
      currentTransition.phase !== "ready" &&
      currentTransition.phase !== "locking"
    ) {
      return pendingLock ?? Promise.resolve();
    }

    // Ready is authoritative. Any promise/flag that survived outside a locking
    // phase is stale and must not turn the visible Lock button into a no-op.
    lockPromiseRef.current = null;
    lockingRef.current = false;
    const lockEpoch = beginSessionTransition("locking");
    lockingRef.current = true;
    conflictPendingRef.current = false;
    const resumeSaveAtLock = resumeSavePromiseRef.current;
    // The cleanup attempts to remove the sessionStorage capability before its
    // first await; the result is verified before the locked screen is finalized.
    const resumeClearTask = clearVaultResumeSession().then(
      () => true,
      () => false,
    );
    resumeAvailableRef.current = false;
    resumeAbsoluteExpiresAtRef.current = 0;
    lastResumeRetryAtRef.current = 0;
    lastResumeTouchAtRef.current = 0;
    setAuthStatus("locking");
    setCodePairs({});
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    for (const timeout of clipboardClearTimersRef.current) window.clearTimeout(timeout);
    clipboardClearTimersRef.current.clear();
    if (vaultRef.current?.settings.clearClipboard) {
      try {
        void navigator.clipboard.writeText("").catch(() => undefined);
      } catch {
        // Clipboard access is best-effort while locking.
      }
    }
    setSetupLink("");
    setService("");
    setIdentity("");
    setSecret("");
    setNewGroup("Personal");
    setNewAlgorithm("SHA-1");
    setNewDigits(6);
    setNewPeriod(30);
    setFormError("");
    setAddOpen(false);
    setAccountMenuId(null);
    setEditingAccountId(null);
    setAccountEditorReturnFocusTo(null);
    setCustomizingGroup(null);
    setGroupCustomizationReturnFocusTo(null);

    const ownsLockTransition = () =>
      isVaultSessionTransition(
        sessionTransitionRef.current,
        lockEpoch,
        "locking",
      );
    const task = Promise.resolve().then(async () => {
      if (!ownsLockTransition()) return;
      const generation = sessionGenerationRef.current;
      let preservationUnconfirmed = false;
      const currentVault = vaultRef.current;
      if (
        currentVault &&
        runtimeRef.current &&
        !conflictRef.current &&
        mutationVersionRef.current > savedVersionRef.current
      ) {
        pendingStageRef.current = {
          vault: currentVault,
          version: mutationVersionRef.current,
          generation,
        };
      }
      try {
        await stagePendingVaults();
      } catch {
        // Local locking still wins; an existing encrypted outbox is left untouched.
      }
      if (!ownsLockTransition()) return;

      let latestStaged = stagedSaveRef.current;
      if (
        latestStaged?.generation === generation &&
        !latestStaged.durablyQueued &&
        !conflictRef.current
      ) {
        const deadline = Date.now() + LOCK_SAVE_GRACE_MS;
        const activeDrain = drainRef.current;
        if (activeDrain?.generation === generation) {
          await settleWithin(activeDrain.promise, Math.max(0, deadline - Date.now()));
          if (!ownsLockTransition()) return;
        }
        latestStaged = stagedSaveRef.current;
        if (
          latestStaged?.generation === generation &&
          !latestStaged.durablyQueued &&
          !conflictRef.current &&
          Date.now() < deadline
        ) {
          const expectedRevision = revisionRef.current;
          const directSave = await settleWithin(
            attemptVaultSave(latestStaged.payload, expectedRevision, generation),
            Math.max(0, deadline - Date.now()),
          );
          if (!ownsLockTransition()) return;
          if (
            directSave.status === "fulfilled" &&
            directSave.value.kind === "saved"
          ) {
            revisionRef.current = directSave.value.revision;
            savedVersionRef.current = Math.max(
              savedVersionRef.current,
              latestStaged.version,
            );
            if (stagedSaveRef.current === latestStaged) stagedSaveRef.current = null;
          }
        }
      }
      latestStaged = stagedSaveRef.current;
      preservationUnconfirmed = Boolean(
        (latestStaged?.generation === generation && !latestStaged.durablyQueued) ||
        pendingStageRef.current?.generation === generation,
      );
      if (!ownsLockTransition()) return;
      sessionGenerationRef.current += 1;
      pendingStageRef.current = null;
      stagedSaveRef.current = null;
      runtimeRef.current = null;
      vaultRef.current = null;
      bootstrapHeaderRef.current = null;
      conflictRef.current = null;
      revisionRef.current = 0;
      setRuntime(null);
      setVault(null);
      setSaveConflict(null);
      conflictBusyRef.current = false;
      setConflictBusy(false);
      setView("all");
      setGroup("All");
      setQuery("");
      setSaveStatus("saved");
      setSaveError(null);
      const resumeClearResult = await settleWithin(resumeClearTask, 5_500);
      if (!ownsLockTransition()) return;
      const resumeClearUnconfirmed =
        resumeClearResult.status !== "fulfilled" || !resumeClearResult.value;
      if (resumeSaveAtLock) {
        await settleWithin(resumeSaveAtLock, 5_500);
        if (!ownsLockTransition()) return;
        if (resumeSavePromiseRef.current === resumeSaveAtLock) {
          resumeSavePromiseRef.current = null;
        }
      }
      setAuthError(
        preservationUnconfirmed
          ? "Coffer locked securely, but the latest change could not be confirmed in encrypted browser storage or on the server. Unlock to verify your vault."
          : resumeClearUnconfirmed
            ? "Coffer locked and cleared its live keys, but browser session cleanup could not be confirmed. Close this tab before leaving this device."
          : null,
      );

      try {
        await logoutVault();
      } catch {
        // Local key material is cleared even if the bounded logout request fails.
      }
      if (!ownsLockTransition()) return;
      const closedTransition = completeVaultSessionTransition(
        sessionTransitionRef.current,
        lockEpoch,
        "locking",
        "closed",
      );
      if (!closedTransition) return;
      sessionTransitionRef.current = closedTransition;
      setAuthStatus("access");
    });
    const tracked = task.finally(() => {
      if (lockPromiseRef.current === tracked) {
        lockingRef.current = false;
        lockPromiseRef.current = null;
      }
    });
    lockPromiseRef.current = tracked;
    return tracked;
  }, [attemptVaultSave, beginSessionTransition, stagePendingVaults]);

  const chooseServerConflictVersion = useCallback(async () => {
    const conflict = conflictRef.current;
    const transitionEpoch = sessionTransitionRef.current.epoch;
    const generation = sessionGenerationRef.current;
    if (
      !conflict ||
      conflictBusyRef.current ||
      !isVaultSessionTransition(
        sessionTransitionRef.current,
        transitionEpoch,
        "ready",
      )
    ) {
      return;
    }
    conflictBusyRef.current = true;
    setConflictBusy(true);
    try {
      const cleared = await clearVaultOutbox(conflict.outbox);
      if (
        generation !== sessionGenerationRef.current ||
        !isVaultSessionTransition(
          sessionTransitionRef.current,
          transitionEpoch,
          "ready",
        ) ||
        conflictRef.current !== conflict
      ) {
        return;
      }
      if (!cleared) {
        throw new Error("The encrypted recovery record changed while resolving the conflict.");
      }
      conflictRef.current = null;
      stagedSaveRef.current = null;
      pendingStageRef.current = null;
      revisionRef.current = conflict.serverRevision;
      mutationVersionRef.current = 0;
      savedVersionRef.current = 0;
      vaultRef.current = conflict.serverVault;
      setVault(conflict.serverVault);
      setGroup((currentGroup) => currentGroup !== "All" && !conflict.serverVault.accounts.some(
        (account) => !account.archived && account.group === currentGroup,
      ) ? "All" : currentGroup);
      setSaveConflict(null);
      setSaveStatus("saved");
      setSaveError(null);
      setToast("The server version is now open. Browser changes were discarded.");
    } catch {
      setSaveStatus("conflict");
      setSaveError("The encrypted recovery record could not be cleared. No version was discarded.");
    } finally {
      if (sessionTransitionRef.current.epoch === transitionEpoch) {
        conflictBusyRef.current = false;
        setConflictBusy(false);
      }
    }
  }, []);

  const keepBrowserConflictVersion = useCallback(async () => {
    const conflict = conflictRef.current;
    const generation = sessionGenerationRef.current;
    const transitionEpoch = sessionTransitionRef.current.epoch;
    if (
      !conflict?.localVault ||
      conflictBusyRef.current ||
      !isVaultSessionTransition(
        sessionTransitionRef.current,
        transitionEpoch,
        "ready",
      )
    ) {
      return;
    }
    conflictBusyRef.current = true;
    setConflictBusy(true);
    setSaveStatus("saving");
    setSaveError(null);
    const rebasedOutbox = createVaultOutboxRecord(
      bootstrapHeaderRef.current?.vaultId ?? conflict.outbox.vaultId,
      conflict.serverRevision,
      conflict.localPayload,
    );
    try {
      await writeVaultOutbox(rebasedOutbox);
      const result = await attemptVaultSave(
        conflict.localPayload,
        conflict.serverRevision,
        generation,
      );
      if (generation !== sessionGenerationRef.current) return;
      if (result.kind === "conflict") {
        const activeRuntime = runtimeRef.current;
        if (!activeRuntime) return;
        const latestServerVault = parsePersistedVault(
          await decryptVaultPayload<unknown>(result.payload, activeRuntime.vaultKey),
        );
        const nextConflict: VaultConflict = {
          ...conflict,
          serverVault: latestServerVault,
          serverPayload: result.payload,
          serverRevision: result.revision,
          outbox: rebasedOutbox,
        };
        conflictRef.current = nextConflict;
        revisionRef.current = result.revision;
        setSaveConflict(nextConflict);
        setSaveStatus("conflict");
        setSaveError("The server changed again while resolving this conflict. Review and choose again.");
        return;
      }

      revisionRef.current = result.revision;
      savedVersionRef.current = mutationVersionRef.current;
      stagedSaveRef.current = null;
      pendingStageRef.current = null;
      conflictRef.current = null;
      await clearVaultOutbox(rebasedOutbox).catch(() => false);
      setSaveConflict(null);
      setSaveStatus("saved");
      setSaveError(null);
      setToast("This browser's encrypted changes are now saved as the latest version.");
    } catch (error) {
      if (generation !== sessionGenerationRef.current) return;
      setSaveStatus("conflict");
      setSaveError(
        error instanceof VaultApiError && error.code === "request_timeout"
          ? "Conflict resolution timed out. The encrypted browser version remains available."
          : "This browser's encrypted version could not be saved. No version was discarded.",
      );
    } finally {
      if (sessionTransitionRef.current.epoch === transitionEpoch) {
        conflictBusyRef.current = false;
        setConflictBusy(false);
      }
    }
  }, [attemptVaultSave]);

  useEffect(() => {
    let active = true;
    let ownedTransitionEpoch: number | null = null;
    void (async () => {
      try {
        const bootstrap = await getVaultBootstrap();
        if (!active) return;
        if (!bootstrap.authenticated) {
          bootstrapHeaderRef.current = null;
          revisionRef.current = 0;
          void clearVaultResumeSession().catch(() => undefined);
          setAuthError(null);
          setAuthStatus("access");
          return;
        }

        revisionRef.current = bootstrap.revision;
        bootstrapHeaderRef.current = bootstrap.header;

        let resumed: Awaited<ReturnType<typeof readVaultResumeSession>> = null;
        try {
          resumed = await readVaultResumeSession(bootstrap.header.vaultId);
        } catch {
          void clearVaultResumeSession().catch(() => undefined);
        }
        if (!active) return;

        if (resumed) {
          try {
            const transitionEpoch = await beginOpeningSession();
            ownedTransitionEpoch = transitionEpoch;
            if (!active) {
              const closedTransition = completeVaultSessionTransition(
                sessionTransitionRef.current,
                transitionEpoch,
                "opening",
                "closed",
              );
              if (closedTransition) sessionTransitionRef.current = closedTransition;
              return;
            }
            await openVaultRuntime(
              resumed.runtime,
              bootstrap.header,
              transitionEpoch,
              false,
              resumed.lastActivityAt,
              () => active,
            );
            if (!active) return;
            resumeAvailableRef.current = true;
            resumeAbsoluteExpiresAtRef.current = resumed.absoluteExpiresAt;
            touchVaultResumeSession(bootstrap.header.vaultId);
            return;
          } catch {
            void clearVaultResumeSession().catch(() => undefined);
            runtimeRef.current = null;
            vaultRef.current = null;
            setRuntime(null);
            setVault(null);
          }
        }

        if (!active) return;
        setAuthError(null);
        setAuthStatus("access");
      } catch {
        if (!active) return;
        setAuthError("Coffer could not reach its encrypted vault storage. Reload after checking the server.");
        setAuthStatus("loading");
      }
    })();
    return () => {
      active = false;
      if (
        ownedTransitionEpoch !== null &&
        isVaultSessionTransition(
          sessionTransitionRef.current,
          ownedTransitionEpoch,
          "opening",
        )
      ) {
        const closedTransition = completeVaultSessionTransition(
          sessionTransitionRef.current,
          ownedTransitionEpoch,
          "opening",
          "closed",
        );
        if (closedTransition) sessionTransitionRef.current = closedTransition;
      }
    };
  }, [beginOpeningSession, openVaultRuntime]);

  useEffect(() => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(ACCOUNT_EVENT_CHANNEL_NAME);
    } catch {
      return;
    }
    const handleAccountEvent = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        !("vaultId" in message) ||
        message.type !== "account-deleted" ||
        typeof message.vaultId !== "string" ||
        bootstrapHeaderRef.current?.vaultId !== message.vaultId
      ) {
        return;
      }
      void clearDeletedVaultSession(message.vaultId);
    };
    channel.addEventListener("message", handleAccountEvent);
    return () => {
      channel.removeEventListener("message", handleAccountEvent);
      channel.close();
    };
  }, [clearDeletedVaultSession]);

  useEffect(() => {
    const retry = () => {
      if (!lockingRef.current && !conflictRef.current && stagedSaveRef.current) {
        void flushVaultSaves();
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [flushVaultSaves]);

  useEffect(() => {
    const protectUnstagedChange = (event: BeforeUnloadEvent) => {
      const staged = stagedSaveRef.current;
      const encryptedRecoveryPending = Boolean(
        pendingStageRef.current ||
        stagingPromiseRef.current ||
        (staged && !staged.durablyQueued),
      );
      if (!encryptedRecoveryPending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnstagedChange);
    return () => window.removeEventListener("beforeunload", protectUnstagedChange);
  }, []);

  useEffect(() => {
    const initialTick = window.setTimeout(() => setTick(Date.now()), 0);
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    lastActivityAtRef.current = signedIn ? performance.now() : null;
    hiddenLockArmedRef.current = signedIn && !document.hidden;
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;

    let timeout = 0;
    const now = () => performance.now();

    const evaluateDeadline = () => {
      window.clearTimeout(timeout);
      const current = now();
      const lastActivity = lastActivityAtRef.current ?? current;
      lastActivityAtRef.current ??= current;
      const remaining = remainingAutoLockMs(lastActivity, current, autoLockMinutes);
      if (remaining === null) return;
      if (remaining <= 0) {
        void lockVault();
        return;
      }
      timeout = window.setTimeout(evaluateDeadline, remaining);
    };

    const recordActivity = () => {
      const current = now();
      const previous = lastActivityAtRef.current ?? current;
      const remaining = remainingAutoLockMs(previous, current, autoLockMinutes);
      if (remaining !== null && remaining <= 0) {
        void lockVault();
        return;
      }
      lastActivityAtRef.current = current;
      touchOrRestoreResumeSession();
      evaluateDeadline();
    };

    const handleVisibility = () => {
      const transition = hiddenLockTransition(
        hiddenLockArmedRef.current,
        document.hidden,
        lockWhenHidden,
      );
      hiddenLockArmedRef.current = transition.armed;
      if (!document.hidden) {
        // Becoming visible does not count as activity. Re-check the original
        // deadline so time spent hidden contributes to inactivity.
        evaluateDeadline();
        return;
      }
      if (transition.shouldLock) {
        void lockVault();
        return;
      }
      evaluateDeadline();
    };

    // Do not treat an unlock that happens while browser tooling temporarily
    // marks the document hidden as a user-requested hidden-tab lock. The rule
    // arms after this session has actually been visible once.
    evaluateDeadline();
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("pointermove", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("pointermove", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [autoLockMinutes, lockVault, lockWhenHidden, signedIn, touchOrRestoreResumeSession]);

  const accountCodeConfigurationKey = accounts.map(totpConfigKey).join("|");
  const codeWindowKey = accounts
    .map((account) => `${totpConfigKey(account)}:${totpWindow(tick, account.period).counter}`)
    .join("|");

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const sessionGeneration = sessionGenerationRef.current;
    const generatedAt = Date.now();
    Promise.all(accounts.map(async (account) => {
      const window = totpWindow(generatedAt, account.period);
      const [current, next] = await Promise.all([
        generateTotp(account.secret, window.currentTimestamp, account.digits, account.period, account.algorithm),
        generateTotp(account.secret, window.nextTimestamp, account.digits, account.period, account.algorithm),
      ]);
      return [account.id, {
        counter: window.counter,
        configKey: totpConfigKey(account),
        current: formatCode(current),
        next: formatCode(next),
      }] as const;
    }))
      .then((entries) => {
        if (
          !active ||
          sessionGeneration !== sessionGenerationRef.current ||
          sessionTransitionRef.current.phase !== "ready" ||
          vaultRef.current?.accounts.map(totpConfigKey).join("|") !== accountCodeConfigurationKey
        ) return;
        setCodePairs(Object.fromEntries(entries));
      })
      .catch(() => {
        if (
          active &&
          sessionGeneration === sessionGenerationRef.current &&
          sessionTransitionRef.current.phase === "ready"
        ) setToast("A code could not be generated.");
      });
    return () => { active = false; };
  }, [accountCodeConfigurationKey, accounts, codeWindowKey, signedIn]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const isSearchShortcut = ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !isTyping);
      if (isSearchShortcut && document.querySelector('[aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        setAddOpen(false);
        setAccountMenuId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const restorePreference = window.setTimeout(() => setCardView(readCardViewPreference()), 0);
    const syncPreference = (event: StorageEvent) => {
      if (event.key === CARD_VIEW_STORAGE_KEY) setCardView(parseCardView(event.newValue));
    };
    window.addEventListener("storage", syncPreference);
    return () => {
      window.clearTimeout(restorePreference);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!addOpen) return;
    const dialog = addDialogRef.current;
    if (!dialog) return;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const animationFrame = window.requestAnimationFrame(() => {
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(focusableSelector) ?? dialog).focus();
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", trapFocus);
      addTriggerRef.current?.focus();
    };
  }, [addOpen]);

  const counts = useMemo(() => Object.fromEntries(groups.map((name) => [name, accounts.filter((account) => account.group === name && !account.archived).length])), [accounts, groups]);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesView = view === "favorites" ? account.favorite && !account.archived : view === "archive" ? account.archived : !account.archived;
      const matchesGroup = group === "All" || account.group === group;
      const matchesQuery = !normalizedQuery || `${account.service} ${account.identity} ${account.group}`.toLowerCase().includes(normalizedQuery);
      return matchesView && matchesGroup && matchesQuery;
    });
  }, [accounts, group, query, view]);

  const selectableVisibleIds = useMemo(
    () => visibleAccounts.map((account) => account.id),
    [visibleAccounts],
  );
  const selectableVisibleIdSet = useMemo(() => new Set(selectableVisibleIds), [selectableVisibleIds]);
  const selectedVisibleAccountIds = useMemo(
    () => new Set([...selectedAccountIds].filter((id) => selectableVisibleIdSet.has(id))),
    [selectableVisibleIdSet, selectedAccountIds],
  );
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every(
    (id) => selectedVisibleAccountIds.has(id),
  );
  const allSelectedFavorited = selectedVisibleAccountIds.size > 0 && accounts.every(
    (account) => !selectedVisibleAccountIds.has(account.id) || account.favorite,
  );

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
  };

  const toggleAccountSelection = (id: string) => {
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginGroupCustomization = (name: string, trigger: HTMLElement) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Resolve the encrypted save conflict before customizing groups.");
      return;
    }
    if (blockReason) {
      setToast("Unlock your vault before customizing groups.");
      return;
    }
    if (!groups.includes(name)) {
      setToast("This group is no longer available.");
      return;
    }
    setGroupCustomizationReturnFocusTo(trigger);
    setCustomizingGroup(name);
  };

  const closeGroupCustomization = () => {
    setCustomizingGroup(null);
    setGroupCustomizationReturnFocusTo(null);
  };

  const saveGroupCustomization = (nextCustomization: VaultGroupCustomization) => {
    if (!customizingGroup) return false;
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Resolve the encrypted save conflict before customizing groups.");
      return false;
    }
    if (blockReason) {
      setToast("Unlock your vault before customizing groups.");
      return false;
    }

    const normalized = normalizeGroupName(nextCustomization.name);
    const normalizedKey = groupKey(normalized);
    if (!normalized || normalized.length > 48 || normalizedKey === "all") {
      setToast("Use a group name between 1 and 48 characters. “All” is reserved.");
      return false;
    }
    const duplicate = groups.some(
      (name) => name !== customizingGroup && groupKey(name) === normalizedKey,
    );
    if (duplicate) {
      setToast("That group already exists.");
      return false;
    }

    const previousName = customizingGroup;
    const saved = commitVault((current) => {
      if (!current.accounts.some((account) => account.group === previousName)) {
        throw new Error("This group is no longer available.");
      }
      const previousKey = groupKey(previousName);
      const nextGroupCustomizations = current.groupCustomizations.filter((customization) => (
        groupKey(customization.name) !== previousKey && groupKey(customization.name) !== normalizedKey
      ));
      return withVaultUpdate(current, {
        accounts: current.accounts.map((account) => (
          account.group === previousName ? { ...account, group: normalized } : account
        )),
        groupCustomizations: [...nextGroupCustomizations, {
          name: normalized,
          icon: nextCustomization.icon,
          color: nextCustomization.color,
        }],
      });
    });
    if (!saved) return false;

    if (group === previousName) setGroup(normalized);
    closeGroupCustomization();
    if (normalized !== previousName) {
      window.requestAnimationFrame(() => {
        const nextButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".group-nav-main"))
          .find((button) => button.dataset.groupName === normalized);
        nextButton?.focus({ preventScroll: true });
      });
    }
    setToast(normalized === previousName
      ? `${normalized} appearance updated.`
      : `${previousName} updated to ${normalized}.`);
    return true;
  };

  const moveSelectedAccounts = (requestedGroup: string, createGroup: boolean) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before moving accounts."
        : "Unlock your vault before moving accounts.");
      return false;
    }
    if (selectedVisibleAccountIds.size === 0) {
      setToast("Select at least one account to move.");
      return false;
    }

    const normalized = normalizeGroupName(requestedGroup);
    const normalizedKey = normalized.toLocaleLowerCase("en");
    if (!normalized || normalized.length > 48 || normalizedKey === "all") {
      setToast("Use a group name between 1 and 48 characters. “All” is reserved.");
      return false;
    }
    const existing = groups.find(
      (name) => normalizeGroupName(name).toLocaleLowerCase("en") === normalizedKey,
    );
    if (createGroup && existing) {
      setToast("That group already exists. Choose it from the existing groups list.");
      return false;
    }
    if (!createGroup && !existing) {
      setToast("Choose an existing group.");
      return false;
    }

    const targetGroup = existing ?? normalized;
    const selected = new Set(selectedVisibleAccountIds);
    const movedCount = selected.size;
    setAccounts((current) => current.map((account) =>
      selected.has(account.id) && !account.archived
        ? { ...account, group: targetGroup }
        : account,
    ));
    setView("all");
    setGroup(targetGroup);
    exitSelectionMode();
    setToast(`${movedCount} ${movedCount === 1 ? "account" : "accounts"} moved to ${targetGroup}.`);
    return true;
  };

  const setSelectedAccountsFavorite = (favorite: boolean) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before managing favorites."
        : "Unlock your vault before managing favorites.");
      return false;
    }
    if (selectedVisibleAccountIds.size === 0) {
      setToast("Select at least one account to manage favorites.");
      return false;
    }

    const selected = new Set(selectedVisibleAccountIds);
    let changedCount = 0;
    const saved = setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || account.archived || account.favorite === favorite) {
        return account;
      }
      changedCount += 1;
      return { ...account, favorite };
    }));
    if (!saved) return false;

    setToast(changedCount === 0
      ? `Selected accounts are already ${favorite ? "in Favorites" : "not in Favorites"}.`
      : `${changedCount} ${changedCount === 1 ? "account" : "accounts"} ${favorite ? "added to" : "removed from"} Favorites.`);
    return true;
  };

  const archiveSelectedAccounts = () => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before archiving accounts."
        : "Unlock your vault before archiving accounts.");
      return false;
    }
    if (selectedVisibleAccountIds.size === 0) {
      setToast("Select at least one account to archive.");
      return false;
    }

    const selected = new Set(selectedVisibleAccountIds);
    let archivedCount = 0;
    const saved = setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || account.archived) return account;
      archivedCount += 1;
      return { ...account, archived: true };
    }));
    if (!saved) return false;

    exitSelectionMode();
    setToast(`${archivedCount} ${archivedCount === 1 ? "account" : "accounts"} moved to Archive.`);
    return true;
  };

  const restoreSelectedArchivedAccounts = () => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before restoring accounts."
        : "Unlock your vault before restoring accounts.");
      return false;
    }
    if (selectedVisibleAccountIds.size === 0) {
      setToast("Select at least one account to restore.");
      return false;
    }

    const selected = new Set(selectedVisibleAccountIds);
    let restoredCount = 0;
    const saved = setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || !account.archived) return account;
      restoredCount += 1;
      return { ...account, archived: false };
    }));
    if (!saved) return false;

    exitSelectionMode();
    setToast(`${restoredCount} ${restoredCount === 1 ? "account" : "accounts"} restored to All codes.`);
    return true;
  };

  const deleteSelectedArchivedAccounts = () => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before deleting accounts."
        : "Unlock your vault before deleting accounts.");
      return false;
    }

    const selected = new Set(selectedVisibleAccountIds);
    const archivedSelectedCount = accounts.filter(
      (account) => selected.has(account.id) && account.archived,
    ).length;
    if (archivedSelectedCount === 0) {
      setToast("Select at least one archived account to delete.");
      return false;
    }

    const confirmed = window.confirm(
      `Permanently delete ${archivedSelectedCount} selected ${archivedSelectedCount === 1 ? "account" : "accounts"}?\n\nThis removes the selected accounts and their authenticator secrets from the encrypted vault. This action cannot be undone.`,
    );
    if (!confirmed) return false;

    const saved = setAccounts((current) => current.filter(
      (account) => !selected.has(account.id) || !account.archived,
    ));
    if (!saved) return false;

    exitSelectionMode();
    setToast(`${archivedSelectedCount} ${archivedSelectedCount === 1 ? "account was" : "accounts were"} permanently deleted from the encrypted vault.`);
    return true;
  };

  const copyCode = async (account: Account) => {
    if (locked) {
      setToast("Unlock your vault to copy a code.");
      return;
    }
    const sessionGeneration = sessionGenerationRef.current;
    let code: string;
    try {
      code = await generateTotp(account.secret, Date.now(), account.digits, account.period, account.algorithm);
    } catch {
      setToast("This code could not be generated.");
      return;
    }
    const currentAccount = vaultRef.current?.accounts.find((candidate) => candidate.id === account.id);
    if (
      sessionGeneration !== sessionGenerationRef.current ||
      sessionTransitionRef.current.phase !== "ready" ||
      !currentAccount ||
      currentAccount.secret !== account.secret ||
      currentAccount.algorithm !== account.algorithm ||
      currentAccount.digits !== account.digits ||
      currentAccount.period !== account.period
    ) return;
    try {
      await navigator.clipboard.writeText(code);
      if (
        sessionGeneration !== sessionGenerationRef.current ||
        sessionTransitionRef.current.phase !== "ready"
      ) {
        try {
          if (await navigator.clipboard.readText() === code) await navigator.clipboard.writeText("");
        } catch {
          // Clipboard cleanup is best-effort when the vault locks during a write.
        }
        return;
      }
      navigator.vibrate?.(10);
      setToast(`${account.service} code copied.`);
      if (clearClipboard) {
        const clipboardTimeout = window.setTimeout(async () => {
          try {
            if (await navigator.clipboard.readText() === code) await navigator.clipboard.writeText("");
          } catch {
            // Clipboard clearing is best-effort and may be blocked by browser permissions.
          } finally {
            clipboardClearTimersRef.current.delete(clipboardTimeout);
          }
        }, 30_000);
        clipboardClearTimersRef.current.add(clipboardTimeout);
      }
    } catch {
      setToast("Clipboard access is unavailable.");
    }
  };

  const toggleFavorite = (id: string) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Resolve the encrypted save conflict before making changes.");
      return;
    }
    if (blockReason || locked) {
      setToast("Unlock your vault to manage accounts.");
      return;
    }
    setAccounts((current) => current.map((account) => account.id === id ? { ...account, favorite: !account.favorite } : account));
  };

  const toggleArchive = (id: string) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setAccountMenuId(null);
      setToast("Resolve the encrypted save conflict before making changes.");
      return;
    }
    if (blockReason || locked) {
      setAccountMenuId(null);
      setToast("Unlock your vault to manage accounts.");
      return;
    }
    const target = accounts.find((account) => account.id === id);
    if (!target) return;
    setAccounts((current) => current.map((account) => account.id === id ? { ...account, archived: !account.archived } : account));
    setAccountMenuId(null);
    setToast(target.archived ? `${target.service} restored to All codes.` : `${target.service} moved to Archive.`);
  };

  const restoreAllArchivedAccounts = () => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setAccountMenuId(null);
      setToast("Resolve the encrypted save conflict before restoring accounts.");
      return;
    }
    if (blockReason || locked) {
      setAccountMenuId(null);
      setToast("Unlock your vault before restoring accounts.");
      return;
    }

    let restoredCount = 0;
    const saved = setAccounts((current) => current.map((account) => {
      if (!account.archived) return account;
      restoredCount += 1;
      return { ...account, archived: false };
    }));
    if (!saved) return;

    setAccountMenuId(null);
    setToast(`${restoredCount} ${restoredCount === 1 ? "account" : "accounts"} restored to All codes.`);
  };

  const deleteArchivedAccount = (id: string) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setAccountMenuId(null);
      setToast("Resolve the encrypted save conflict before making changes.");
      return;
    }
    if (blockReason || locked) {
      setAccountMenuId(null);
      setToast("Unlock your vault to manage accounts.");
      return;
    }

    const target = accounts.find((account) => account.id === id);
    setAccountMenuId(null);
    if (!target) {
      setToast("This archived account is no longer available.");
      return;
    }
    if (!target.archived) {
      setToast("Move this account to Archive before deleting it permanently.");
      return;
    }

    const saved = setAccounts((current) => current.filter((account) => account.id !== id || !account.archived));
    if (!saved) return;
    setToast(`${target.service} was permanently deleted from the encrypted vault.`);
  };

  const openAccountEditor = (id: string, trigger: HTMLButtonElement) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setAccountMenuId(null);
      setToast("Resolve the encrypted save conflict before editing accounts.");
      return;
    }
    if (blockReason || locked) {
      setAccountMenuId(null);
      setToast("Unlock your vault before editing accounts.");
      return;
    }
    if (!accounts.some((account) => account.id === id)) {
      setAccountMenuId(null);
      setToast("This account is no longer available.");
      return;
    }
    setAccountEditorReturnFocusTo(trigger);
    setEditingAccountId(id);
  };

  const saveAccountEdits = (id: string, patch: EditableAccountPatch) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      throw new Error("Resolve the encrypted save conflict before editing accounts.");
    }
    if (blockReason || locked) throw new Error("Unlock your vault before editing accounts.");
    const target = accounts.find((account) => account.id === id);
    if (!target) throw new Error("This account is no longer available.");
    const saved = setAccounts((current) => current.map((account) => account.id === id ? { ...account, ...patch } : account));
    if (!saved) throw new Error("The account could not be updated while the vault is changing state.");
    setToast(`${patch.service} updated in the encrypted vault.`);
  };

  const importAccounts = (decisions: ImportDecision[]) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Export is available, but imports are paused until the save conflict is resolved.");
      return;
    }
    if (blockReason) {
      setToast("Unlock your vault before importing accounts.");
      return;
    }
    const palette: Account["color"][] = ["violet", "green", "blue", "orange", "ink"];
    setAccounts((current) => {
      let next = [...current];
      for (const decision of decisions) {
        const replacedAccount = decision.replaceAccountId
          ? next.find((existing) => existing.id === decision.replaceAccountId)
          : undefined;
        if (decision.replaceAccountId) {
          next = next.filter((existing) => existing.id !== decision.replaceAccountId);
        }
        const importedIconBrand = Object.hasOwn(decision.account, "iconBrand")
          ? decision.account.iconBrand ?? null
          : replacedAccount?.iconBrand ?? null;
        const importedIconDataUrl = Object.hasOwn(decision.account, "iconDataUrl")
          ? decision.account.iconDataUrl ?? null
          : replacedAccount?.iconDataUrl ?? null;
        const imported: Account = {
          ...decision.account,
          id: crypto.randomUUID(),
          iconBrand: importedIconDataUrl ? null : importedIconBrand,
          iconDataUrl: importedIconDataUrl,
          color: palette[next.length % palette.length],
          letter: initials(decision.account.service),
          lastUsed: 0,
          algorithm: decision.account.algorithm ?? "SHA-1",
          digits: decision.account.digits ?? 6,
          period: decision.account.period ?? 30,
        };
        next.unshift(imported);
      }
      return next;
    });
    setToast(`${decisions.length} ${decisions.length === 1 ? "account" : "accounts"} added to the encrypted vault.`);
  };

  const applySetupLink = (value: string) => {
    setFormError("");
    try {
      const parsed = parseOtpAuthUri(value);
      setSetupLink(value);
      setService(parsed.issuer || "Imported account");
      setIdentity(parsed.account);
      setSecret(parsed.secret);
      setNewAlgorithm(parsed.algorithm);
      setNewDigits(parsed.digits);
      setNewPeriod(parsed.period);
      setAddMode("manual");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "That setup link could not be read.");
    }
  };

  const parseLink = () => applySetupLink(setupLink);

  const resetForm = () => {
    setSetupLink("");
    setService("");
    setIdentity("");
    setSecret("");
    setNewGroup("Personal");
    setNewAlgorithm("SHA-1");
    setNewDigits(6);
    setNewPeriod(30);
    setFormError("");
    setAddMode("qr");
  };

  const closeAdd = () => {
    setAddOpen(false);
    resetForm();
  };

  const openAdd = () => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Resolve the encrypted save conflict before adding an account.");
      return;
    }
    if (blockReason) {
      setToast("Unlock your vault before adding an account.");
      return;
    }
    addTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    addOriginViewRef.current = view;
    resetForm();
    setAddOpen(true);
  };

  const addAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setFormError("Resolve the encrypted save conflict before adding an account.");
      return;
    }
    if (blockReason) {
      setFormError("Unlock your vault before adding an account.");
      return;
    }
    setFormError("");
    if (!service.trim() || !identity.trim()) {
      setFormError("Add a service and account name.");
      return;
    }
    if (!isValidBase32(secret)) {
      setFormError("Enter a valid Base32 secret with at least 16 characters.");
      return;
    }

    const addToFavorites = addOriginViewRef.current === "favorites";
    setAccounts((current) => [{
      id: crypto.randomUUID(),
      service: service.trim(),
      identity: identity.trim(),
      secret: normalizeSecret(secret),
      group: newGroup,
      color: ADD_ACCOUNT_PALETTE[current.length % ADD_ACCOUNT_PALETTE.length],
      letter: initials(service.trim()),
      favorite: addToFavorites,
      archived: false,
      lastUsed: 0,
      algorithm: newAlgorithm,
      digits: newDigits,
      period: newPeriod,
      iconBrand: null,
      iconDataUrl: null,
    }, ...current]);
    setView(addToFavorites ? "favorites" : "all");
    setGroup("All");
    setQuery("");
    setToast(addToFavorites
      ? `${service.trim()} added to Favorites.`
      : `${service.trim()} added to the encrypted vault.`);
    closeAdd();
  };

  if (!signedIn) {
    return (
      <SignInScreen
        status={authStatus === "access" ? "access" : authStatus === "locking" ? "locking" : "loading"}
        busy={authBusy}
        error={authError}
        onCreateAccount={handleCreateAccount}
        onSignIn={handleSignIn}
      />
    );
  }

  const bulkGroupActions = (
    <BulkGroupActions
      active={selectionMode}
      selectedCount={selectedVisibleAccountIds.size}
      visibleCount={selectableVisibleIds.length}
      allVisibleSelected={allVisibleSelected}
      allSelectedFavorited={allSelectedFavorited}
      groups={groups}
      onBeginSelection={() => {
        setAccountMenuId(null);
        setSelectionMode(true);
      }}
      onSelectAllVisible={() => setSelectedAccountIds(new Set(selectableVisibleIds))}
      onClearSelection={() => setSelectedAccountIds(new Set())}
      onExitSelection={exitSelectionMode}
      onSetFavorite={setSelectedAccountsFavorite}
      onArchive={archiveSelectedAccounts}
      onMoveToGroup={(groupName) => moveSelectedAccounts(groupName, false)}
      onCreateGroupAndMove={(groupName) => moveSelectedAccounts(groupName, true)}
    />
  );

  const archiveBulkActions = (
    <ArchiveBulkActions
      active={selectionMode}
      selectedCount={selectedVisibleAccountIds.size}
      visibleCount={selectableVisibleIds.length}
      allVisibleSelected={allVisibleSelected}
      onBeginSelection={() => {
        setAccountMenuId(null);
        setSelectionMode(true);
      }}
      onSelectAllVisible={() => setSelectedAccountIds(new Set(selectableVisibleIds))}
      onClearSelection={() => setSelectedAccountIds(new Set())}
      onExitSelection={exitSelectionMode}
      onRestore={restoreSelectedArchivedAccounts}
      onDelete={deleteSelectedArchivedAccounts}
    />
  );

  return (
    <main className={`app-shell theme-${theme} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" id="primary-sidebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-controls="primary-sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span aria-hidden="true" />
        </button>

        <div className="brand"><span className="brand-mark" aria-hidden="true">C</span><span className="brand-name">Coffer</span></div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <button title="All codes" className={`nav-item ${view === "all" ? "active" : ""}`} onClick={() => { setView("all"); setGroup("All"); }}><span className="nav-icon grid-icon" aria-hidden="true" />All codes<span className="nav-count">{accounts.filter((account) => !account.archived).length}</span></button>
          <button title="Favorites" className={`nav-item ${view === "favorites" ? "active" : ""}`} onClick={() => { setView("favorites"); setGroup("All"); }}><span className="nav-icon star-icon" aria-hidden="true">✦</span>Favorites<span className="nav-count">{accounts.filter((account) => account.favorite && !account.archived).length}</span></button>
          <button title="Archive" className={`nav-item ${view === "archive" ? "active" : ""}`} onClick={() => { exitSelectionMode(); setView("archive"); setGroup("All"); }}><span className="nav-icon trash-icon" aria-hidden="true" />Archive<span className="nav-count">{accounts.filter((account) => account.archived).length}</span></button>
          <button title="Data and backup" className={`nav-item ${view === "transfer" ? "active" : ""}`} onClick={() => { exitSelectionMode(); setView("transfer"); }}><span className="nav-icon transfer-icon" aria-hidden="true" />Data &amp; backup</button>
          <button title="Settings" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => { exitSelectionMode(); setView("settings"); }}><span className="nav-icon settings-icon" aria-hidden="true" />Settings</button>
        </nav>

        <div className="sidebar-label">Groups</div>
        <nav className="group-nav" aria-label="Account groups">
          {groups.map((name) => {
            const customization = customizationForGroup(name);
            const active = view === "all" && group === name;
            return (
              <div
                key={name}
                className={`group-nav-row ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="group-nav-main"
                  data-group-name={name}
                  aria-pressed={active}
                  title={`Open ${name}. Right-click or press F2 to customize.`}
                  onClick={() => { setGroup(name); setView("all"); }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    beginGroupCustomization(name, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "F2" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      beginGroupCustomization(name, event.currentTarget);
                    }
                  }}
                >
                  <span
                    className="group-symbol"
                    data-icon={customization.icon}
                    data-color={customization.color}
                    aria-hidden="true"
                  />
                  <span className="group-name">{name}</span>
                  <span className="group-count">{counts[name]}</span>
                </button>
                <button
                  type="button"
                  className="group-options-button more-button"
                  onClick={(event) => beginGroupCustomization(name, event.currentTarget)}
                  aria-haspopup="dialog"
                  aria-label={`Customize ${name} group`}
                  title={`Customize ${name} group`}
                >
                  <span aria-hidden="true">•••</span>
                </button>
              </div>
            );
          })}
        </nav>

        <button className="profile-row" onClick={() => { exitSelectionMode(); setView("settings"); }} aria-label="Open profile and settings" title="Open profile and settings">
          <span className={`avatar${profile.avatarDataUrl ? " has-photo" : ""}`}>
            {profile.avatarDataUrl
              ? <img src={profile.avatarDataUrl} alt="" /> // eslint-disable-line @next/next/no-img-element -- encrypted data URLs cannot use the image optimizer
              : profileInitials(profile.name)}
          </span>
          <span className="profile-copy"><strong>{profile.name}</strong><small>{profile.email}</small></span>
          <span aria-hidden="true">•••</span>
        </button>
      </aside>

      <section className="workspace" id="codes">
        <header className="topbar">
          <label className="search">
            <span className="search-icon" aria-hidden="true" />
            <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by service, account, or group…" aria-label="Search authenticator accounts" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <button
              type="button"
              className={`sync-state ${saveStatus}`}
              onClick={() => saveStatus === "error" && stagedSaveRef.current && !conflictRef.current && void flushVaultSaves()}
              title={saveError ?? "Vault data is encrypted before it is saved"}
              disabled={saveStatus === "saving" || saveStatus === "conflict"}
            ><i /> {saveStatus === "saving" ? "Saving encrypted vault…" : saveStatus === "conflict" ? "Save conflict" : saveStatus === "error" ? "Save failed · Retry" : "Encrypted vault saved"}</button>
            <button
              type="button"
              className="icon-button lock-button"
              onClick={() => void lockVault()}
              aria-label="Lock vault"
            ><span /></button>
            <ThemeToggle theme={theme} onToggle={() => updateSettings({ theme: theme === "dark" ? "light" : "dark" })} />
          </div>
        </header>

        {saveConflict && (
          <section className="vault-conflict-panel transfer-error" role="alert" aria-live="assertive">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Choose which encrypted vault version to keep</strong>
              <p>
                {saveConflict.localVault
                  ? "This browser has pending changes, while the server has a newer version. Nothing will be overwritten until you choose. Export a backup first if you want to preserve a portable copy."
                  : "The browser recovery record cannot be opened with this vault. Keep the server version to discard only that unreadable local record."}
              </p>
              {saveError && <small>{saveError}</small>}
            </div>
            <div className="vault-conflict-actions">
              <button className="modal-secondary" type="button" onClick={() => setView("transfer")} disabled={conflictBusy}>Open data &amp; backup</button>
              <button className="modal-secondary" type="button" onClick={() => void chooseServerConflictVersion()} disabled={conflictBusy}>Use server version</button>
              <button className="modal-primary" type="button" onClick={() => void keepBrowserConflictVersion()} disabled={conflictBusy || !saveConflict.localVault}>{conflictBusy ? "Resolving…" : "Keep this browser's changes"}</button>
            </div>
          </section>
        )}

        {view === "transfer" ? (
          <TransferCenter
            accounts={accounts}
            locked={false}
            onBack={() => setView("all")}
            onImport={importAccounts}
            onNotice={setToast}
          />
        ) : view === "settings" ? (
          <SettingsCenter
            profile={profile}
            autoLockMinutes={autoLockMinutes}
            lockWhenHidden={lockWhenHidden}
            clearClipboard={clearClipboard}
            onProfileChange={setProfile}
            onAutoLockMinutesChange={(minutes) => updateSettings({ autoLockMinutes: minutes })}
            onLockWhenHiddenChange={(enabled) => updateSettings({ lockWhenHidden: enabled })}
            onClearClipboardChange={(enabled) => updateSettings({ clearClipboard: enabled })}
            onNotice={setToast}
            onLockVault={() => void lockVault()}
            onSignOut={() => void lockVault()}
            onDeleteAccount={deleteOwnAccount}
          />
        ) : (
        <div className="content">
          {view !== "archive" && !selectionMode && (
            <div className="title-row title-row-actions-only">
              <div className="title-row-account-actions">
                <CardViewMenu
                  value={cardView}
                  onChange={(nextView) => {
                    setCardView(nextView);
                    writeCardViewPreference(nextView);
                  }}
                  onOpen={() => setAccountMenuId(null)}
                />
                <button type="button" className="add-button" onClick={openAdd}><span>+</span> Add account</button>
                {selectableVisibleIds.length > 0 && bulkGroupActions}
              </div>
            </div>
          )}

          {view === "archive" && !selectionMode && accounts.some((account) => account.archived) && (
            <div className="title-row title-row-actions-only">
              <div className="title-row-account-actions">
                <button type="button" className="add-button restore-all-button" onClick={restoreAllArchivedAccounts}>
                  <span aria-hidden="true">&#8634;</span>
                  Restore all codes
                </button>
              </div>
            </div>
          )}

          {view === "archive" ? (
            <>
              <section className="archive-explainer" aria-label="About Archive">
                <span className="archive-explainer-icon" aria-hidden="true"><span className="nav-icon trash-icon" /></span>
                <div><strong>Hidden, not deleted</strong><p>Archived accounts stay encrypted and keep generating codes until you restore them.</p></div>
                <span>{accounts.filter((account) => account.archived).length} archived</span>
              </section>
              {selectableVisibleIds.length > 0 && archiveBulkActions}
            </>
          ) : query.trim() ? <p className="result-count" role="status">{visibleAccounts.length} {visibleAccounts.length === 1 ? "account" : "accounts"}</p> : null}

          {view !== "archive" && selectionMode && bulkGroupActions}

          {visibleAccounts.length > 0 ? (
            <section className="account-grid" data-card-view={cardView} aria-label="Authenticator accounts">
              {visibleAccounts.map((account) => {
                const { current: currentCode, next: nextCode, remaining } = accountCodePreview(
                  account,
                  tick,
                  codePairs[account.id],
                );
                const revealNextCode = !locked && isTotpExpiring(remaining);
                const selected = selectedVisibleAccountIds.has(account.id);
                const accessibleCurrentCode = currentCode?.replace(/\s/gu, "").split("").join(" ");
                return <article className={`account-card ${account.archived ? "archived-card" : ""} ${selectionMode ? "selection-mode" : ""} ${selected ? "selected" : ""}`} key={account.id}>
                  {selectionMode && (
                    <button
                      type="button"
                      className="account-selection-surface"
                      onClick={() => toggleAccountSelection(account.id)}
                      aria-label={`${selected ? "Deselect" : "Select"} ${account.service} ${account.identity}`}
                      aria-pressed={selected}
                    />
                  )}
                  <div className="account-topline">
                    <ServiceLogo
                      service={account.service}
                      fallback={account.letter}
                      color={account.color}
                      brandId={isServiceBrandId(account.iconBrand) ? account.iconBrand : null}
                      iconDataUrl={account.iconDataUrl}
                    />
                    <div className="service-meta"><h2>{account.service}</h2><OverflowingIdentity text={account.identity} /></div>
                    {selectionMode ? (
                      <AccountSelectionIndicator selected={selected} />
                    ) : (
                      <div className="account-card-actions">
                        {account.archived && <span className="archived-badge">Archived</span>}
                        {!account.archived && <button className={`favorite ${account.favorite ? "selected" : ""}`} onClick={() => toggleFavorite(account.id)} aria-label={`${account.favorite ? "Remove" : "Add"} ${account.service} ${account.favorite ? "from" : "to"} favorites`}>✦</button>}
                        <div className="account-menu-wrap" onBlur={(event) => {
                          if (editingAccountId !== account.id && !event.currentTarget.contains(event.relatedTarget)) {
                            setAccountMenuId(null);
                          }
                        }}>
                          <button className="more-button" aria-haspopup="menu" aria-expanded={accountMenuId === account.id} onClick={() => setAccountMenuId((current) => current === account.id ? null : account.id)} aria-label={`Open ${account.service} options`}>•••</button>
                          {accountMenuId === account.id && (
                            <div className="account-menu" role="menu">
                              <button role="menuitem" onClick={(event) => openAccountEditor(account.id, event.currentTarget)}>Edit account</button>
                              {!account.archived && <button role="menuitem" onClick={() => toggleFavorite(account.id)}>{account.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>}
                              {!account.archived && <button role="menuitem" onClick={() => toggleArchive(account.id)}>Move to Archive</button>}
                              {account.archived && <button className="danger" role="menuitem" onClick={() => deleteArchivedAccount(account.id)}>Delete permanently</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="code-row">
                    <div className="code-stack">
                      {selectionMode ? (
                        <span className={`code selection-code ${revealNextCode ? "expiring-code" : ""}`} aria-hidden="true"><span className="code-value">{locked ? "••• •••" : currentCode ?? "--- ---"}</span></span>
                      ) : (
                        <button
                          className={`code ${revealNextCode ? "expiring-code" : ""}`}
                          onClick={() => copyCode(account)}
                          aria-label={accessibleCurrentCode ? `Copy ${account.service} ${account.identity} code ${accessibleCurrentCode}` : `Copy ${account.service} ${account.identity} code when ready`}
                        ><span className="code-value" aria-hidden="true">{locked ? "••• •••" : currentCode ?? "--- ---"}</span></button>
                      )}
                      <div className={`next-code ${revealNextCode ? "visible" : ""}`} aria-hidden={selectionMode || !revealNextCode ? true : undefined}>
                        <span className="visually-hidden">{locked ? "Next code hidden" : nextCode ? `Next code ${nextCode.replace(/\s/gu, "").split("").join(" ")}` : "Next code loading"}</span>
                        <span className="next-code-label" aria-hidden="true">Next</span>
                        <span className="next-code-value" aria-hidden="true">{locked ? "••• •••" : nextCode ?? "--- ---"}</span>
                      </div>
                    </div>
                    <div className={`countdown ${revealNextCode ? "urgent" : ""}`} style={{ "--progress": `${(remaining / account.period) * 360}deg` } as React.CSSProperties}><span>{locked ? "—" : remaining}</span></div>
                  </div>
                </article>;
              })}

              {view !== "archive" && !selectionMode && <button className="add-card" onClick={openAdd} aria-label="Add a new authenticator account">
                <span className="add-card-icon">+</span><strong>Add a new account</strong><small>Scan a QR code, paste a setup link, or enter a secret</small>
              </button>}
            </section>
          ) : (
            <section className="empty-state">
              <div className="empty-rings"><span /><span /><span /></div>
              <h2>{view === "archive" ? query.trim() ? "No archived accounts found" : "Archive is empty" : "No codes found"}</h2>
              <p>{view === "archive" ? query.trim() ? "Try a different search." : "Accounts you archive will appear here." : "Try another search or add a new authenticator account."}</p>
              {view === "archive" ? <button onClick={() => { if (query.trim()) setQuery(""); else setView("all"); }}>{query.trim() ? "Clear search" : "Back to all codes"}</button> : <button onClick={openAdd}>Add account</button>}
            </section>
          )}
        </div>
        )}
      </section>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && closeAdd()}>
          <section ref={addDialogRef} className="add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" tabIndex={-1}>
            <div className="modal-head">
              <div><p>NEW AUTHENTICATOR</p><h2 id="add-title">Add an account</h2></div>
              <button onClick={closeAdd} aria-label="Close add account dialog">×</button>
            </div>

            <div className="mode-switch account-input-modes" aria-label="Account input method">
              <button data-autofocus className={addMode === "qr" ? "active" : ""} onClick={() => { setAddMode("qr"); setFormError(""); }}>Scan QR</button>
              <button className={addMode === "link" ? "active" : ""} onClick={() => { setAddMode("link"); setFormError(""); }}>Setup link</button>
              <button className={addMode === "manual" ? "active" : ""} onClick={() => { setAddMode("manual"); setFormError(""); }}>Manual entry</button>
            </div>

            {addMode === "qr" ? (
              <div className="qr-panel">
                <QrScanner onDetected={applySetupLink} onFallback={() => { setAddMode("link"); setFormError(""); }} />
                {formError && <p className="form-error" role="alert">{formError}</p>}
              </div>
            ) : addMode === "link" ? (
              <div className="link-panel">
                <div className="scan-motif"><span /><span /><span /></div>
                <h3>Paste your setup link</h3>
                <p>Use the <code>otpauth://</code> link from your service. It is parsed only in this browser.</p>
                <label><span>Setup link</span><textarea value={setupLink} onChange={(event) => setSetupLink(event.target.value)} placeholder="otpauth://totp/Service:account…" /></label>
                {formError && <p className="form-error" role="alert">{formError}</p>}
                <button className="modal-primary" onClick={parseLink} disabled={!setupLink.trim()}>Review account <span>→</span></button>
                <button className="text-button" onClick={() => setAddMode("manual")}>I only have the secret key</button>
              </div>
            ) : (
              <form className="manual-form" onSubmit={addAccount}>
                <div className="field-row">
                  <label>
                    <span>Service</span>
                    <div className="service-entry-control">
                      <ServiceLogo
                        service={service}
                        fallback={service.trim() ? initials(service) : "?"}
                        color={ADD_ACCOUNT_PALETTE[accounts.length % ADD_ACCOUNT_PALETTE.length]}
                      />
                      <input className="service-entry-input" value={service} onChange={(event) => setService(event.target.value)} placeholder="e.g. GitHub" />
                    </div>
                  </label>
                  <label><span>Group</span><select value={newGroup} onChange={(event) => setNewGroup(event.target.value as Group)}>{entryGroups.map((name) => <option key={name}>{name}</option>)}</select></label>
                </div>
                <label><span>Account name</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="name@example.com" /></label>
                <label><span>Base32 secret</span><input className="secret-input" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="JBSW Y3DP EHPK 3PXP" autoComplete="off" spellCheck={false} /><small>Encrypted in this browser before the vault is saved.</small></label>
                <div className="field-row advanced-fields">
                  <label><span>Algorithm</span><select value={newAlgorithm} onChange={(event) => setNewAlgorithm(event.target.value as TotpAlgorithm)}><option>SHA-1</option><option>SHA-256</option><option>SHA-512</option></select></label>
                  <label><span>Digits</span><select value={newDigits} onChange={(event) => setNewDigits(Number(event.target.value) as 6 | 8)}><option value="6">6 digits</option><option value="8">8 digits</option></select></label>
                  <label><span>Period</span><select value={newPeriod} onChange={(event) => setNewPeriod(Number(event.target.value))}><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label>
                </div>
                {formError && <p className="form-error" role="alert">{formError}</p>}
                <div className="modal-actions"><button type="button" className="modal-secondary" onClick={closeAdd}>Cancel</button><button className="modal-primary" type="submit">Add account <span>→</span></button></div>
              </form>
            )}
          </section>
        </div>
      )}

      <GroupCustomizationDialog
        open={Boolean(customizingGroup)}
        group={activeGroupCustomization}
        existingNames={groups}
        onCancel={closeGroupCustomization}
        onSave={saveGroupCustomization}
        returnFocusTo={groupCustomizationReturnFocusTo}
      />

      <AccountEditor
        account={editingAccount}
        brandOptions={ACCOUNT_ICON_OPTIONS}
        codePreview={editingCodePreview}
        onClose={() => {
          setEditingAccountId(null);
          setAccountEditorReturnFocusTo(null);
        }}
        onSave={saveAccountEdits}
        returnFocusTo={accountEditorReturnFocusTo}
        renderIcon={({ color, iconBrand, iconDataUrl, letter, service: previewService }) => (
          <ServiceLogo
            color={color}
            fallback={initials(previewService) || letter}
            service={previewService}
            brandId={isServiceBrandId(iconBrand) ? iconBrand : null}
            iconDataUrl={iconDataUrl}
          />
        )}
      />

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite"><span className="toast-check">✓</span>{toast}</div>
    </main>
  );
}
