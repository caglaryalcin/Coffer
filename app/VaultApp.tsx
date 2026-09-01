"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from "react";
import AccountEditor, { type AccountEditorCodePreview, type AccountIconOption } from "./AccountEditor";
import BulkGroupActions, { AccountSelectionIndicator, ArchiveBulkActions, mouseIsOutsideAccountCodeRow, normalizeGroupName } from "./BulkGroupActions";
import BulkLogoPicker, { retainedAccountIconBytes, type BulkAccountLogoPatch } from "./BulkLogoPicker";
import CardViewMenu, { CARD_VIEW_STORAGE_KEY, parseCardView, readCardViewPreference, writeCardViewPreference, type CardView } from "./CardViewMenu";
import GroupCustomizationDialog from "./GroupCustomizationDialog";
import OverflowingIdentity from "./OverflowingIdentity";
import ProfileMenu from "./ProfileMenu";
import QrScanner from "./QrScanner";
import ServiceLogo, { COFFER_INITIALS_BRAND_ID, isServiceBrandId, selfhstServiceBrandOptions, serviceBrandById, serviceBrandFor, serviceBrandIds } from "./ServiceLogo";
import SidebarFooter from "./SidebarFooter";
import SettingsCenter, { type UserProfile, type UserProfilePatch } from "./SettingsCenter";
import SignInScreen from "./SignInScreen";
import ThemeToggle from "./ThemeToggle";
import TransferCenter, { type ImportDecision } from "./TransferCenter";
import { formatCode, generateTotp, isTotpExpiring, isValidBase32, normalizeSecret, parseOtpAuthUri, totpWindow, type TotpAlgorithm } from "../lib/totp";
import { changeVaultPassword, claimLegacyVault, deleteVaultAccount, getVaultBootstrap, identifyVault, loginVault, logoutVault, saveVault, setupVault, updateInstanceSettings, VAULT_API_TIMEOUT_MS, VaultApiError, type VaultInstanceSettings } from "../lib/vault-api";
import { createAuthProof, createEncryptedVault, DEFAULT_VAULT_RESUME_AGE_MS, decryptVaultPayload, encryptVaultPayload, REMEMBERED_VAULT_RESUME_AGE_MS, rotateVaultPassword, unlockVaultHeader, VaultCryptoError, type EncryptedVaultHeader, type VaultPayloadCipher, type VaultRuntime } from "../lib/vault-crypto";
import { createEmptyVault, MAX_GROUP_CUSTOMIZATIONS, parsePersistedVault, withVaultUpdate, type PersistedVault, type VaultAccount, type VaultGroupColor, type VaultGroupCustomization, type VaultGroupIcon, type VaultMainScreen, type VaultTheme } from "../lib/vault-model";
import { classifyVaultOutbox, clearVaultOutbox, createVaultOutboxRecord, readVaultOutbox, writeVaultOutbox, type VaultOutboxRecord } from "../lib/vault-outbox";
import { clearVaultResumeSession, readRememberedVaultResumeHint, readVaultResumeSession, saveVaultResumeSession, touchVaultResumeSession, type VaultResumePersistence } from "../lib/vault-resume";
import { remainingAutoLockMs } from "../lib/auto-lock";
import type { EditableAccountPatch } from "../lib/account-editor";
import { reorderVisibleAccounts, type AccountDropEdge } from "../lib/account-order";
import { appendGroupToOrder, mergeVisibleGroupOrder, moveGroupName, orderedVisibleGroupNames, removeGroupFromOrder, renameGroupInOrder, type GroupDropEdge } from "../lib/group-order";
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
type VaultAccessDetails = { email: string; password: string; rememberLogin: boolean };
type VaultCreateAccountDetails = VaultAccessDetails & { name: string };
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
type GroupDropTarget = { name: string; edge: GroupDropEdge };
type AccountDropTarget = { id: string; edge: AccountDropEdge; axis: "horizontal" | "vertical" };
type SidebarMenuTarget = { kind: "all" } | { kind: "group"; name: string };

function resumePersistenceForRememberLogin(rememberLogin: boolean): VaultResumePersistence {
  return rememberLogin ? "remembered" : "session";
}

function resumeTtlForPersistence(persistence: VaultResumePersistence): number {
  return persistence === "remembered"
    ? REMEMBERED_VAULT_RESUME_AGE_MS
    : DEFAULT_VAULT_RESUME_AGE_MS;
}
type SidebarMenuPosition = { top: number; left: number };
const EMPTY_ACCOUNTS: Account[] = [];
const ADD_ACCOUNT_PALETTE: Account["color"][] = ["violet", "green", "blue", "orange"];
const CATALOG_ACCOUNT_ICON_OPTIONS = serviceBrandIds.flatMap((id) => {
  const brand = serviceBrandById(id);
  if (!brand) return [];
  return [{
    id,
    label: brand.title,
    description: brand.variantLabel,
    familyId: brand.familyId,
    searchTerms: brand.searchTerms,
    variantOrder: brand.variantOrder,
  }];
}).sort((left, right) => (
  left.label.localeCompare(right.label, "en") || left.variantOrder - right.variantOrder
));
const ACCOUNT_ICON_LABEL_COUNTS = new Map<string, number>();
for (const option of CATALOG_ACCOUNT_ICON_OPTIONS) {
  const key = option.label.normalize("NFKC").trim().toLocaleLowerCase("en");
  ACCOUNT_ICON_LABEL_COUNTS.set(key, (ACCOUNT_ICON_LABEL_COUNTS.get(key) ?? 0) + 1);
}
const ACCOUNT_ICON_OPTIONS = [
  {
    id: COFFER_INITIALS_BRAND_ID,
    label: "Initials",
    description: "Colored letter tile",
    familyId: COFFER_INITIALS_BRAND_ID,
    searchTerms: ["initials", "letters", "colored tile"],
    variantOrder: 0,
  },
  ...CATALOG_ACCOUNT_ICON_OPTIONS.map((option) => {
    const key = option.label.normalize("NFKC").trim().toLocaleLowerCase("en");
    return ACCOUNT_ICON_LABEL_COUNTS.get(key) === 1
      ? option
      : { ...option, description: `${option.description} · ${option.id}` };
  }),
];
const SELECTED_ACCOUNT_DRAG_TYPE = "application/x-coffer-selected-accounts";
const GROUP_REORDER_DRAG_TYPE = "application/x-coffer-group-order";
const LOCK_SAVE_GRACE_MS = VAULT_API_TIMEOUT_MS + 750;
const RESUME_ACTIVITY_WRITE_INTERVAL_MS = 1_000;
const ACCOUNT_EVENT_CHANNEL_NAME = "coffer-account-events-v1";
const ACCOUNT_DELETION_CLEANUP_MS = VAULT_API_TIMEOUT_MS + 6_000;

function accountDropPlacement(event: ReactDragEvent<HTMLElement>): Pick<AccountDropTarget, "edge" | "axis"> {
  const bounds = event.currentTarget.getBoundingClientRect();
  const grid = event.currentTarget.closest(".account-grid");
  const gridColumns = grid instanceof HTMLElement
    ? window.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/u).filter(Boolean).length
    : 1;
  const axis: AccountDropTarget["axis"] = gridColumns > 1 ? "horizontal" : "vertical";
  const before = axis === "horizontal"
    ? event.clientX < bounds.left + (bounds.width / 2)
    : event.clientY < bounds.top + (bounds.height / 2);
  return { axis, edge: before ? "before" : "after" };
}

function normalizedServiceName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}

function commonLogoSuggestion(
  accounts: readonly Pick<Account, "id" | "service">[],
  selectedIds: ReadonlySet<string>,
): string | null {
  const selected = accounts.filter((account) => selectedIds.has(account.id));
  if (selected.length === 0) return null;

  const firstService = selected[0].service.trim();
  const normalizedFirstService = normalizedServiceName(firstService);
  if (normalizedFirstService && selected.every(
    (account) => normalizedServiceName(account.service) === normalizedFirstService,
  )) return firstService;

  const resolved = selected.map((account) => {
    const brandId = serviceBrandFor(account.service);
    return brandId ? serviceBrandById(brandId) : null;
  });
  const firstBrand = resolved[0];
  if (firstBrand && resolved.every(
    (brand) => brand?.familyId === firstBrand.familyId,
  )) {
    return firstBrand.title;
  }
  return null;
}

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
const NEW_GROUP_CUSTOMIZATION: VaultGroupCustomization = { name: "", icon: "folder", color: "rose" };
const DEFAULT_GROUP_ICONS: readonly VaultGroupIcon[] = ["dot", "folder", "briefcase", "person", "shield", "star", "home", "code"];
const DEFAULT_GROUP_COLORS: readonly VaultGroupColor[] = ["rose", "amber", "lime", "emerald", "sky", "blue", "violet", "slate"];
const COMMON_GROUP_STYLES: Readonly<Record<string, Pick<VaultGroupCustomization, "icon" | "color">>> = {
  personal: { icon: "person", color: "blue" },
  work: { icon: "briefcase", color: "amber" },
  finance: { icon: "shield", color: "lime" },
  imported: { icon: "import", color: "rose" },
};

function groupKey(value: string) {
  return normalizeGroupName(value).normalize("NFKC").toLocaleLowerCase("en");
}

function defaultMainScreenGroup(vault: PersistedVault): "All" | Group {
  if (vault.settings.mainScreen.kind === "all") return "All";
  const groups = orderedVisibleGroupNames(
    vault.accounts,
    vault.groupCustomizations,
    vault.groupOrder,
  );
  return groups.find((name) => groupKey(name) === groupKey(vault.settings.mainScreen.group)) ?? "All";
}

function sidebarMenuTargetKey(target: SidebarMenuTarget) {
  return target.kind === "all" ? "all" : `group:${groupKey(target.name)}`;
}

function sidebarMenuPositionFromTrigger(trigger: HTMLElement): SidebarMenuPosition {
  const anchor = trigger
    .closest(".primary-nav-row, .group-nav-row")
    ?.querySelector<HTMLElement>(".primary-options-button, .group-options-button") ?? trigger;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const menuLeft = rect.left + (rect.width / 2) - 4;
  return {
    top: Math.round(rect.bottom + 6),
    left: Math.round(Math.max(margin, menuLeft)),
  };
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

const SETTINGS_MENU_ITEMS = [
  { id: "profile-settings", label: "Profile" },
  { id: "settings-root", label: "Settings" },
] as const;

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
  const [instanceSettings, setInstanceSettings] = useState<VaultInstanceSettings>({
    allowAccountCreation: true,
  });
  const [accountCreationEnabled, setAccountCreationEnabled] = useState(true);
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"qr" | "link" | "manual">("qr");
  const [accountMenuId, setAccountMenuId] = useState<string | null>(null);
  const [sidebarMenuTarget, setSidebarMenuTarget] = useState<SidebarMenuTarget | null>(null);
  const [sidebarMenuPosition, setSidebarMenuPosition] = useState<SidebarMenuPosition | null>(null);
  const [confirmingSidebarGroupDeletion, setConfirmingSidebarGroupDeletion] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountEditorReturnFocusTo, setAccountEditorReturnFocusTo] = useState<HTMLButtonElement | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set());
  const [draggingSelectedAccounts, setDraggingSelectedAccounts] = useState(false);
  const [draggedAccountIds, setDraggedAccountIds] = useState<Set<string>>(() => new Set());
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dragOverPrimaryTarget, setDragOverPrimaryTarget] = useState<"favorites" | "archive" | null>(null);
  const [accountDropTarget, setAccountDropTarget] = useState<AccountDropTarget | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<GroupDropTarget | null>(null);
  const [bulkLogoOpen, setBulkLogoOpen] = useState(false);
  const [bulkLogoReturnFocusTo, setBulkLogoReturnFocusTo] = useState<HTMLButtonElement | null>(null);
  const [customizingGroup, setCustomizingGroup] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
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
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const mobileSidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const addDialogRef = useRef<HTMLElement>(null);
  const manualServiceInputRef = useRef<HTMLInputElement>(null);
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
  const accountEventChannelRef = useRef<BroadcastChannel | null>(null);
  const lockPromiseRef = useRef<Promise<void> | null>(null);
  const lockingRef = useRef(false);
  const passwordChangeRef = useRef(false);
  const passwordChangeLockRequestRef = useRef<"local" | "server" | null>(null);
  const passwordChangePostLockErrorRef = useRef<string | null>(null);
  const conflictBusyRef = useRef(false);
  const conflictPendingRef = useRef(false);
  const clipboardClearTimersRef = useRef<Set<number>>(new Set());
  const selectedAccountDragRef = useRef(false);
  const selectedAccountDragOriginRef = useRef<string | null>(null);
  const draggedAccountIdsRef = useRef<Set<string>>(new Set());
  const suppressSelectedAccountClickRef = useRef(false);
  const selectedAccountClickResetFrameRef = useRef<number | null>(null);
  const groupDragNameRef = useRef<string | null>(null);
  const suppressGroupClickRef = useRef(false);
  const groupClickResetFrameRef = useRef<number | null>(null);
  const sessionGenerationRef = useRef(0);
  const sessionTransitionRef = useRef<VaultSessionTransition>({
    epoch: 0,
    phase: "closed",
  });
  const lastActivityAtRef = useRef<number | null>(null);
  const hiddenLockArmedRef = useRef(false);
  const resumeAvailableRef = useRef(false);
  const resumeAbsoluteExpiresAtRef = useRef(0);
  const resumePersistenceRef = useRef<VaultResumePersistence>("session");
  const resumeSavePromiseRef = useRef<Promise<void> | null>(null);
  const lastResumeRetryAtRef = useRef(0);
  const lastResumeTouchAtRef = useRef(0);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
    setSidebarMenuTarget(null);
    setSidebarMenuPosition(null);
    setConfirmingSidebarGroupDeletion(null);
  }, []);

  const clearSelectedAccountDrag = useCallback(() => {
    selectedAccountDragRef.current = false;
    selectedAccountDragOriginRef.current = null;
    draggedAccountIdsRef.current.clear();
    setDraggingSelectedAccounts(false);
    setDraggedAccountIds(new Set());
    setDragOverGroup(null);
    setDragOverPrimaryTarget(null);
    setAccountDropTarget(null);
    if (suppressSelectedAccountClickRef.current) {
      if (selectedAccountClickResetFrameRef.current !== null) {
        window.cancelAnimationFrame(selectedAccountClickResetFrameRef.current);
      }
      selectedAccountClickResetFrameRef.current = window.requestAnimationFrame(() => {
        suppressSelectedAccountClickRef.current = false;
        selectedAccountClickResetFrameRef.current = null;
      });
    }
  }, []);

  const clearGroupDrag = useCallback(() => {
    groupDragNameRef.current = null;
    setDraggingGroup(null);
    setGroupDropTarget(null);
    if (suppressGroupClickRef.current) {
      if (groupClickResetFrameRef.current !== null) {
        window.cancelAnimationFrame(groupClickResetFrameRef.current);
      }
      groupClickResetFrameRef.current = window.requestAnimationFrame(() => {
        suppressGroupClickRef.current = false;
        groupClickResetFrameRef.current = null;
      });
    }
  }, []);

  useEffect(() => () => {
    if (selectedAccountClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(selectedAccountClickResetFrameRef.current);
    }
    if (groupClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(groupClickResetFrameRef.current);
    }
  }, []);

  const updateSelectedAccountDragZone = (
    event: ReactMouseEvent<HTMLElement>,
    draggable: boolean,
  ) => {
    const allowed = draggable
      && mouseIsOutsideAccountCodeRow(event);
    event.currentTarget.dataset.dragZone = allowed ? "allowed" : "blocked";
    return allowed;
  };

  const prepareSelectedAccountDrag = (
    event: ReactMouseEvent<HTMLElement>,
    accountId: string,
    draggable: boolean,
  ) => {
    selectedAccountDragOriginRef.current = event.button === 0
      && updateSelectedAccountDragZone(event, draggable)
      ? accountId
      : null;
  };

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
  const mainScreen: VaultMainScreen = vault?.settings.mainScreen ?? { kind: "all" };
  const accountIconOptions = useMemo<readonly AccountIconOption[]>(() => {
    if (!editingAccountId && !bulkLogoOpen) return ACCOUNT_ICON_OPTIONS;
    return [
      ...ACCOUNT_ICON_OPTIONS,
      ...selfhstServiceBrandOptions().map((option) => ({
        id: option.id,
        label: option.title,
        description: option.variantLabel,
        familyId: option.familyId,
        searchTerms: option.searchTerms,
        variantOrder: option.variantOrder,
      })),
    ];
  }, [bulkLogoOpen, editingAccountId]);

  const groups = useMemo(() => orderedVisibleGroupNames(
    accounts,
    groupCustomizations,
    vault?.groupOrder ?? [],
  ), [accounts, groupCustomizations, vault?.groupOrder]);
  const entryGroups = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of ["Personal", "Work", "Finance", ...groups]) {
      names.set(groupKey(name), name);
    }
    return Array.from(names.values());
  }, [groups]);
  const groupCustomizationMap = useMemo(
    () => new Map(groupCustomizations.map((customization) => [groupKey(customization.name), customization])),
    [groupCustomizations],
  );
  const customizationForGroup = useCallback((name: string) => (
    groupCustomizationMap.get(groupKey(name)) ?? defaultGroupCustomization(name)
  ), [groupCustomizationMap]);
  const activeGroupCustomization = creatingGroup
    ? NEW_GROUP_CUSTOMIZATION
    : customizingGroup ? customizationForGroup(customizingGroup) : null;
  const editingCodePreview = editingAccount && signedIn
    ? accountCodePreview(editingAccount, tick, codePairs[editingAccount.id])
    : undefined;

  const beginSessionTransition = useCallback((phase: VaultSessionPhase) => {
    const next = beginVaultSessionTransition(sessionTransitionRef.current, phase);
    sessionTransitionRef.current = next;
    return next.epoch;
  }, []);

  const mutationBlockReason = useCallback(() => {
    if (passwordChangeRef.current) return "locking" as const;
    return vaultMutationBlockReason({
      phase: sessionTransitionRef.current.phase,
      runtimeAvailable: Boolean(runtimeRef.current),
      vaultAvailable: Boolean(vaultRef.current),
      conflictPending: conflictPendingRef.current,
      conflictPresent: Boolean(conflictRef.current),
    });
  }, []);

  const saveResumeSession = useCallback((
    activeRuntime: VaultRuntime,
    activeHeader: EncryptedVaultHeader,
    persistence: VaultResumePersistence = resumePersistenceRef.current,
    loginIdentifier = vaultRef.current?.profile.email,
    notifyOnFailure = true,
  ): Promise<void> => {
    if (resumeSavePromiseRef.current) return resumeSavePromiseRef.current;
    const transitionEpoch = sessionTransitionRef.current.epoch;
    const task = saveVaultResumeSession(
      activeHeader.vaultId,
      activeRuntime,
      persistence,
      loginIdentifier,
    )
      .then((metadata) => {
        if (
          transitionEpoch !== sessionTransitionRef.current.epoch ||
          sessionTransitionRef.current.phase === "locking"
        ) {
          return;
        }
        resumeAvailableRef.current = true;
        resumeAbsoluteExpiresAtRef.current = metadata.absoluteExpiresAt;
        resumePersistenceRef.current = metadata.persistence;
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
      passwordChangeRef.current ||
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
    void saveResumeSession(
      activeRuntime,
      activeHeader,
      resumePersistenceRef.current,
      vaultRef.current?.profile.email,
      false,
    );
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
    setView("all");
    setGroup(defaultMainScreenGroup(publication.vault));
    setSidebarMenuTarget(null);
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
      const current = await loginVault(
        proof,
        identifier,
        resumePersistenceRef.current === "remembered",
      );
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

  const handleCreateAccount = useCallback(async (details: VaultCreateAccountDetails) => {
    let transitionEpoch: number | null = null;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const resumePersistence = resumePersistenceForRememberLogin(details.rememberLogin);
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
      const created = await createEncryptedVault(details.password, initialVault, {
        resumeTtlMs: resumeTtlForPersistence(resumePersistence),
      });
      ensureSetupActive();
      const authProof = await createAuthProof(created.runtime.authKey);
      ensureSetupActive();
      const result = await setupVault({
        identifier: details.email,
        authProof,
        header: created.header,
        payload: created.payloadCipher,
        rememberLogin: details.rememberLogin,
      });
      ensureSetupActive();
      await saveResumeSession(
        created.runtime,
        created.header,
        resumePersistence,
        details.email,
      );
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
        : error instanceof VaultApiError && error.code === "registration_disabled"
          ? "Account creation is disabled for this Coffer instance."
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
    resumePersistence: VaultResumePersistence = "session",
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
      const rememberLogin = resumePersistence === "remembered";
      let result = await loginVault(authProof, loginIdentifier, rememberLogin);
      authenticated = true;
      ensureTransitionActive();
      setInstanceSettings(result.instanceSettings);
      setAccountCreationEnabled(result.accountCreationEnabled);
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
                result = await loginVault(authProof, undefined, rememberLogin);
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

      if (resumeLastActivityAt !== undefined && resumePersistence !== "remembered") {
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
        await saveResumeSession(
          nextRuntime,
          activeHeader,
          resumePersistence,
          loginIdentifier,
        );
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
      resumePersistenceRef.current = resumePersistence;
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

  const handleSignIn = useCallback(async (details: VaultAccessDetails) => {
    setAuthBusy(true);
    setAuthError(null);
    let transitionEpoch: number | null = null;
    try {
      const resumePersistence = resumePersistenceForRememberLogin(details.rememberLogin);
      transitionEpoch = await beginOpeningSession();
      const identified = await identifyVault(details.email);
      if (!isVaultSessionTransition(sessionTransitionRef.current, transitionEpoch, "opening")) {
        throw new Error("Sign-in was superseded by another session transition.");
      }
      if (!identified.configured) {
        throw new VaultApiError("Invalid email or password.", "invalid_credentials", 401);
      }
      const nextRuntime = await unlockVaultHeader(details.password, identified.header, {
        resumeTtlMs: resumeTtlForPersistence(resumePersistence),
      });
      await openVaultRuntime(
        nextRuntime,
        identified.header,
        transitionEpoch,
        true,
        undefined,
        undefined,
        details.email,
        resumePersistence,
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
    resumePersistenceRef.current = "session";
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
    setSidebarMenuTarget(null);
    setEditingAccountId(null);
    setAccountEditorReturnFocusTo(null);
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    clearSelectedAccountDrag();
    clearGroupDrag();
    setBulkLogoOpen(false);
    setBulkLogoReturnFocusTo(null);
    setCustomizingGroup(null);
    setCreatingGroup(false);
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
  }, [beginSessionTransition, clearGroupDrag, clearSelectedAccountDrag]);

  const deleteOwnAccount = useCallback(async (password: string): Promise<void> => {
    if (passwordChangeRef.current) {
      throw new Error("Wait for the password change to finish before deleting this account.");
    }
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
      accountEventChannelRef.current?.postMessage({
        type: "account-deleted",
        vaultId: header.vaultId,
      });
    } catch {
      // Cross-tab cleanup is best-effort; this tab still clears itself below.
    }
    await localCleanup;
  }, [clearDeletedVaultSession]);

  const lockVault = useCallback((localOnly = false): Promise<void> => {
    if (passwordChangeRef.current) {
      const requestedMode = localOnly ? "local" : "server";
      if (
        passwordChangeLockRequestRef.current === null ||
        requestedMode === "server"
      ) {
        passwordChangeLockRequestRef.current = requestedMode;
      }
      setToast("Wait for the password change to finish before locking the vault.");
      return Promise.resolve();
    }
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
    resumePersistenceRef.current = "session";
    lastResumeRetryAtRef.current = 0;
    lastResumeTouchAtRef.current = 0;
    setAuthStatus("locking");
    setCodePairs({});
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    clearSelectedAccountDrag();
    clearGroupDrag();
    setBulkLogoOpen(false);
    setBulkLogoReturnFocusTo(null);
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
    setSidebarMenuTarget(null);
    setEditingAccountId(null);
    setAccountEditorReturnFocusTo(null);
    setCustomizingGroup(null);
    setCreatingGroup(false);
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

      if (!localOnly) {
        try {
          await logoutVault();
        } catch {
          // Local key material is cleared even if the bounded logout request fails.
        }
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
  }, [attemptVaultSave, beginSessionTransition, clearGroupDrag, clearSelectedAccountDrag, stagePendingVaults]);

  const changeOwnPassword = useCallback(async (
    currentPassword: string,
    nextPassword: string,
  ): Promise<void> => {
    if (passwordChangeRef.current) {
      throw new Error("A password change is already in progress.");
    }

    const header = bootstrapHeaderRef.current;
    const transition = sessionTransitionRef.current;
    const generation = sessionGenerationRef.current;
    if (
      !header ||
      !runtimeRef.current ||
      !vaultRef.current ||
      transition.phase !== "ready" ||
      conflictPendingRef.current ||
      conflictRef.current
    ) {
      throw new Error("Unlock a conflict-free vault before changing its password.");
    }

    const sessionIsCurrent = () => (
      sessionGenerationRef.current === generation &&
      sessionTransitionRef.current.epoch === transition.epoch &&
      sessionTransitionRef.current.phase === "ready" &&
      bootstrapHeaderRef.current === header &&
      Boolean(runtimeRef.current) &&
      Boolean(vaultRef.current)
    );

    passwordChangeRef.current = true;
    try {
      await stagePendingVaults();
      await flushVaultSavesRef.current();
      if (!sessionIsCurrent()) {
        throw new Error("The vault session changed. Unlock it again before changing the password.");
      }
      if (
        pendingStageRef.current ||
        stagingPromiseRef.current ||
        stagedSaveRef.current ||
        conflictPendingRef.current ||
        conflictRef.current ||
        savedVersionRef.current !== mutationVersionRef.current
      ) {
        throw new Error("The latest vault changes must be saved before changing the password.");
      }

      let rotation: Awaited<ReturnType<typeof rotateVaultPassword>>;
      try {
        rotation = await rotateVaultPassword(currentPassword, nextPassword, header, {
          resumeTtlMs: resumeTtlForPersistence(resumePersistenceRef.current),
        });
      } catch (error) {
        if (error instanceof VaultCryptoError && error.code === "AUTHENTICATION_FAILED") {
          throw new Error("The current password is incorrect.");
        }
        if (error instanceof VaultCryptoError && error.code === "INVALID_INPUT") {
          throw new Error(error.message);
        }
        throw new Error("The current password could not be verified securely.");
      }
      if (!sessionIsCurrent()) {
        throw new Error("The vault session changed. Unlock it again before changing the password.");
      }

      const expectedRevision = revisionRef.current;
      const requestChange = () => changeVaultPassword({
        vaultId: header.vaultId,
        expectedRevision,
        currentAuthProof: rotation.currentAuthProof,
        nextAuthProof: rotation.nextAuthProof,
        header: rotation.header,
      });
      let result;
      try {
        result = await requestChange();
      } catch (error) {
        if (
          error instanceof VaultApiError &&
          (
            error.code === "request_timeout" ||
            error.code === "network_error" ||
            error.code === "invalid_response" ||
            error.status >= 500
          )
        ) {
          try {
            result = await requestChange();
          } catch (retryError) {
            passwordChangeLockRequestRef.current ??= "local";
            passwordChangePostLockErrorRef.current = "The password change could not be confirmed. Try the new password first; if it is rejected, use the previous password.";
            throw retryError;
          }
        } else {
          throw error;
        }
      }

      if (result.revision !== expectedRevision + 1) {
        passwordChangeLockRequestRef.current ??= "local";
        passwordChangePostLockErrorRef.current = "The password change result could not be verified. Sign in with the new password first; if it is rejected, use the previous password.";
        throw new Error("The vault server returned an unexpected password-change revision.");
      }
      if (!sessionIsCurrent()) {
        try {
          accountEventChannelRef.current?.postMessage({
            type: "password-changed",
            vaultId: header.vaultId,
          });
        } catch {
          // Other tabs will still be rejected after their server session expires.
        }
        throw new Error("The password changed, but this vault session closed. Sign in with the new password.");
      }

      revisionRef.current = result.revision;
      bootstrapHeaderRef.current = rotation.header;
      runtimeRef.current = rotation.runtime;
      setRuntime(rotation.runtime);
      setSaveStatus("saved");
      setSaveError(null);
      try {
        accountEventChannelRef.current?.postMessage({
          type: "password-changed",
          vaultId: header.vaultId,
        });
      } catch {
        // Cross-tab locking is best-effort; other server sessions are revoked.
      }

      const rotatedSessionIsCurrent = () => (
        sessionGenerationRef.current === generation &&
        sessionTransitionRef.current.epoch === transition.epoch &&
        sessionTransitionRef.current.phase === "ready" &&
        bootstrapHeaderRef.current === rotation.header &&
        runtimeRef.current === rotation.runtime &&
        Boolean(vaultRef.current)
      );
      const previousResumeSave = resumeSavePromiseRef.current;
      if (previousResumeSave) {
        const previousResumeResult = await settleWithin(previousResumeSave, 5_500);
        if (!rotatedSessionIsCurrent()) return;
        if (previousResumeResult.status !== "fulfilled") {
          resumeAvailableRef.current = false;
          setToast("Password changed, but browser refresh recovery could not be renewed. Sign in again after a refresh.");
          return;
        }
      }
      if (!rotatedSessionIsCurrent()) return;
      const resumeClearResult = await settleWithin(clearVaultResumeSession(), 5_500);
      if (!rotatedSessionIsCurrent()) return;
      if (resumeClearResult.status !== "fulfilled") {
        resumeAvailableRef.current = false;
        setToast("Password changed, but browser refresh recovery could not be renewed. Sign in again after a refresh.");
        return;
      }
      resumeAvailableRef.current = false;
      resumeAbsoluteExpiresAtRef.current = 0;
      lastResumeRetryAtRef.current = 0;
      lastResumeTouchAtRef.current = 0;
      await settleWithin(
        saveResumeSession(rotation.runtime, rotation.header),
        5_500,
      );
    } catch (error) {
      if (error instanceof VaultApiError) {
        if (error.code === "invalid_credentials") {
          throw new Error("The current password is incorrect.");
        }
        if (error.code === "rate_limited") throw new Error(error.message);
        if (error.code === "unauthorized") {
          passwordChangeLockRequestRef.current ??= "local";
          passwordChangePostLockErrorRef.current = "The vault session expired during the password change. Sign in again to confirm which password is active.";
          throw new Error("The vault session expired. Sign in again before changing the password.");
        }
        if (error.code === "revision_conflict") {
          passwordChangeLockRequestRef.current ??= "local";
          passwordChangePostLockErrorRef.current = "The vault changed in another session. Sign in again before changing the password.";
          throw new Error("The vault changed in another session. Lock and sign in again before changing the password.");
        }
        if (error.code === "request_timeout" || error.code === "network_error") {
          passwordChangeLockRequestRef.current ??= "local";
          passwordChangePostLockErrorRef.current = "The password change could not be confirmed. Try the new password first; if it is rejected, use the previous password.";
          throw new Error("The password change could not be confirmed. Try the new password first; if it is rejected, use the previous password.");
        }
        if (error.code === "invalid_response" || error.status >= 500) {
          passwordChangeLockRequestRef.current ??= "local";
          passwordChangePostLockErrorRef.current = "The password change could not be confirmed. Try the new password first; if it is rejected, use the previous password.";
          throw new Error("The password change could not be confirmed. Sign in with the new password first; if it is rejected, use the previous password.");
        }
        throw new Error("The encrypted vault password could not be changed.");
      }
      throw error;
    } finally {
      passwordChangeRef.current = false;
      const queuedLock = passwordChangeLockRequestRef.current;
      const postLockError = passwordChangePostLockErrorRef.current;
      passwordChangeLockRequestRef.current = null;
      passwordChangePostLockErrorRef.current = null;
      if (queuedLock) {
        await lockVault(queuedLock === "local");
        if (postLockError) setAuthError(postLockError);
      }
    }
  }, [lockVault, saveResumeSession, stagePendingVaults]);

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
      setGroup((currentGroup) => {
        if (currentGroup === "All") return currentGroup;
        const currentGroupKey = groupKey(currentGroup);
        const remainsAvailable = conflict.serverVault.accounts.some(
          (account) => !account.archived && groupKey(account.group) === currentGroupKey,
        ) || conflict.serverVault.groupCustomizations.some(
          (customization) => groupKey(customization.name) === currentGroupKey,
        );
        return remainsAvailable ? currentGroup : "All";
      });
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
        setInstanceSettings(bootstrap.instanceSettings);
        setAccountCreationEnabled(bootstrap.accountCreationEnabled);
        if (!bootstrap.authenticated) {
          const rememberedHint = readRememberedVaultResumeHint();
          if (rememberedHint) {
            try {
              const identified = await identifyVault(rememberedHint.loginIdentifier);
              if (!active) return;
              if (
                !identified.configured ||
                identified.header.vaultId !== rememberedHint.vaultId
              ) {
                throw new Error("The remembered vault no longer matches this account.");
              }
              revisionRef.current = identified.revision;
              bootstrapHeaderRef.current = identified.header;
              const resumed = await readVaultResumeSession(identified.header.vaultId);
              if (!resumed || resumed.persistence !== "remembered") {
                throw new Error("The remembered browser session is unavailable.");
              }
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
                identified.header,
                transitionEpoch,
                false,
                resumed.lastActivityAt,
                () => active,
                rememberedHint.loginIdentifier,
                "remembered",
              );
              if (!active) return;
              resumeAvailableRef.current = true;
              resumeAbsoluteExpiresAtRef.current = resumed.absoluteExpiresAt;
              touchVaultResumeSession(identified.header.vaultId);
              return;
            } catch {
              void clearVaultResumeSession().catch(() => undefined);
              runtimeRef.current = null;
              vaultRef.current = null;
              setRuntime(null);
              setVault(null);
            }
          }
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
              resumed.loginIdentifier,
              resumed.persistence,
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

  const setAccountCreationPreference = useCallback(async (allowAccountCreation: boolean) => {
    const result = await updateInstanceSettings({ allowAccountCreation });
    setInstanceSettings(result.instanceSettings);
    setAccountCreationEnabled(result.accountCreationEnabled);
  }, []);

  useEffect(() => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(ACCOUNT_EVENT_CHANNEL_NAME);
      accountEventChannelRef.current = channel;
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
        typeof message.type !== "string" ||
        typeof message.vaultId !== "string" ||
        bootstrapHeaderRef.current?.vaultId !== message.vaultId
      ) {
        return;
      }
      if (message.type === "account-deleted") {
        void clearDeletedVaultSession(message.vaultId);
      } else if (message.type === "password-changed") {
        const postLockError = "The vault password was changed in another tab. Sign in again with the new password.";
        if (passwordChangeRef.current) {
          passwordChangePostLockErrorRef.current = postLockError;
          void lockVault(true);
        } else {
          void lockVault(true).then(() => setAuthError(postLockError));
        }
      }
    };
    channel.addEventListener("message", handleAccountEvent);
    return () => {
      channel.removeEventListener("message", handleAccountEvent);
      if (accountEventChannelRef.current === channel) {
        accountEventChannelRef.current = null;
      }
      channel.close();
    };
  }, [clearDeletedVaultSession, lockVault]);

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
        setSidebarMenuTarget(null);
        setSidebarMenuPosition(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const mobileBreakpoint = window.matchMedia("(max-width: 620px)");
    const closeAtDesktopWidth = () => {
      if (!mobileBreakpoint.matches) closeMobileSidebar();
    };
    mobileBreakpoint.addEventListener("change", closeAtDesktopWidth);
    return () => mobileBreakpoint.removeEventListener("change", closeAtDesktopWidth);
  }, [closeMobileSidebar]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const sidebar = mobileSidebarRef.current;
    if (!sidebar) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = mobileSidebarTriggerRef.current;
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusDrawer = window.requestAnimationFrame(() => {
      sidebar.querySelector<HTMLElement>(".mobile-sidebar-close")?.focus({ preventScroll: true });
    });
    const onDrawerKeyDown = (event: KeyboardEvent) => {
      const foregroundModal = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
        .some((element) => element !== sidebar);
      if (foregroundModal) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileSidebar();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return element.tabIndex >= 0 && style.display !== "none" && style.visibility !== "hidden";
        });
      if (focusable.length === 0) {
        event.preventDefault();
        sidebar.focus({ preventScroll: true });
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

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onDrawerKeyDown);
    return () => {
      window.cancelAnimationFrame(focusDrawer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onDrawerKeyDown);
      window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };
  }, [closeMobileSidebar, mobileSidebarOpen]);

  useEffect(() => {
    if (!sidebarMenuTarget) return;
    const closeSidebarMenu = () => {
      setSidebarMenuTarget(null);
      setSidebarMenuPosition(null);
      setConfirmingSidebarGroupDeletion(null);
    };
    window.addEventListener("resize", closeSidebarMenu);
    window.addEventListener("scroll", closeSidebarMenu, true);
    return () => {
      window.removeEventListener("resize", closeSidebarMenu);
      window.removeEventListener("scroll", closeSidebarMenu, true);
    };
  }, [sidebarMenuTarget]);

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

  useEffect(() => {
    if (!addOpen || addMode !== "manual") return;
    const animationFrame = window.requestAnimationFrame(() => {
      manualServiceInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [addMode, addOpen]);

  const counts = useMemo(() => Object.fromEntries(groups.map((name) => {
    const nameKey = groupKey(name);
    return [name, accounts.filter((account) => !account.archived && groupKey(account.group) === nameKey).length];
  })), [accounts, groups]);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesView = view === "favorites" ? account.favorite && !account.archived : view === "archive" ? account.archived : !account.archived;
      const matchesGroup = group === "All" || groupKey(account.group) === groupKey(group);
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
  const selectedLogoPreviewAccount = accounts.find((account) => selectedVisibleAccountIds.has(account.id)) ?? null;
  const selectedLogoSuggestedService = useMemo(
    () => commonLogoSuggestion(accounts, selectedVisibleAccountIds),
    [accounts, selectedVisibleAccountIds],
  );
  const retainedCustomLogoBytes = retainedAccountIconBytes(accounts, selectedVisibleAccountIds);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    clearSelectedAccountDrag();
    setBulkLogoOpen(false);
    setBulkLogoReturnFocusTo(null);
    setSidebarMenuTarget(null);
  };

  const openSettingsSection = (sectionId: string) => {
    exitSelectionMode();
    setAccountMenuId(null);
    setSidebarMenuTarget(null);
    setView("settings");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.getElementById(sectionId);
        if (!section) return;
        section.focus({ preventScroll: true });
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    });
  };

  const toggleAccountSelection = (id: string) => {
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDefaultMainScreen = (target: SidebarMenuTarget) => (
    target.kind === "all"
      ? mainScreen.kind === "all"
      : mainScreen.kind === "group" && groupKey(mainScreen.group) === groupKey(target.name)
  );

  const sidebarMenuIsOpen = (target: SidebarMenuTarget) => (
    sidebarMenuTarget !== null && sidebarMenuTargetKey(sidebarMenuTarget) === sidebarMenuTargetKey(target)
  );

  const toggleSidebarMenu = (target: SidebarMenuTarget, trigger: HTMLElement) => {
    setAccountMenuId(null);
    setConfirmingSidebarGroupDeletion(null);
    const menuIsOpen = sidebarMenuTarget !== null && sidebarMenuTargetKey(sidebarMenuTarget) === sidebarMenuTargetKey(target);
    if (menuIsOpen) {
      setSidebarMenuTarget(null);
      setSidebarMenuPosition(null);
      return;
    }
    setSidebarMenuPosition(sidebarMenuPositionFromTrigger(trigger));
    setSidebarMenuTarget(target);
  };

  const setDefaultMainScreen = (target: SidebarMenuTarget) => {
    if (target.kind === "group" && !groups.some((name) => groupKey(name) === groupKey(target.name))) {
      setSidebarMenuTarget(null);
      setToast("This group is no longer available.");
      return false;
    }
    if (isDefaultMainScreen(target)) {
      setSidebarMenuTarget(null);
      return true;
    }

    const nextMainScreen: VaultMainScreen = target.kind === "all"
      ? { kind: "all" }
      : { kind: "group", group: target.name };
    const saved = commitVault((current) => withVaultUpdate(current, {
      settings: { ...current.settings, mainScreen: nextMainScreen },
    }));
    if (!saved) return false;
    setSidebarMenuTarget(null);
    setToast(target.kind === "all"
      ? "All codes is now the default main screen."
      : `${target.name} is now the default main screen.`);
    return true;
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
    const row = trigger.closest(".group-nav-row");
    const returnTarget = row?.querySelector<HTMLElement>(".group-options-button") ?? trigger;
    setSidebarMenuTarget(null);
    setGroupCustomizationReturnFocusTo(returnTarget);
    setCreatingGroup(false);
    setCustomizingGroup(name);
  };

  const beginGroupCreation = (trigger: HTMLElement) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      setToast("Resolve the encrypted save conflict before creating groups.");
      return;
    }
    if (blockReason) {
      setToast("Unlock your vault before creating groups.");
      return;
    }
    if (groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) {
      setToast("The vault has reached the maximum number of saved groups.");
      return;
    }
    setAccountMenuId(null);
    setSidebarMenuTarget(null);
    setGroupCustomizationReturnFocusTo(trigger);
    setCustomizingGroup(null);
    setCreatingGroup(true);
  };

  const closeGroupCustomization = () => {
    setCustomizingGroup(null);
    setCreatingGroup(false);
    setGroupCustomizationReturnFocusTo(null);
  };

  const saveGroupCustomization = (nextCustomization: VaultGroupCustomization) => {
    if (!creatingGroup && !customizingGroup) return false;
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
    const previousName = customizingGroup;
    const previousKey = previousName ? groupKey(previousName) : null;
    const duplicate = groups.some((name) => (
      groupKey(name) === normalizedKey && (creatingGroup || groupKey(name) !== previousKey)
    ));
    if (duplicate) {
      setToast("That group already exists.");
      return false;
    }

    const currentVault = vaultRef.current;
    if (!currentVault) return false;
    const currentNameExists = (nameKey: string) => (
      currentVault.accounts.some((account) => groupKey(account.group) === nameKey) ||
      currentVault.groupCustomizations.some((customization) => groupKey(customization.name) === nameKey)
    );

    if (creatingGroup) {
      if (currentVault.groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) {
        setToast("The vault has reached the maximum number of saved groups.");
        return false;
      }
      if (currentNameExists(normalizedKey)) {
        setToast("That group already exists.");
        return false;
      }
      const saved = commitVault((current) => withVaultUpdate(current, {
        groupCustomizations: [...current.groupCustomizations, {
          name: normalized,
          icon: nextCustomization.icon,
          color: nextCustomization.color,
        }],
        groupOrder: appendGroupToOrder(current.groupOrder, normalized),
      }));
      if (!saved) return false;

      closeGroupCustomization();
      setView("all");
      setGroup(normalized);
      window.requestAnimationFrame(() => {
        const nextButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".group-nav-main"))
          .find((button) => button.dataset.groupName === normalized);
        nextButton?.focus({ preventScroll: true });
      });
      setToast(`${normalized} group created.`);
      return true;
    }

    if (!previousName || !previousKey || !currentNameExists(previousKey)) {
      setToast("This group is no longer available.");
      return false;
    }
    if (normalizedKey !== previousKey && currentNameExists(normalizedKey)) {
      setToast("That group already exists.");
      return false;
    }

    const saved = commitVault((current) => {
      const nextGroupCustomizations = current.groupCustomizations.filter((customization) => (
        groupKey(customization.name) !== previousKey && groupKey(customization.name) !== normalizedKey
      ));
      const mainScreen = current.settings.mainScreen;
      return withVaultUpdate(current, {
        accounts: current.accounts.map((account) => (
          groupKey(account.group) === previousKey ? { ...account, group: normalized } : account
        )),
        settings: {
          ...current.settings,
          mainScreen: mainScreen.kind === "group" && groupKey(mainScreen.group) === previousKey
            ? { kind: "group", group: normalized }
            : mainScreen,
        },
        groupCustomizations: [...nextGroupCustomizations, {
          name: normalized,
          icon: nextCustomization.icon,
          color: nextCustomization.color,
        }],
        groupOrder: renameGroupInOrder(current.groupOrder, previousName, normalized),
      });
    });
    if (!saved) return false;

    if (groupKey(group) === previousKey) setGroup(normalized);
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

  const groupDeletionError = (deletedName: string) => {
    const blockReason = mutationBlockReason();
    if (blockReason === "conflict" || blockReason === "conflict-pending") {
      return "Resolve the encrypted save conflict before deleting groups.";
    }
    if (blockReason) {
      return "Unlock your vault before deleting groups.";
    }

    const deletedKey = groupKey(deletedName);
    const currentVault = vaultRef.current;
    if (!currentVault) return "Unlock your vault before deleting groups.";
    if (currentVault.accounts.some((account) => groupKey(account.group) === deletedKey)) {
      return "Move every active and archived account to another group before deleting this group.";
    }
    if (!currentVault.groupCustomizations.some((customization) => groupKey(customization.name) === deletedKey)) {
      return "This group is no longer available.";
    }
    return null;
  };

  const deleteGroupByName = (deletedName: string) => {
    const deletionError = groupDeletionError(deletedName);
    if (deletionError) {
      setToast(deletionError);
      return false;
    }

    const deletedKey = groupKey(deletedName);
    const deletedIndex = groups.findIndex((name) => groupKey(name) === deletedKey);
    const focusGroupName = deletedIndex >= 0
      ? groups[deletedIndex + 1] ?? groups[deletedIndex - 1] ?? null
      : null;

    const saved = commitVault((current) => withVaultUpdate(current, {
      settings: {
        ...current.settings,
        mainScreen: current.settings.mainScreen.kind === "group" &&
          groupKey(current.settings.mainScreen.group) === deletedKey
          ? { kind: "all" }
          : current.settings.mainScreen,
      },
      groupCustomizations: current.groupCustomizations.filter(
        (customization) => groupKey(customization.name) !== deletedKey,
      ),
      groupOrder: removeGroupFromOrder(current.groupOrder, deletedName),
    }));
    if (!saved) return false;

    if (groupKey(group) === deletedKey) setGroup("All");
    setSidebarMenuTarget(null);
    setSidebarMenuPosition(null);
    setConfirmingSidebarGroupDeletion(null);
    closeGroupCustomization();
    window.requestAnimationFrame(() => {
      const nextGroup = focusGroupName
        ? Array.from(document.querySelectorAll<HTMLButtonElement>(".group-nav-main"))
          .find((button) => groupKey(button.dataset.groupName ?? "") === groupKey(focusGroupName))
        : null;
      (nextGroup ?? document.querySelector<HTMLButtonElement>(".primary-nav-main"))
        ?.focus({ preventScroll: true });
    });
    setToast(`${deletedName} group deleted.`);
    return true;
  };

  const deleteGroupCustomization = () => (
    customizingGroup ? deleteGroupByName(customizingGroup) : false
  );

  const requestSidebarGroupDeletion = (name: string) => {
    const deletionError = groupDeletionError(name);
    if (deletionError) {
      setConfirmingSidebarGroupDeletion(null);
      setToast(deletionError);
      return false;
    }
    if (!confirmingSidebarGroupDeletion || groupKey(confirmingSidebarGroupDeletion) !== groupKey(name)) {
      setConfirmingSidebarGroupDeletion(name);
      return true;
    }
    return deleteGroupByName(name);
  };

  const moveSelectedAccounts = (
    requestedGroup: string,
    createGroup: boolean,
    accountIds: ReadonlySet<string> = selectedVisibleAccountIds,
    openTargetGroup = true,
  ) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before moving accounts."
        : "Unlock your vault before moving accounts.");
      return false;
    }
    if (accountIds.size === 0) {
      setToast("Select at least one account to move.");
      return false;
    }

    const normalized = normalizeGroupName(requestedGroup);
    const normalizedKey = groupKey(normalized);
    if (!normalized || normalized.length > 48 || normalizedKey === "all") {
      setToast("Use a group name between 1 and 48 characters. “All” is reserved.");
      return false;
    }
    const existing = groups.find((name) => groupKey(name) === normalizedKey);
    if (createGroup && existing) {
      setToast("That group already exists. Choose it from the existing groups list.");
      return false;
    }
    if (!createGroup && !existing) {
      setToast("Choose an existing group.");
      return false;
    }

    const targetGroup = existing ?? normalized;
    const targetGroupKey = groupKey(targetGroup);
    const currentVault = vaultRef.current;
    if (!currentVault) return false;
    if (createGroup) {
      const currentTargetExists = currentVault.accounts.some((account) => groupKey(account.group) === targetGroupKey) ||
        currentVault.groupCustomizations.some((customization) => groupKey(customization.name) === targetGroupKey);
      if (currentTargetExists) {
        setToast("That group already exists. Choose it from the existing groups list.");
        return false;
      }
      if (currentVault.groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) {
        setToast("The vault has reached the maximum number of saved groups.");
        return false;
      }
    }
    const selected = new Set(accountIds);
    const changed = new Set(accounts
      .filter((account) => selected.has(account.id) && !account.archived && groupKey(account.group) !== targetGroupKey)
      .map((account) => account.id));
    const movedCount = changed.size;
    if (movedCount === 0) {
      setToast(`Selected accounts are already in ${targetGroup}.`);
      return false;
    }
    const saved = createGroup
      ? commitVault((current) => withVaultUpdate(current, {
          accounts: current.accounts.map((account) => (
            changed.has(account.id) && !account.archived
              ? { ...account, group: targetGroup }
              : account
          )),
          groupCustomizations: [
            ...current.groupCustomizations,
            defaultGroupCustomization(targetGroup),
          ],
          groupOrder: appendGroupToOrder(current.groupOrder, targetGroup),
        }))
      : setAccounts((current) => current.map((account) =>
        changed.has(account.id) && !account.archived
          ? { ...account, group: targetGroup }
          : account,
      ));
    if (!saved) return false;
    if (openTargetGroup) {
      setView("all");
      setGroup(targetGroup);
    }
    exitSelectionMode();
    setToast(`${movedCount} ${movedCount === 1 ? "account" : "accounts"} moved to ${targetGroup}.`);
    return true;
  };

  const applySelectedAccountLogo = (patch: BulkAccountLogoPatch) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before changing logos."
        : "Unlock your vault before changing logos.");
      return false;
    }
    if (selectedVisibleAccountIds.size === 0) {
      setToast("Select at least one account to change its logo.");
      return false;
    }
    if (patch.iconBrand && !isServiceBrandId(patch.iconBrand)) {
      setToast("Choose a logo from Coffer's local catalog.");
      return false;
    }
    if (patch.iconBrand && patch.iconDataUrl) {
      setToast("Choose either a catalog logo or an uploaded logo.");
      return false;
    }

    const selected = new Set(selectedVisibleAccountIds);
    const changed = accounts.filter((account) => (
      selected.has(account.id) &&
      !account.archived &&
      (account.iconBrand !== patch.iconBrand || account.iconDataUrl !== patch.iconDataUrl)
    ));
    if (changed.length === 0) {
      setToast("The selected accounts already use that logo choice.");
      return true;
    }

    const saved = setAccounts((current) => current.map((account) => (
      selected.has(account.id) && !account.archived
        ? { ...account, iconBrand: patch.iconBrand, iconDataUrl: patch.iconDataUrl }
        : account
    )));
    if (!saved) return false;

    const label = patch.iconDataUrl
      ? "custom logo"
      : patch.iconBrand === COFFER_INITIALS_BRAND_ID
        ? "initials tile"
        : patch.iconBrand
          ? `${accountIconOptions.find((option) => option.id === patch.iconBrand)?.label ?? serviceBrandById(patch.iconBrand)?.title ?? "catalog"} logo`
          : "automatic logo matching";
    setToast(`${label[0].toUpperCase()}${label.slice(1)} applied to ${changed.length} ${changed.length === 1 ? "account" : "accounts"}.`);
    return true;
  };

  const beginSelectedAccountDrag = (event: ReactDragEvent<HTMLElement>, accountId: string) => {
    const sourceAccount = accounts.find((account) => account.id === accountId);
    if (
      view !== "all"
      || !sourceAccount
      || sourceAccount.archived
      || selectedAccountDragOriginRef.current !== accountId
    ) {
      event.preventDefault();
      suppressSelectedAccountClickRef.current = true;
      clearSelectedAccountDrag();
      return;
    }
    clearGroupDrag();
    const draggedAccountIds = selectionMode && selectedVisibleAccountIds.has(accountId)
      ? new Set(selectedVisibleAccountIds)
      : new Set([accountId]);
    draggedAccountIdsRef.current = draggedAccountIds;
    setDraggedAccountIds(new Set(draggedAccountIds));
    if (selectedAccountClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(selectedAccountClickResetFrameRef.current);
      selectedAccountClickResetFrameRef.current = null;
    }
    suppressSelectedAccountClickRef.current = true;
    selectedAccountDragRef.current = true;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(SELECTED_ACCOUNT_DRAG_TYPE, "1");
    event.dataTransfer.setData("text/plain", "coffer-accounts");
    const card = event.currentTarget.closest(".account-card");
    if (card instanceof HTMLElement) {
      const bounds = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(
        card,
        Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
        Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
      );
    }
    setDraggingSelectedAccounts(true);
    setDragOverGroup(null);
    setDragOverPrimaryTarget(null);
  };

  const acceptsSelectedAccountDrag = () => selectedAccountDragRef.current;

  const canMoveAccountIdsToGroup = (accountIds: ReadonlySet<string>, groupName: string) => {
    const targetGroupKey = groupKey(groupName);
    return accounts.some((account) => (
      accountIds.has(account.id) && !account.archived && groupKey(account.group) !== targetGroupKey
    ));
  };

  const canMoveSelectedAccountsToGroup = (groupName: string) => (
    canMoveAccountIdsToGroup(selectedVisibleAccountIds, groupName)
  );

  const canAddAccountIdsToFavorites = (accountIds: ReadonlySet<string>) => accounts.some((account) => (
    accountIds.has(account.id) && !account.archived && !account.favorite
  ));

  const canArchiveAccountIds = (accountIds: ReadonlySet<string>) => accounts.some((account) => (
    accountIds.has(account.id) && !account.archived
  ));

  const canDropAccountIdsOnPrimaryTarget = (
    accountIds: ReadonlySet<string>,
    target: "favorites" | "archive",
  ) => target === "favorites"
    ? canAddAccountIdsToFavorites(accountIds)
    : canArchiveAccountIds(accountIds);

  const dragSelectedAccountsOverPrimaryTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    target: "favorites" | "archive",
  ) => {
    if (!acceptsSelectedAccountDrag()) return;
    setAccountDropTarget(null);
    setDragOverGroup(null);
    if (!canDropAccountIdsOnPrimaryTarget(draggedAccountIdsRef.current, target)) {
      setDragOverPrimaryTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = target === "favorites" ? "copy" : "move";
    if (dragOverPrimaryTarget !== target) setDragOverPrimaryTarget(target);
  };

  const leaveSelectedAccountPrimaryTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    target: "favorites" | "archive",
  ) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (dragOverPrimaryTarget === target) setDragOverPrimaryTarget(null);
  };

  const dragSelectedAccountsOverGroup = (event: ReactDragEvent<HTMLDivElement>, groupName: string) => {
    if (!acceptsSelectedAccountDrag()) return;
    setAccountDropTarget(null);
    setDragOverPrimaryTarget(null);
    if (!canMoveAccountIdsToGroup(draggedAccountIdsRef.current, groupName)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverGroup !== groupName) setDragOverGroup(groupName);
  };

  const leaveSelectedAccountDropTarget = (event: ReactDragEvent<HTMLDivElement>, groupName: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (dragOverGroup === groupName) setDragOverGroup(null);
  };

  const dropSelectedAccountsOnGroup = (event: ReactDragEvent<HTMLDivElement>, groupName: string) => {
    if (!acceptsSelectedAccountDrag() || !canMoveAccountIdsToGroup(draggedAccountIdsRef.current, groupName)) return;
    event.preventDefault();
    const draggedAccountIds = new Set(draggedAccountIdsRef.current);
    clearSelectedAccountDrag();
    moveSelectedAccounts(groupName, false, draggedAccountIds, false);
  };

  const dragSelectedAccountsOverAccount = (event: ReactDragEvent<HTMLElement>, targetAccountId: string) => {
    if (!acceptsSelectedAccountDrag() || draggedAccountIdsRef.current.has(targetAccountId)) {
      setAccountDropTarget(null);
      setDragOverPrimaryTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverGroup(null);
    setDragOverPrimaryTarget(null);
    const placement = accountDropPlacement(event);
    setAccountDropTarget((current) => (
      current?.id === targetAccountId && current.edge === placement.edge && current.axis === placement.axis
        ? current
        : { id: targetAccountId, ...placement }
    ));
  };

  const leaveSelectedAccountCardDropTarget = (event: ReactDragEvent<HTMLElement>, targetAccountId: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setAccountDropTarget((current) => current?.id === targetAccountId ? null : current);
  };

  const dropSelectedAccountsOnAccount = (event: ReactDragEvent<HTMLElement>, targetAccountId: string) => {
    if (!acceptsSelectedAccountDrag() || draggedAccountIdsRef.current.has(targetAccountId)) return;
    event.preventDefault();
    event.stopPropagation();
    const placement = accountDropTarget?.id === targetAccountId
      ? accountDropTarget
      : { id: targetAccountId, ...accountDropPlacement(event) };
    const movedIds = new Set(draggedAccountIdsRef.current);
    const visibleIds = visibleAccounts.map((account) => account.id);
    const nextAccounts = reorderVisibleAccounts(accounts, visibleIds, movedIds, targetAccountId, placement.edge);
    clearSelectedAccountDrag();
    if (nextAccounts === accounts) return;

    const saved = setAccounts((current) => reorderVisibleAccounts(
      current,
      visibleIds,
      movedIds,
      targetAccountId,
      placement.edge,
    ));
    if (saved) {
      setToast(movedIds.size === 1 ? "Account position updated." : `${movedIds.size} account positions updated.`);
    }
  };

  const beginGroupReorder = (event: ReactDragEvent<HTMLButtonElement>, groupName: string) => {
    const blockReason = mutationBlockReason();
    if (selectionMode || selectedAccountDragRef.current || groups.length < 2 || blockReason) {
      event.preventDefault();
      if (blockReason) {
        setToast(blockReason === "conflict" || blockReason === "conflict-pending"
          ? "Resolve the encrypted save conflict before reordering groups."
          : "Unlock your vault before reordering groups.");
      }
      return;
    }

    clearSelectedAccountDrag();
    if (groupClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(groupClickResetFrameRef.current);
      groupClickResetFrameRef.current = null;
    }
    suppressGroupClickRef.current = true;
    groupDragNameRef.current = groupName;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(GROUP_REORDER_DRAG_TYPE, "1");
    event.dataTransfer.setData("text/plain", "coffer-group-order");
    const row = event.currentTarget.closest(".group-nav-row");
    if (row instanceof HTMLElement) {
      const bounds = row.getBoundingClientRect();
      event.dataTransfer.setDragImage(
        row,
        Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
        Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
      );
    }
    setDraggingGroup(groupName);
    setGroupDropTarget(null);
  };

  const dragGroupOver = (event: ReactDragEvent<HTMLDivElement>, targetName: string) => {
    const sourceName = groupDragNameRef.current;
    if (!sourceName || groupKey(sourceName) === groupKey(targetName)) {
      setGroupDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge: GroupDropEdge = event.clientY < bounds.top + (bounds.height / 2) ? "before" : "after";
    setGroupDropTarget((current) => (
      current?.name === targetName && current.edge === edge ? current : { name: targetName, edge }
    ));
  };

  const leaveGroupDropTarget = (event: ReactDragEvent<HTMLDivElement>, targetName: string) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setGroupDropTarget((current) => current?.name === targetName ? null : current);
  };

  const dropGroupOnGroup = (event: ReactDragEvent<HTMLDivElement>, targetName: string) => {
    const sourceName = groupDragNameRef.current;
    if (!sourceName || groupKey(sourceName) === groupKey(targetName)) return;

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const fallbackEdge: GroupDropEdge = event.clientY < bounds.top + (bounds.height / 2) ? "before" : "after";
    const edge = groupDropTarget?.name === targetName ? groupDropTarget.edge : fallbackEdge;
    const nextGroups = moveGroupName(groups, sourceName, targetName, edge);
    const changed = nextGroups.some((name, index) => name !== groups[index]);
    clearGroupDrag();
    if (!changed) return;

    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before reordering groups."
        : "Unlock your vault before reordering groups.");
      return;
    }

    const saved = commitVault((current) => withVaultUpdate(current, {
      groupOrder: mergeVisibleGroupOrder(current.groupOrder, nextGroups),
    }));
    if (saved) setToast(`${sourceName} group moved.`);
  };

  const setAccountIdsFavorite = (
    accountIds: ReadonlySet<string>,
    favorite: boolean,
    exitAfter = false,
  ) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before managing favorites."
        : "Unlock your vault before managing favorites.");
      return false;
    }
    if (accountIds.size === 0) {
      setToast("Select at least one account to manage Favorites.");
      return false;
    }

    const changedIds = new Set(accounts
      .filter((account) => accountIds.has(account.id) && !account.archived && account.favorite !== favorite)
      .map((account) => account.id));
    const changedCount = changedIds.size;
    if (changedCount === 0) {
      setToast(`Selected accounts are already ${favorite ? "in Favorites" : "not in Favorites"}.`);
      return false;
    }

    const saved = setAccounts((current) => current.map((account) => {
      if (!changedIds.has(account.id) || account.archived || account.favorite === favorite) return account;
      return { ...account, favorite };
    }));
    if (!saved) return false;

    if (exitAfter) exitSelectionMode();
    setToast(`${changedCount} ${changedCount === 1 ? "account" : "accounts"} ${favorite ? "added to" : "removed from"} Favorites.`);
    return true;
  };

  const addAccountIdsToFavorites = (accountIds: ReadonlySet<string>) => (
    setAccountIdsFavorite(accountIds, true, true)
  );

  const setSelectedAccountsFavorite = (favorite: boolean) => (
    setAccountIdsFavorite(selectedVisibleAccountIds, favorite)
  );

  const archiveAccountIds = (accountIds: ReadonlySet<string>) => {
    const blockReason = mutationBlockReason();
    if (blockReason) {
      setToast(blockReason === "conflict" || blockReason === "conflict-pending"
        ? "Resolve the encrypted save conflict before archiving accounts."
        : "Unlock your vault before archiving accounts.");
      return false;
    }
    if (accountIds.size === 0) {
      setToast("Select at least one account to archive.");
      return false;
    }

    const changedIds = new Set(accounts
      .filter((account) => accountIds.has(account.id) && !account.archived)
      .map((account) => account.id));
    const archivedCount = changedIds.size;
    if (archivedCount === 0) {
      setToast("Selected accounts are already in Archive.");
      return false;
    }

    const saved = setAccounts((current) => current.map((account) => {
      if (!changedIds.has(account.id) || account.archived) return account;
      return { ...account, archived: true };
    }));
    if (!saved) return false;

    exitSelectionMode();
    setToast(`${archivedCount} ${archivedCount === 1 ? "account" : "accounts"} moved to Archive.`);
    return true;
  };

  const archiveSelectedAccounts = () => archiveAccountIds(selectedVisibleAccountIds);

  const dropSelectedAccountsOnPrimaryTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    target: "favorites" | "archive",
  ) => {
    if (!acceptsSelectedAccountDrag() || !canDropAccountIdsOnPrimaryTarget(draggedAccountIdsRef.current, target)) return;
    event.preventDefault();
    event.stopPropagation();
    const accountIds = new Set(draggedAccountIdsRef.current);
    clearSelectedAccountDrag();
    if (target === "favorites") addAccountIdsToFavorites(accountIds);
    else archiveAccountIds(accountIds);
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
    setSidebarMenuTarget(null);
    resetForm();
    if (view === "all" && group !== "All") setNewGroup(group);
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
        accountCreationEnabled={accountCreationEnabled}
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
      showGroupDragHint={view === "all"}
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
      onChangeLogo={(trigger) => {
        setBulkLogoReturnFocusTo(trigger);
        setBulkLogoOpen(true);
      }}
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

  const showAllAccounts = () => {
    exitSelectionMode();
    setAccountMenuId(null);
    setSidebarMenuTarget(null);
    setView("all");
    setGroup("All");
  };

  const showMainScreen = () => {
    exitSelectionMode();
    setAccountMenuId(null);
    setSidebarMenuTarget(null);
    setView("all");
    setGroup(vault ? defaultMainScreenGroup(vault) : "All");
  };
  const allCodesTarget: SidebarMenuTarget = { kind: "all" };
  const allCodesActive = view === "all" && group === "All";
  const allCodesDefault = isDefaultMainScreen(allCodesTarget);
  const allCodesMenuOpen = sidebarMenuIsOpen(allCodesTarget);
  const primarySelectionActive = selectionMode && view === "all" && selectedVisibleAccountIds.size > 0;
  const favoriteSelectionReady = primarySelectionActive && canAddAccountIdsToFavorites(selectedVisibleAccountIds);
  const archiveSelectionReady = primarySelectionActive && canArchiveAccountIds(selectedVisibleAccountIds);
  const favoriteDragReady = draggingSelectedAccounts && canAddAccountIdsToFavorites(draggedAccountIds);
  const archiveDragReady = draggingSelectedAccounts && canArchiveAccountIds(draggedAccountIds);
  const favoriteDropReady = favoriteSelectionReady || favoriteDragReady;
  const archiveDropReady = archiveSelectionReady || archiveDragReady;
  const favoriteDropTarget = favoriteDragReady && dragOverPrimaryTarget === "favorites";
  const archiveDropTarget = archiveDragReady && dragOverPrimaryTarget === "archive";
  const sidebarMenuStyle = sidebarMenuPosition
    ? { top: sidebarMenuPosition.top, left: sidebarMenuPosition.left }
    : undefined;

  return (
    <main className={`app-shell theme-${theme} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}>
      <aside
        ref={mobileSidebarRef}
        className="sidebar"
        id="primary-sidebar"
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen ? true : undefined}
        aria-label="Vault navigation"
        tabIndex={-1}
      >
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

        <div className="brand">
          <button type="button" className="brand-home" onClick={() => { showMainScreen(); closeMobileSidebar(); }} aria-label="Go to default main screen" title="Default main screen">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span className="brand-name">Coffer</span>
          </button>
          <button type="button" className="mobile-sidebar-close" onClick={closeMobileSidebar} aria-label="Close navigation" title="Close navigation">
            <span aria-hidden="true" />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <div
            className={`primary-nav-row ${allCodesActive ? "active" : ""} ${allCodesDefault ? "main-screen-default" : ""} ${allCodesMenuOpen ? "menu-open" : ""}`}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setSidebarMenuTarget(null);
                setConfirmingSidebarGroupDeletion(null);
              }
            }}
          >
            <button title="All codes" className="primary-nav-main" onClick={() => { showAllAccounts(); closeMobileSidebar(); }}><span className="nav-icon grid-icon" aria-hidden="true" />All codes<span className="nav-count">{accounts.filter((account) => !account.archived).length}</span></button>
            <button
              type="button"
              className="primary-options-button more-button"
              onClick={(event) => toggleSidebarMenu(allCodesTarget, event.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={allCodesMenuOpen}
              aria-label="Open All codes options"
              title="All codes options"
            >
              <span aria-hidden="true">•••</span>
            </button>
            {allCodesMenuOpen && (
              <div className="sidebar-options-menu primary-options-menu" role="menu" style={sidebarMenuStyle}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  className={allCodesDefault ? "sidebar-default-option" : undefined}
                  aria-checked={allCodesDefault}
                  disabled={allCodesDefault}
                  onClick={() => setDefaultMainScreen(allCodesTarget)}
                >
                  {allCodesDefault ? "Default main screen" : "Set default main screen"}
                </button>
              </div>
            )}
          </div>
          <button
            title={primarySelectionActive ? "Add selected accounts to Favorites" : "Favorites"}
            aria-label={primarySelectionActive ? "Add selected accounts to Favorites" : "Favorites"}
            className={`nav-item ${view === "favorites" ? "active" : ""} ${favoriteDropReady ? "drop-ready" : ""} ${favoriteDropTarget ? "drop-target" : ""}`}
            onDragEnter={(event) => dragSelectedAccountsOverPrimaryTarget(event, "favorites")}
            onDragOver={(event) => dragSelectedAccountsOverPrimaryTarget(event, "favorites")}
            onDragLeave={(event) => leaveSelectedAccountPrimaryTarget(event, "favorites")}
            onDrop={(event) => dropSelectedAccountsOnPrimaryTarget(event, "favorites")}
            onClick={() => {
              if (primarySelectionActive) {
                if (addAccountIdsToFavorites(new Set(selectedVisibleAccountIds))) closeMobileSidebar();
                return;
              }
              setView("favorites");
              setGroup("All");
              closeMobileSidebar();
            }}
          ><span className="nav-icon star-icon" aria-hidden="true">✦</span>Favorites<span className="nav-count">{accounts.filter((account) => account.favorite && !account.archived).length}</span></button>
          <button
            title={primarySelectionActive ? "Move selected accounts to Archive" : "Archive"}
            aria-label={primarySelectionActive ? "Move selected accounts to Archive" : "Archive"}
            className={`nav-item ${view === "archive" ? "active" : ""} ${archiveDropReady ? "drop-ready" : ""} ${archiveDropTarget ? "drop-target" : ""}`}
            onDragEnter={(event) => dragSelectedAccountsOverPrimaryTarget(event, "archive")}
            onDragOver={(event) => dragSelectedAccountsOverPrimaryTarget(event, "archive")}
            onDragLeave={(event) => leaveSelectedAccountPrimaryTarget(event, "archive")}
            onDrop={(event) => dropSelectedAccountsOnPrimaryTarget(event, "archive")}
            onClick={() => {
              if (primarySelectionActive) {
                if (archiveAccountIds(new Set(selectedVisibleAccountIds))) closeMobileSidebar();
                return;
              }
              exitSelectionMode();
              setView("archive");
              setGroup("All");
              closeMobileSidebar();
            }}
          ><span className="nav-icon trash-icon" aria-hidden="true" />Archive<span className="nav-count">{accounts.filter((account) => account.archived).length}</span></button>
          <button title="Data and backup" className={`nav-item ${view === "transfer" ? "active" : ""}`} onClick={() => { exitSelectionMode(); setView("transfer"); closeMobileSidebar(); }}><span className="nav-icon transfer-icon" aria-hidden="true" />Data &amp; backup</button>
          <button title="Settings" className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => { exitSelectionMode(); setView("settings"); closeMobileSidebar(); }}><span className="nav-icon settings-icon" aria-hidden="true" />Settings</button>
        </nav>

        <div className="sidebar-groups-heading">
          <span className="sidebar-label" id="sidebar-groups-label">Groups</span>
          <button
            type="button"
            className="group-add-button"
            onClick={(event) => beginGroupCreation(event.currentTarget)}
            disabled={selectionMode}
            aria-label="Create group"
            aria-haspopup="dialog"
            aria-expanded={creatingGroup}
            title={selectionMode ? "Finish selecting accounts before creating a group" : "Create group"}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <nav className="group-nav" aria-labelledby="sidebar-groups-label">
          {groups.map((name) => {
            const customization = customizationForGroup(name);
            const active = view === "all" && groupKey(group) === groupKey(name);
            const groupTarget: SidebarMenuTarget = { kind: "group", name };
            const groupDefault = isDefaultMainScreen(groupTarget);
            const groupMenuOpen = sidebarMenuIsOpen(groupTarget);
            const groupDeleteConfirming = Boolean(
              confirmingSidebarGroupDeletion &&
              groupKey(confirmingSidebarGroupDeletion) === groupKey(name)
            );
            const selectionMoveReady = selectionMode && view === "all" && selectedVisibleAccountIds.size > 0 && canMoveSelectedAccountsToGroup(name);
            const dragMoveReady = draggingSelectedAccounts && canMoveAccountIdsToGroup(draggedAccountIds, name);
            const dropReady = selectionMoveReady || dragMoveReady;
            const dropTarget = dragMoveReady && dragOverGroup === name;
            const groupDragSource = draggingGroup !== null && groupKey(draggingGroup) === groupKey(name);
            const reorderBefore = groupDropTarget?.name === name && groupDropTarget.edge === "before";
            const reorderAfter = groupDropTarget?.name === name && groupDropTarget.edge === "after";
            return (
              <div
                key={name}
                className={`group-nav-row ${active ? "active" : ""} ${groupDefault ? "main-screen-default" : ""} ${groupMenuOpen ? "menu-open" : ""} ${dropReady ? "drop-ready" : ""} ${dropTarget ? "drop-target" : ""} ${groupDragSource ? "group-drag-source" : ""} ${reorderBefore ? "reorder-before" : ""} ${reorderAfter ? "reorder-after" : ""}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setSidebarMenuTarget(null);
                    setConfirmingSidebarGroupDeletion(null);
                  }
                }}
                onDragEnter={(event) => groupDragNameRef.current
                  ? dragGroupOver(event, name)
                  : dragSelectedAccountsOverGroup(event, name)}
                onDragOver={(event) => groupDragNameRef.current
                  ? dragGroupOver(event, name)
                  : dragSelectedAccountsOverGroup(event, name)}
                onDragLeave={(event) => groupDragNameRef.current
                  ? leaveGroupDropTarget(event, name)
                  : leaveSelectedAccountDropTarget(event, name)}
                onDrop={(event) => groupDragNameRef.current
                  ? dropGroupOnGroup(event, name)
                  : dropSelectedAccountsOnGroup(event, name)}
              >
                <button
                  type="button"
                  className="group-nav-main"
                  data-group-name={name}
                  data-group-dragging={groupDragSource || undefined}
                  draggable={!selectionMode && groups.length > 1}
                  aria-pressed={active}
                  title={selectionMoveReady
                    ? `Move selected accounts to ${name}`
                    : `Open ${name}. Drag to reorder; right-click for options or press F2 to edit.`}
                  onDragStart={(event) => beginGroupReorder(event, name)}
                  onDragEnd={clearGroupDrag}
                  onClick={(event) => {
                    if (suppressGroupClickRef.current) {
                      event.preventDefault();
                      return;
                    }
                    if (selectionMoveReady) {
                      moveSelectedAccounts(name, false);
                      closeMobileSidebar();
                      return;
                    }
                    setSidebarMenuTarget(null);
                    setGroup(name);
                    setView("all");
                    closeMobileSidebar();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    toggleSidebarMenu(groupTarget, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      beginGroupCustomization(name, event.currentTarget);
                    } else if (event.shiftKey && event.key === "F10") {
                      event.preventDefault();
                      toggleSidebarMenu(groupTarget, event.currentTarget);
                    }
                  }}
                >
                  <span
                    className="group-symbol"
                    data-icon={customization.icon}
                    data-color={customization.color}
                    aria-hidden="true"
                  />
                  <span className="group-label">
                    <span className="group-name" data-i18n-ignore>{name}</span>
                    <span className="group-count">{counts[name]}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="group-options-button more-button"
                  onClick={(event) => toggleSidebarMenu(groupTarget, event.currentTarget)}
                  aria-haspopup="menu"
                  aria-expanded={groupMenuOpen}
                  aria-label={`Open ${name} group options`}
                  title={`${name} group options`}
                >
                  <span aria-hidden="true">•••</span>
                </button>
                {groupMenuOpen && (
                  <div className="sidebar-options-menu group-options-menu" role="menu" style={sidebarMenuStyle}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => beginGroupCustomization(name, event.currentTarget)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      className={groupDefault ? "sidebar-default-option" : undefined}
                      aria-checked={groupDefault}
                      disabled={groupDefault}
                      onClick={() => setDefaultMainScreen(groupTarget)}
                    >
                      {groupDefault ? "Default main screen" : "Set default main screen"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`sidebar-delete-option ${groupDeleteConfirming ? "confirming" : ""}`}
                      onClick={() => requestSidebarGroupDeletion(name)}
                    >
                      {groupDeleteConfirming ? "Confirm delete" : "Delete group"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <SidebarFooter />
      </aside>

      {mobileSidebarOpen && (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          onClick={closeMobileSidebar}
          aria-label="Close navigation overlay"
          tabIndex={-1}
        />
      )}

      <section className="workspace" id="codes" inert={mobileSidebarOpen ? true : undefined}>
        <header className="topbar">
          <button
            ref={mobileSidebarTriggerRef}
            type="button"
            className="mobile-sidebar-trigger icon-button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-controls="primary-sidebar"
            aria-expanded={mobileSidebarOpen}
            aria-label="Open navigation"
            title="Open navigation"
          >
            <span aria-hidden="true" />
          </button>
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
            >
              <span className="lock-button-icon" aria-hidden="true" />
            </button>
            <ThemeToggle theme={theme} onToggle={() => updateSettings({ theme: theme === "dark" ? "light" : "dark" })} />
            <ProfileMenu
              profile={profile}
              items={SETTINGS_MENU_ITEMS}
              onOpen={() => setAccountMenuId(null)}
              onSelect={openSettingsSection}
            />
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
            allowAccountCreation={instanceSettings.allowAccountCreation}
            onProfileChange={setProfile}
            onAutoLockMinutesChange={(minutes) => updateSettings({ autoLockMinutes: minutes })}
            onLockWhenHiddenChange={(enabled) => updateSettings({ lockWhenHidden: enabled })}
            onClearClipboardChange={(enabled) => updateSettings({ clearClipboard: enabled })}
            onAllowAccountCreationChange={setAccountCreationPreference}
            onNotice={setToast}
            onSignOut={() => void lockVault()}
            onChangePassword={changeOwnPassword}
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
                  onOpen={() => {
                    setAccountMenuId(null);
                    setSidebarMenuTarget(null);
                  }}
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
              <span className="visually-hidden" id="account-drag-instructions">With a mouse, hold outside the code row and drag an account onto another card to reorder it, or onto Favorites, Archive, or a sidebar group. Dragging a selected account moves the selection together. Keyboard and touch users can select accounts and choose the sidebar destination.</span>
              {visibleAccounts.map((account) => {
                const { current: currentCode, next: nextCode, remaining } = accountCodePreview(
                  account,
                  tick,
                  codePairs[account.id],
                );
                const revealNextCode = !locked && isTotpExpiring(remaining);
                const selected = selectedVisibleAccountIds.has(account.id);
                const accessibleCurrentCode = currentCode?.replace(/\s/gu, "").split("").join(" ");
                const draggableAccount = view === "all" && !account.archived;
                const reorderTarget = accountDropTarget?.id === account.id ? accountDropTarget : null;
                const accountCardProps: HTMLAttributes<HTMLElement> = {
                  draggable: draggableAccount,
                  "aria-describedby": draggableAccount ? "account-drag-instructions" : undefined,
                  title: draggableAccount
                    ? selectionMode && selected
                      ? "Hold and drag outside the code area to reorder or move selected accounts to Favorites, Archive, or a group"
                      : "Hold and drag outside the code area to reorder this account or move it to Favorites, Archive, or a group"
                    : undefined,
                  onMouseDown: (event) => prepareSelectedAccountDrag(event, account.id, draggableAccount),
                  onMouseEnter: (event) => updateSelectedAccountDragZone(event, draggableAccount),
                  onMouseMove: (event) => {
                    if (!selectedAccountDragRef.current) updateSelectedAccountDragZone(event, draggableAccount);
                  },
                  onMouseUp: () => {
                    if (!selectedAccountDragRef.current) selectedAccountDragOriginRef.current = null;
                  },
                  onMouseLeave: (event) => {
                    delete event.currentTarget.dataset.dragZone;
                    if (event.buttons === 0) selectedAccountDragOriginRef.current = null;
                  },
                  onDragStart: (event) => beginSelectedAccountDrag(event, account.id),
                  onDragEnter: (event) => dragSelectedAccountsOverAccount(event, account.id),
                  onDragOver: (event) => dragSelectedAccountsOverAccount(event, account.id),
                  onDragLeave: (event) => leaveSelectedAccountCardDropTarget(event, account.id),
                  onDrop: (event) => dropSelectedAccountsOnAccount(event, account.id),
                  onDragEnd: clearSelectedAccountDrag,
                  ...(selectionMode ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `${selected ? "Deselect" : "Select"} ${account.service} ${account.identity}`,
                    "aria-pressed": selected,
                    onClick: () => {
                      if (!suppressSelectedAccountClickRef.current) toggleAccountSelection(account.id);
                    },
                    onKeyDown: (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleAccountSelection(account.id);
                      }
                    },
                  } : {}),
                };
                return <article
                  className={`account-card ${account.archived ? "archived-card" : ""} ${selectionMode ? "selection-mode" : ""} ${selected ? "selected" : ""} ${draggingSelectedAccounts && draggedAccountIds.has(account.id) ? "drag-source" : ""} ${reorderTarget ? `account-drop-${reorderTarget.edge} account-drop-${reorderTarget.axis}` : ""}`}
                  key={account.id}
                  {...accountCardProps}
                >
                  <div className="account-topline">
                    <ServiceLogo
                      service={account.service}
                      fallback={account.letter}
                      color={account.color}
                      brandId={isServiceBrandId(account.iconBrand) ? account.iconBrand : null}
                      iconDataUrl={account.iconDataUrl}
                    />
                    <div className="service-meta" data-i18n-ignore><h2>{account.service}</h2><OverflowingIdentity text={account.identity} /></div>
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
                          <button className="more-button" aria-haspopup="menu" aria-expanded={accountMenuId === account.id} onClick={() => { setSidebarMenuTarget(null); setAccountMenuId((current) => current === account.id ? null : account.id); }} aria-label={`Open ${account.service} options`}>•••</button>
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
                    <div className={`code-stack ${!selectionMode && !locked && !revealNextCode ? "copy-current-area" : ""}`}>
                      {selectionMode ? (
                        <span className={`code selection-code ${revealNextCode ? "expiring-code" : ""}`} aria-hidden="true"><span className="code-value" data-digits={account.digits}>{locked ? "••• •••" : currentCode ?? "--- ---"}</span></span>
                      ) : (
                        <button
                          type="button"
                          className={`code ${revealNextCode ? "expiring-code" : ""}`}
                          onClick={() => copyCode(account)}
                          aria-label={accessibleCurrentCode ? `Copy ${account.service} ${account.identity} code ${accessibleCurrentCode}` : `Copy ${account.service} ${account.identity} code when ready`}
                        ><span className="code-value" data-digits={account.digits} aria-hidden="true">{locked ? "••• •••" : currentCode ?? "--- ---"}</span></button>
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
                      <input ref={manualServiceInputRef} className="service-entry-input" value={service} onChange={(event) => setService(event.target.value)} placeholder="e.g. GitHub" />
                    </div>
                  </label>
                  <label><span>Group</span><select value={newGroup} onChange={(event) => setNewGroup(event.target.value as Group)}>{entryGroups.map((name) => <option key={name} data-i18n-ignore>{name}</option>)}</select></label>
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
        open={creatingGroup || Boolean(customizingGroup)}
        group={activeGroupCustomization}
        mode={creatingGroup ? "create" : "edit"}
        existingNames={groups}
        onCancel={closeGroupCustomization}
        onSave={saveGroupCustomization}
        onDelete={creatingGroup ? undefined : deleteGroupCustomization}
        deleteDisabledReason={customizingGroup && accounts.some(
          (account) => groupKey(account.group) === groupKey(customizingGroup),
        ) ? "Move every active and archived account to another group before deleting this group." : undefined}
        returnFocusTo={groupCustomizationReturnFocusTo}
      />

      <AccountEditor
        account={editingAccount}
        brandOptions={accountIconOptions}
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

      <BulkLogoPicker
        open={bulkLogoOpen}
        selectedCount={selectedVisibleAccountIds.size}
        brandOptions={accountIconOptions}
        suggestedService={selectedLogoSuggestedService}
        retainedCustomLogoBytes={retainedCustomLogoBytes}
        previewAccount={selectedLogoPreviewAccount}
        returnFocusTo={bulkLogoReturnFocusTo}
        onApply={applySelectedAccountLogo}
        onClose={() => {
          setBulkLogoOpen(false);
          setBulkLogoReturnFocusTo(null);
        }}
      />

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite"><span className="toast-check">✓</span>{toast}</div>
    </main>
  );
}
