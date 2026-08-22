"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createDemoVault } from "../../lib/demo-vault";
import {
  formatCode,
  generateTotp,
  isTotpExpiring,
  totpWindow,
} from "../../lib/totp";
import {
  MAX_GROUP_CUSTOMIZATIONS,
  type PersistedVault,
  type VaultAccount,
  type VaultGroupColor,
  type VaultGroupCustomization,
  type VaultGroupIcon,
} from "../../lib/vault-model";
import BulkGroupActions, {
  AccountSelectionIndicator,
  ArchiveBulkActions,
  mouseIsOutsideAccountCodeRow,
  normalizeGroupName,
} from "../BulkGroupActions";
import CardViewMenu, { type CardView } from "../CardViewMenu";
import GroupCustomizationDialog from "../GroupCustomizationDialog";
import OverflowingIdentity from "../OverflowingIdentity";
import ProfileMenu from "../ProfileMenu";
import ServiceLogo, { isServiceBrandId } from "../ServiceLogo";
import ThemeToggle from "../ThemeToggle";
import DemoAccountEditor, {
  type DemoAccountEditorCodePreview,
  type DemoAccountEditorPatch,
} from "./DemoAccountEditor";
import DemoAddAccountDialog, { type DemoNewAccount } from "./DemoAddAccountDialog";
import DemoBulkLogoPicker from "./DemoBulkLogoPicker";
import DemoSidebarFooter from "./DemoSidebarFooter";
import DemoSettingsCenter from "./DemoSettingsCenter";
import DemoTransferCenter from "./DemoTransferCenter";

type DemoView = "all" | "favorites" | "archive" | "transfer" | "settings";
type GeneratedCodePair = Readonly<{
  counter: number;
  configKey: string;
  current: string;
  next: string;
}>;

const SAFE_SAMPLE_SECRET = "JBSWY3DPEHPK3PXP";
const NEW_GROUP_CUSTOMIZATION: VaultGroupCustomization = { name: "", icon: "folder", color: "rose" };
const DEFAULT_GROUP_ICONS: readonly VaultGroupIcon[] = ["dot", "folder", "briefcase", "person", "shield", "star", "home", "code"];
const DEFAULT_GROUP_COLORS: readonly VaultGroupColor[] = ["rose", "amber", "lime", "emerald", "sky", "blue", "violet", "slate"];
const COMMON_GROUP_STYLES: Readonly<Record<string, Pick<VaultGroupCustomization, "icon" | "color">>> = {
  personal: { icon: "person", color: "blue" },
  work: { icon: "briefcase", color: "amber" },
  finance: { icon: "shield", color: "lime" },
};
const SELECTED_ACCOUNT_DRAG_TYPE = "application/x-coffer-demo-selected-accounts";
const DEMO_ACCOUNT_COLORS: readonly VaultAccount["color"][] = ["violet", "green", "blue", "orange", "ink"];
const DEMO_SESSION_DURATION_MS = 60 * 60 * 1_000;

const DEMO_SETTINGS_MENU_ITEMS = [
  { id: "demo-profile-settings", label: "Profile" },
  { id: "demo-settings-root", label: "Settings" },
] as const;

function accountConfigurationKey(account: VaultAccount) {
  let hash = 2_166_136_261;
  const configuration = `${account.secret}\0${account.algorithm}\0${account.digits}\0${account.period}`;
  for (const character of configuration) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `${account.id}:${configuration.length}:${(hash >>> 0).toString(36)}`;
}

function codePreview(
  account: VaultAccount,
  timestamp: number,
  storedPair?: GeneratedCodePair,
) {
  if (timestamp <= 0) {
    return {
      current: null,
      next: null,
      remaining: account.period,
    };
  }

  const currentWindow = totpWindow(timestamp, account.period);
  const pairMatchesConfiguration = storedPair?.configKey === accountConfigurationKey(account);
  return {
    current: pairMatchesConfiguration && storedPair.counter === currentWindow.counter
      ? storedPair.current
      : pairMatchesConfiguration && storedPair.counter === currentWindow.counter - 1
        ? storedPair.next
        : null,
    next: pairMatchesConfiguration && storedPair.counter === currentWindow.counter
      ? storedPair.next
      : null,
    remaining: account.period - (Math.floor(timestamp / 1_000) % account.period),
  };
}

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

function accountInitials(service: string) {
  const words = service.trim().split(/\s+/u);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : service.slice(0, 2)).slice(0, 3).toUpperCase();
}

export default function DemoVaultApp() {
  const [vault, setVault] = useState<PersistedVault>(() => createDemoVault());
  const [demoSessionKey, setDemoSessionKey] = useState(0);
  const [demoLocked, setDemoLocked] = useState(false);
  const [view, setView] = useState<DemoView>("all");
  const [group, setGroup] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [cardView, setCardView] = useState<CardView>("default");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuId, setAccountMenuId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set());
  const [draggingSelectedAccounts, setDraggingSelectedAccounts] = useState(false);
  const [draggedAccountIds, setDraggedAccountIds] = useState<Set<string>>(() => new Set());
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [customizingGroup, setCustomizingGroup] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupCustomizationReturnFocusTo, setGroupCustomizationReturnFocusTo] = useState<HTMLElement | null>(null);
  const [bulkLogoOpen, setBulkLogoOpen] = useState(false);
  const [bulkLogoReturnFocusTo, setBulkLogoReturnFocusTo] = useState<HTMLButtonElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addReturnFocusTo, setAddReturnFocusTo] = useState<HTMLElement | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountEditorReturnFocusTo, setAccountEditorReturnFocusTo] = useState<HTMLButtonElement | null>(null);
  const [codePairs, setCodePairs] = useState<Record<string, GeneratedCodePair>>({});
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const demoLockButtonRef = useRef<HTMLButtonElement>(null);
  const demoUnlockButtonRef = useRef<HTMLButtonElement>(null);
  const demoWasLockedRef = useRef(false);
  const vaultRef = useRef(vault);
  const demoGenerationRef = useRef(0);
  const clipboardClearTimersRef = useRef<Set<number>>(new Set());
  const selectedAccountDragRef = useRef(false);
  const selectedAccountDragOriginRef = useRef<string | null>(null);
  const draggedAccountIdsRef = useRef<Set<string>>(new Set());
  const suppressSelectedAccountClickRef = useRef(false);
  const selectedAccountClickResetFrameRef = useRef<number | null>(null);
  const demoSessionDeadlineRef = useRef<number | null>(null);
  const accounts = vault.accounts;
  const editingAccount = editingAccountId ? accounts.find((account) => account.id === editingAccountId) ?? null : null;
  const editingCodePreview: DemoAccountEditorCodePreview | undefined = editingAccount
    ? { ...codePreview(editingAccount, tick, codePairs[editingAccount.id]), period: editingAccount.period }
    : undefined;

  const clearSelectedAccountDrag = useCallback(() => {
    selectedAccountDragRef.current = false;
    selectedAccountDragOriginRef.current = null;
    draggedAccountIdsRef.current.clear();
    setDraggingSelectedAccounts(false);
    setDraggedAccountIds(new Set());
    setDragOverGroup(null);
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

  const resetDemoSession = useCallback(() => {
    const freshVault = createDemoVault();
    demoGenerationRef.current += 1;
    selectedAccountDragRef.current = false;
    selectedAccountDragOriginRef.current = null;
    draggedAccountIdsRef.current.clear();
    setDraggedAccountIds(new Set());
    suppressSelectedAccountClickRef.current = false;
    if (selectedAccountClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(selectedAccountClickResetFrameRef.current);
      selectedAccountClickResetFrameRef.current = null;
    }
    for (const timer of clipboardClearTimersRef.current) window.clearTimeout(timer);
    clipboardClearTimersRef.current.clear();
    demoSessionDeadlineRef.current = Date.now() + DEMO_SESSION_DURATION_MS;
    vaultRef.current = freshVault;
    setVault(freshVault);
    setDemoLocked(false);
    setView("all");
    setGroup("All");
    setQuery("");
    setCardView("default");
    setSidebarCollapsed(false);
    setAccountMenuId(null);
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    setDraggingSelectedAccounts(false);
    setDragOverGroup(null);
    setCustomizingGroup(null);
    setCreatingGroup(false);
    setGroupCustomizationReturnFocusTo(null);
    setBulkLogoOpen(false);
    setBulkLogoReturnFocusTo(null);
    setAddOpen(false);
    setAddReturnFocusTo(null);
    setEditingAccountId(null);
    setAccountEditorReturnFocusTo(null);
    setCodePairs({});
    setTick(Date.now());
    setDemoSessionKey((current) => current + 1);
    setToast("The one-hour demo session reset to its original sample data.");
  }, []);

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  useEffect(() => {
    const initialFrame = window.requestAnimationFrame(() => setTick(Date.now()));
    const timer = window.setInterval(() => setTick(Date.now()), 1_000);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (demoSessionDeadlineRef.current === null) {
      demoSessionDeadlineRef.current = Date.now() + DEMO_SESSION_DURATION_MS;
    }
    const resetIfExpired = () => {
      const deadline = demoSessionDeadlineRef.current;
      if (deadline !== null && Date.now() >= deadline) resetDemoSession();
    };
    const deadline = demoSessionDeadlineRef.current;
    const timer = window.setTimeout(
      resetIfExpired,
      Math.max(0, deadline - Date.now()),
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resetIfExpired();
    };
    window.addEventListener("focus", resetIfExpired);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", resetIfExpired);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [demoSessionKey, resetDemoSession]);

  useEffect(() => () => {
    demoGenerationRef.current += 1;
    if (selectedAccountClickResetFrameRef.current !== null) {
      window.cancelAnimationFrame(selectedAccountClickResetFrameRef.current);
    }
    for (const timer of clipboardClearTimersRef.current) window.clearTimeout(timer);
    clipboardClearTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (demoLocked) {
      demoWasLockedRef.current = true;
      demoUnlockButtonRef.current?.focus();
    } else if (demoWasLockedRef.current) {
      demoLockButtonRef.current?.focus();
    }
  }, [demoLocked]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const searchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("en") === "k";
      const focusSearch = searchShortcut || (event.key === "/" && !typing);
      if (focusSearch && document.querySelector('[aria-modal="true"]')) return;
      if (focusSearch) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        setAccountMenuId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const setAccounts = useCallback((update: (current: VaultAccount[]) => VaultAccount[]) => {
    setVault((current) => {
      const nextAccounts = update(current.accounts);
      if (nextAccounts === current.accounts) return current;
      return {
        ...current,
        accounts: nextAccounts,
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const groups = useMemo(() => {
    const names = new Map<string, string>();
    for (const account of accounts) {
      if (!account.archived) names.set(groupKey(account.group), account.group);
    }
    for (const customization of vault.groupCustomizations) {
      names.set(groupKey(customization.name), customization.name);
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right, "en"));
  }, [accounts, vault.groupCustomizations]);

  const groupCustomizationMap = useMemo(() => new Map(
    vault.groupCustomizations.map((customization) => [groupKey(customization.name), customization]),
  ), [vault.groupCustomizations]);
  const customizationForGroup = useCallback((name: string) => (
    groupCustomizationMap.get(groupKey(name)) ?? defaultGroupCustomization(name)
  ), [groupCustomizationMap]);
  const activeGroupCustomization = creatingGroup
    ? NEW_GROUP_CUSTOMIZATION
    : customizingGroup ? customizationForGroup(customizingGroup) : null;
  const groupCounts = useMemo(() => Object.fromEntries(groups.map((name) => {
    const key = groupKey(name);
    return [name, accounts.filter((account) => !account.archived && groupKey(account.group) === key).length];
  })), [accounts, groups]);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    return accounts
      .filter((account) => {
        if (view === "archive" ? !account.archived : account.archived) return false;
        if (view === "favorites" && !account.favorite) return false;
        if (view === "all" && group !== "All" && groupKey(account.group) !== groupKey(group)) return false;
        if (!normalizedQuery) return true;
        return `${account.service}\0${account.identity}\0${account.group}`
          .toLocaleLowerCase("en")
          .includes(normalizedQuery);
      })
      .sort((left, right) => left.service.localeCompare(right.service, "en") || left.identity.localeCompare(right.identity, "en"));
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
  const selectedLogoSuggestedService = useMemo(() => {
    const services = new Map<string, string>();
    for (const account of accounts) {
      if (selectedVisibleAccountIds.has(account.id)) {
        services.set(account.service.trim().toLocaleLowerCase("en"), account.service.trim());
      }
    }
    return services.size === 1 ? [...services.values()][0] : null;
  }, [accounts, selectedVisibleAccountIds]);

  const accountConfigurationSetKey = accounts.map(accountConfigurationKey).join("|");
  const codeWindowKey = accounts
    .map((account) => `${accountConfigurationKey(account)}:${totpWindow(tick, account.period).counter}`)
    .join("|");

  useEffect(() => {
    let active = true;
    const generation = demoGenerationRef.current;
    const generatedAt = Date.now();
    Promise.all(accounts.map(async (account) => {
      const currentWindow = totpWindow(generatedAt, account.period);
      const [current, next] = await Promise.all([
        generateTotp(account.secret, currentWindow.currentTimestamp, account.digits, account.period, account.algorithm),
        generateTotp(account.secret, currentWindow.nextTimestamp, account.digits, account.period, account.algorithm),
      ]);
      return [account.id, {
        counter: currentWindow.counter,
        configKey: accountConfigurationKey(account),
        current: formatCode(current),
        next: formatCode(next),
      }] as const;
    }))
      .then((entries) => {
        if (
          !active
          || generation !== demoGenerationRef.current
          || vaultRef.current.accounts.map(accountConfigurationKey).join("|") !== accountConfigurationSetKey
        ) return;
        setCodePairs(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active && generation === demoGenerationRef.current) {
          setToast("A sample code could not be generated.");
        }
      });
    return () => {
      active = false;
    };
  }, [accountConfigurationSetKey, accounts, codeWindowKey]);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
    clearSelectedAccountDrag();
    setBulkLogoOpen(false);
    setBulkLogoReturnFocusTo(null);
  };

  const showAllAccounts = () => {
    exitSelectionMode();
    setView("all");
    setGroup("All");
    setAccountMenuId(null);
  };

  const showFavorites = () => {
    exitSelectionMode();
    setView("favorites");
    setGroup("All");
    setAccountMenuId(null);
  };

  const showArchive = () => {
    exitSelectionMode();
    setView("archive");
    setGroup("All");
    setAccountMenuId(null);
  };

  const showTransfer = () => {
    exitSelectionMode();
    setView("transfer");
    setGroup("All");
    setAccountMenuId(null);
  };

  const showSettings = () => {
    exitSelectionMode();
    setView("settings");
    setGroup("All");
    setAccountMenuId(null);
  };

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const beginGroupCreation = (trigger: HTMLElement) => {
    if (selectionMode) return;
    if (vaultRef.current.groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) {
      setToast("This demo has reached the maximum number of groups.");
      return;
    }
    setAccountMenuId(null);
    setGroupCustomizationReturnFocusTo(trigger);
    setCustomizingGroup(null);
    setCreatingGroup(true);
  };

  const beginGroupCustomization = (name: string, trigger: HTMLElement) => {
    if (!groups.some((candidate) => groupKey(candidate) === groupKey(name))) {
      setToast("This sample group is no longer available.");
      return;
    }
    setAccountMenuId(null);
    setGroupCustomizationReturnFocusTo(trigger);
    setCreatingGroup(false);
    setCustomizingGroup(name);
  };

  const closeGroupCustomization = () => {
    setCustomizingGroup(null);
    setCreatingGroup(false);
    setGroupCustomizationReturnFocusTo(null);
  };

  const saveGroupCustomization = (nextCustomization: VaultGroupCustomization) => {
    if (!creatingGroup && !customizingGroup) return false;
    const normalizedName = normalizeGroupName(nextCustomization.name);
    const normalizedKey = groupKey(normalizedName);
    const previousName = customizingGroup;
    const previousKey = previousName ? groupKey(previousName) : null;
    if (!normalizedName || normalizedName.length > 48 || normalizedKey === "all") return false;
    if (groups.some((name) => (
      groupKey(name) === normalizedKey && (creatingGroup || groupKey(name) !== previousKey)
    ))) {
      setToast("That sample group already exists.");
      return false;
    }

    if (creatingGroup) {
      if (vaultRef.current.groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) return false;
      setVault((current) => ({
        ...current,
        groupCustomizations: [...current.groupCustomizations, {
          name: normalizedName,
          icon: nextCustomization.icon,
          color: nextCustomization.color,
        }],
        updatedAt: new Date().toISOString(),
      }));
      closeGroupCustomization();
      setView("all");
      setGroup(normalizedName);
      setToast(`${normalizedName} sample group created.`);
      return true;
    }

    if (!previousName || !previousKey) return false;
    setVault((current) => ({
      ...current,
      accounts: current.accounts.map((account) => (
        groupKey(account.group) === previousKey ? { ...account, group: normalizedName } : account
      )),
      groupCustomizations: [
        ...current.groupCustomizations.filter((customization) => (
          groupKey(customization.name) !== previousKey && groupKey(customization.name) !== normalizedKey
        )),
        { name: normalizedName, icon: nextCustomization.icon, color: nextCustomization.color },
      ],
      updatedAt: new Date().toISOString(),
    }));
    if (groupKey(group) === previousKey) setGroup(normalizedName);
    closeGroupCustomization();
    setToast(previousName === normalizedName
      ? `${normalizedName} sample group updated.`
      : `${previousName} renamed to ${normalizedName}.`);
    return true;
  };

  const deleteGroupCustomization = () => {
    if (!customizingGroup) return false;
    const deletedName = customizingGroup;
    const deletedKey = groupKey(deletedName);
    if (vaultRef.current.accounts.some((account) => groupKey(account.group) === deletedKey)) {
      setToast("Move every active and archived sample account before deleting this group.");
      return false;
    }
    if (!vaultRef.current.groupCustomizations.some((customization) => groupKey(customization.name) === deletedKey)) {
      setToast("This sample group is no longer available.");
      return false;
    }
    setVault((current) => ({
      ...current,
      groupCustomizations: current.groupCustomizations.filter(
        (customization) => groupKey(customization.name) !== deletedKey,
      ),
      updatedAt: new Date().toISOString(),
    }));
    if (groupKey(group) === deletedKey) setGroup("All");
    closeGroupCustomization();
    setToast(`${deletedName} sample group deleted.`);
    return true;
  };

  const moveSelectedAccounts = (
    requestedGroup: string,
    createGroup: boolean,
    accountIds: ReadonlySet<string> = selectedVisibleAccountIds,
    openTargetGroup = true,
  ) => {
    if (accountIds.size === 0) {
      setToast("Select at least one sample account to move.");
      return false;
    }
    const normalizedName = normalizeGroupName(requestedGroup);
    const normalizedKey = groupKey(normalizedName);
    if (!normalizedName || normalizedName.length > 48 || normalizedKey === "all") {
      setToast("Use a group name between 1 and 48 characters. “All” is reserved.");
      return false;
    }
    const existingGroup = groups.find((name) => groupKey(name) === normalizedKey);
    if (createGroup && existingGroup) {
      setToast("That sample group already exists.");
      return false;
    }
    if (!createGroup && !existingGroup) {
      setToast("Choose an existing sample group.");
      return false;
    }
    if (createGroup && vaultRef.current.groupCustomizations.length >= MAX_GROUP_CUSTOMIZATIONS) {
      setToast("This demo has reached the maximum number of groups.");
      return false;
    }

    const targetGroup = existingGroup ?? normalizedName;
    const targetKey = groupKey(targetGroup);
    const selected = new Set(accountIds);
    const changedIds = new Set(accounts.filter((account) => (
      selected.has(account.id) && !account.archived && groupKey(account.group) !== targetKey
    )).map((account) => account.id));
    if (changedIds.size === 0) {
      setToast(`Selected sample accounts are already in ${targetGroup}.`);
      return false;
    }
    setVault((current) => ({
      ...current,
      accounts: current.accounts.map((account) => (
        changedIds.has(account.id) && !account.archived ? { ...account, group: targetGroup } : account
      )),
      groupCustomizations: createGroup
        ? [...current.groupCustomizations, defaultGroupCustomization(targetGroup)]
        : current.groupCustomizations,
      updatedAt: new Date().toISOString(),
    }));
    if (openTargetGroup) {
      setView("all");
      setGroup(targetGroup);
    }
    exitSelectionMode();
    setToast(`${changedIds.size} ${changedIds.size === 1 ? "sample account" : "sample accounts"} moved to ${targetGroup}.`);
    return true;
  };

  const applySelectedAccountLogo = (iconBrand: string | null) => {
    if (selectedVisibleAccountIds.size === 0) return false;
    if (iconBrand && !isServiceBrandId(iconBrand)) {
      setToast("Choose a logo from Coffer's local catalog.");
      return false;
    }
    const selected = new Set(selectedVisibleAccountIds);
    let changedCount = 0;
    setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || account.archived || (account.iconBrand === iconBrand && !account.iconDataUrl)) {
        return account;
      }
      changedCount += 1;
      return { ...account, iconBrand, iconDataUrl: null };
    }));
    setToast(changedCount === 0
      ? "The selected sample accounts already use that logo choice."
      : `Logo applied to ${changedCount} ${changedCount === 1 ? "sample account" : "sample accounts"}.`);
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
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SELECTED_ACCOUNT_DRAG_TYPE, "1");
    event.dataTransfer.setData("text/plain", "coffer-demo-accounts");
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
  };

  const acceptsSelectedAccountDrag = () => selectedAccountDragRef.current;

  const canMoveAccountIdsToGroup = (accountIds: ReadonlySet<string>, groupName: string) => {
    const targetKey = groupKey(groupName);
    return accounts.some((account) => (
      accountIds.has(account.id) && !account.archived && groupKey(account.group) !== targetKey
    ));
  };

  const canMoveSelectedAccountsToGroup = (groupName: string) => (
    canMoveAccountIdsToGroup(selectedVisibleAccountIds, groupName)
  );

  const dragSelectedAccountsOverGroup = (event: ReactDragEvent<HTMLDivElement>, groupName: string) => {
    if (!acceptsSelectedAccountDrag() || !canMoveAccountIdsToGroup(draggedAccountIdsRef.current, groupName)) return;
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

  const setSelectedAccountsFavorite = (favorite: boolean) => {
    if (selectedVisibleAccountIds.size === 0) return false;
    const selected = new Set(selectedVisibleAccountIds);
    let changedCount = 0;
    setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || account.archived || account.favorite === favorite) return account;
      changedCount += 1;
      return { ...account, favorite };
    }));
    setToast(changedCount === 0
      ? `Selected sample accounts are already ${favorite ? "in Favorites" : "not in Favorites"}.`
      : `${changedCount} ${changedCount === 1 ? "sample account" : "sample accounts"} ${favorite ? "added to" : "removed from"} Favorites.`);
    return true;
  };

  const archiveSelectedAccounts = () => {
    if (selectedVisibleAccountIds.size === 0) return false;
    const selected = new Set(selectedVisibleAccountIds);
    let archivedCount = 0;
    setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || account.archived) return account;
      archivedCount += 1;
      return { ...account, archived: true };
    }));
    exitSelectionMode();
    setToast(`${archivedCount} ${archivedCount === 1 ? "sample account" : "sample accounts"} moved to Archive.`);
    return true;
  };

  const restoreSelectedArchivedAccounts = () => {
    if (selectedVisibleAccountIds.size === 0) return false;
    const selected = new Set(selectedVisibleAccountIds);
    let restoredCount = 0;
    setAccounts((current) => current.map((account) => {
      if (!selected.has(account.id) || !account.archived) return account;
      restoredCount += 1;
      return { ...account, archived: false };
    }));
    exitSelectionMode();
    setToast(`${restoredCount} ${restoredCount === 1 ? "sample account" : "sample accounts"} restored to All codes.`);
    return true;
  };

  const deleteSelectedArchivedAccounts = () => {
    const selected = new Set(selectedVisibleAccountIds);
    const deleteCount = accounts.filter((account) => selected.has(account.id) && account.archived).length;
    if (deleteCount === 0) return false;
    if (!window.confirm(`Remove ${deleteCount} selected demo ${deleteCount === 1 ? "account" : "accounts"}?\n\nThis only changes the temporary demo.`)) {
      return false;
    }
    setAccounts((current) => current.filter((account) => !selected.has(account.id) || !account.archived));
    exitSelectionMode();
    setToast(`${deleteCount} ${deleteCount === 1 ? "sample account was" : "sample accounts were"} removed from this demo.`);
    return true;
  };

  const restoreAllArchivedAccounts = () => {
    let restoredCount = 0;
    setAccounts((current) => current.map((account) => {
      if (!account.archived) return account;
      restoredCount += 1;
      return { ...account, archived: false };
    }));
    setAccountMenuId(null);
    setToast(`${restoredCount} ${restoredCount === 1 ? "sample account" : "sample accounts"} restored to All codes.`);
  };

  const openDemoAccountEditor = (accountId: string, trigger: HTMLButtonElement) => {
    if (!vaultRef.current.accounts.some((account) => account.id === accountId)) {
      setAccountMenuId(null);
      setToast("This sample account is no longer available.");
      return;
    }
    setAccountEditorReturnFocusTo(trigger);
    setEditingAccountId(accountId);
  };

  const saveDemoAccountEdits = (accountId: string, patch: DemoAccountEditorPatch) => {
    const target = vaultRef.current.accounts.find((account) => account.id === accountId);
    if (!target) throw new Error("This sample account is no longer available.");

    setAccounts((current) => current.map((account) => (
      account.id === accountId ? {
        ...account,
        service: patch.service,
        identity: patch.identity,
        letter: accountInitials(patch.service),
        iconBrand: patch.iconBrand,
        iconDataUrl: null,
        algorithm: patch.algorithm,
        digits: patch.digits,
        period: patch.period,
      } : account
    )));
    setToast(`${patch.service} sample account updated. Changes reset on refresh or after one hour.`);
  };

  const openDemoSettingsSection = (sectionId: string) => {
    showSettings();
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

  const toggleFavorite = (accountId: string) => {
    const currentAccount = vaultRef.current.accounts.find((account) => account.id === accountId);
    if (!currentAccount) return;
    const favorited = !currentAccount.favorite;
    setAccounts((current) => current.map((account) => {
      if (account.id !== accountId) return account;
      return { ...account, favorite: favorited };
    }));
    setAccountMenuId(null);
    setToast(favorited ? "Sample account added to Favorites." : "Sample account removed from Favorites.");
  };

  const toggleArchive = (accountId: string) => {
    const currentAccount = vaultRef.current.accounts.find((account) => account.id === accountId);
    if (!currentAccount) return;
    const archived = !currentAccount.archived;
    setAccounts((current) => current.map((account) => {
      if (account.id !== accountId) return account;
      return { ...account, archived };
    }));
    setAccountMenuId(null);
    setToast(archived ? "Sample account moved to Archive." : "Sample account restored.");
  };

  const removeSampleAccount = (accountId: string) => {
    setAccounts((current) => current.filter((account) => account.id !== accountId));
    setAccountMenuId(null);
    setToast("Sample account removed from this demo.");
  };

  const openDemoAddAccount = (trigger: HTMLElement) => {
    exitSelectionMode();
    setAccountMenuId(null);
    setAddReturnFocusTo(trigger);
    setAddOpen(true);
  };

  const addDemoAccount = (sample: DemoNewAccount) => {
    const account: VaultAccount = {
      id: `demo-added-${Date.now()}-${accounts.length}`,
      service: sample.service,
      identity: sample.identity,
      secret: SAFE_SAMPLE_SECRET,
      group: sample.group,
      color: DEMO_ACCOUNT_COLORS[accounts.length % DEMO_ACCOUNT_COLORS.length],
      letter: accountInitials(sample.service),
      favorite: false,
      lastUsed: Date.now(),
      algorithm: sample.algorithm,
      digits: sample.digits,
      period: sample.period,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    };
    setAccounts((current) => [...current, account]);
    setView("all");
    setGroup("All");
    setAccountMenuId(null);
    setToast(`${account.service} sample account added.`);
    return true;
  };

  const copyCode = async (account: VaultAccount) => {
    const generation = demoGenerationRef.current;
    const configurationKey = accountConfigurationKey(account);
    let code: string;
    try {
      code = await generateTotp(
        account.secret,
        Date.now(),
        account.digits,
        account.period,
        account.algorithm,
      );
    } catch {
      setToast("This sample code could not be generated.");
      return;
    }

    const currentAccount = vaultRef.current.accounts.find((candidate) => candidate.id === account.id);
    if (
      generation !== demoGenerationRef.current
      || !currentAccount
      || accountConfigurationKey(currentAccount) !== configurationKey
    ) return;

    try {
      await navigator.clipboard.writeText(code);
      const latestAccount = vaultRef.current.accounts.find((candidate) => candidate.id === account.id);
      if (
        generation !== demoGenerationRef.current
        || !latestAccount
        || accountConfigurationKey(latestAccount) !== configurationKey
      ) return;
      navigator.vibrate?.(10);
      setToast(`${account.service} sample code copied.`);
      if (vaultRef.current.settings.clearClipboard) {
        const clipboardTimer = window.setTimeout(async () => {
          try {
            if (await navigator.clipboard.readText() === code) {
              await navigator.clipboard.writeText("");
            }
          } catch {
            // Clipboard cleanup is best-effort and may be blocked by browser permissions.
          } finally {
            clipboardClearTimersRef.current.delete(clipboardTimer);
          }
        }, 30_000);
        clipboardClearTimersRef.current.add(clipboardTimer);
      }
    } catch {
      setToast("Clipboard access is unavailable in this browser.");
    }
  };

  const activeAccountCount = accounts.filter((account) => !account.archived).length;
  const favoriteAccountCount = accounts.filter((account) => account.favorite && !account.archived).length;
  const archivedAccountCount = accounts.filter((account) => account.archived).length;

  if (demoLocked) {
    return (
      <main className={`transfer-center auth-screen demo-lock-screen theme-${vault.settings.theme}`} aria-labelledby="demo-lock-title">
        <section className="transfer-panel auth-loading demo-lock-panel">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>Coffer</span>
          </div>
          <span className="demo-lock-icon lock-button" aria-hidden="true"><span /></span>
          <h1 id="demo-lock-title">Demo vault locked</h1>
          <p className="subtitle">Your temporary sample data is hidden but remains in this browser&apos;s memory. No password is required for the public demo.</p>
          <button
            ref={demoUnlockButtonRef}
            type="button"
            className="transfer-primary demo-unlock-button"
            onClick={() => {
              setDemoLocked(false);
              setToast("Demo vault unlocked.");
            }}
          >Unlock demo <span aria-hidden="true">→</span></button>
        </section>
      </main>
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

  return (
    <main key={demoSessionKey} className={`app-shell demo-shell theme-${vault.settings.theme} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" id="demo-primary-sidebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-controls="demo-primary-sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span aria-hidden="true" />
        </button>

        <div className="brand">
          <button type="button" className="brand-home" onClick={showAllAccounts} aria-label="Go to all sample codes" title="All sample codes">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span className="brand-name">Coffer</span>
          </button>
        </div>

        <nav className="primary-nav" aria-label="Demo navigation">
          <button type="button" title="All sample codes" className={`nav-item ${view === "all" ? "active" : ""}`} onClick={showAllAccounts}>
            <span className="nav-icon grid-icon" aria-hidden="true" />All codes<span className="nav-count">{activeAccountCount}</span>
          </button>
          <button type="button" title="Favorite sample accounts" className={`nav-item ${view === "favorites" ? "active" : ""}`} onClick={showFavorites}>
            <span className="nav-icon star-icon" aria-hidden="true" />Favorites<span className="nav-count">{favoriteAccountCount}</span>
          </button>
          <button type="button" title="Archived sample accounts" className={`nav-item ${view === "archive" ? "active" : ""}`} onClick={showArchive}>
            <span className="nav-icon trash-icon" aria-hidden="true" />Archive<span className="nav-count">{archivedAccountCount}</span>
          </button>
          <button type="button" className={`nav-item ${view === "transfer" ? "active" : ""}`} title="Preview data and backup" onClick={showTransfer}>
            <span className="nav-icon transfer-icon" aria-hidden="true" />Data &amp; backup
          </button>
          <button type="button" className={`nav-item ${view === "settings" ? "active" : ""}`} title="Demo settings" onClick={showSettings}>
            <span className="nav-icon settings-icon" aria-hidden="true" />Settings
          </button>
        </nav>

        <div className="sidebar-groups-heading">
          <span className="sidebar-label" id="demo-sidebar-groups-label">Groups</span>
          <button
            type="button"
            className="group-add-button"
            onClick={(event) => beginGroupCreation(event.currentTarget)}
            disabled={selectionMode}
            aria-label="Create sample group"
            aria-haspopup="dialog"
            aria-expanded={creatingGroup}
            title={selectionMode ? "Finish selecting accounts before creating a group" : "Create sample group"}
          ><span aria-hidden="true">+</span></button>
        </div>
        <nav className="group-nav" aria-labelledby="demo-sidebar-groups-label">
          {groups.map((name) => {
            const customization = customizationForGroup(name);
            const active = view === "all" && groupKey(group) === groupKey(name);
            const selectionMoveReady = selectionMode && view === "all" && selectedVisibleAccountIds.size > 0 && canMoveSelectedAccountsToGroup(name);
            const dragMoveReady = draggingSelectedAccounts && canMoveAccountIdsToGroup(draggedAccountIds, name);
            const dropReady = selectionMoveReady || dragMoveReady;
            const dropTarget = dragMoveReady && dragOverGroup === name;
            return (
              <div
                key={name}
                className={`group-nav-row ${active ? "active" : ""} ${dropReady ? "drop-ready" : ""} ${dropTarget ? "drop-target" : ""}`}
                onDragEnter={(event) => dragSelectedAccountsOverGroup(event, name)}
                onDragOver={(event) => dragSelectedAccountsOverGroup(event, name)}
                onDragLeave={(event) => leaveSelectedAccountDropTarget(event, name)}
                onDrop={(event) => dropSelectedAccountsOnGroup(event, name)}
              >
                <button
                  type="button"
                  className="group-nav-main"
                  data-group-name={name}
                  aria-pressed={active}
                  title={selectionMoveReady
                    ? `Move selected sample accounts to ${name}`
                    : `Open ${name}. Right-click or press F2 to customize.`}
                  onClick={() => {
                    if (selectionMoveReady) {
                      moveSelectedAccounts(name, false);
                      return;
                    }
                    exitSelectionMode();
                    setGroup(name);
                    setView("all");
                    setAccountMenuId(null);
                  }}
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
                  <span className="group-symbol" data-icon={customization.icon} data-color={customization.color} aria-hidden="true" />
                  <span className="group-name">{name}</span>
                  <span className="group-count">{groupCounts[name]}</span>
                </button>
                <button
                  type="button"
                  className="group-options-button more-button"
                  onClick={(event) => beginGroupCustomization(name, event.currentTarget)}
                  aria-haspopup="dialog"
                  aria-label={`Customize ${name} sample group`}
                  title={`Customize ${name} sample group`}
                ><span aria-hidden="true">•••</span></button>
              </div>
            );
          })}
        </nav>

        <DemoSidebarFooter onAbout={() => openDemoSettingsSection("demo-about-settings")} />
      </aside>

      <section className="workspace" id="demo-codes">
        <header className="topbar">
          <label className="search">
            <span className="search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sample accounts…"
              aria-label="Search sample authenticator accounts"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <span className="sync-state demo-badge" role="status"><i />Demo changes are not saved</span>
            <button
              ref={demoLockButtonRef}
              type="button"
              className="icon-button lock-button"
              onClick={() => {
                clearSelectedAccountDrag();
                setAccountMenuId(null);
                setDemoLocked(true);
              }}
              aria-label="Lock demo vault"
              title="Lock demo vault"
            ><span aria-hidden="true" /></button>
            <ThemeToggle
              theme={vault.settings.theme}
              onToggle={() => setVault((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  theme: current.settings.theme === "dark" ? "light" : "dark",
                },
                updatedAt: new Date().toISOString(),
              }))}
            />
            <ProfileMenu
              profile={vault.profile}
              items={DEMO_SETTINGS_MENU_ITEMS}
              onOpen={() => setAccountMenuId(null)}
              onSelect={openDemoSettingsSection}
              title="Open demo profile menu"
            />
          </div>
        </header>

        <section className="demo-banner" aria-labelledby="demo-banner-title">
          <span className="demo-badge" aria-hidden="true">Live demo</span>
          <div className="demo-banner-copy">
            <strong id="demo-banner-title">Explore a temporary sample vault</strong>
            <p>Sample accounts only. Changes reset on refresh and automatically every hour. Never enter real secrets in this demo.</p>
          </div>
        </section>

        {view === "transfer" ? (
          <DemoTransferCenter />
        ) : view === "settings" ? (
          <DemoSettingsCenter
            profile={vault.profile}
            settings={vault.settings}
          />
        ) : (
        <div className="content">
          {view !== "archive" && !selectionMode && (
            <div className="title-row title-row-actions-only">
              <div className="title-row-account-actions">
                <CardViewMenu value={cardView} onChange={setCardView} onOpen={() => setAccountMenuId(null)} />
                <button type="button" className="add-button" onClick={(event) => openDemoAddAccount(event.currentTarget)}><span aria-hidden="true">+</span>Add sample account</button>
                {selectableVisibleIds.length > 0 && bulkGroupActions}
              </div>
            </div>
          )}

          {view === "archive" && !selectionMode && archivedAccountCount > 0 && (
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
              <section className="archive-explainer" aria-label="About the demo Archive">
                <span className="archive-explainer-icon" aria-hidden="true"><span className="nav-icon trash-icon" /></span>
                <div><strong>Temporary archive</strong><p>These sample accounts keep generating codes and return after a demo reset.</p></div>
                <span>{archivedAccountCount} archived</span>
              </section>
              {selectableVisibleIds.length > 0 && archiveBulkActions}
            </>
          ) : query.trim() ? (
            <p className="result-count" role="status">{visibleAccounts.length} {visibleAccounts.length === 1 ? "account" : "accounts"}</p>
          ) : null}

          {view !== "archive" && selectionMode && bulkGroupActions}

          {visibleAccounts.length > 0 ? (
            <section className="account-grid" data-card-view={cardView} aria-label="Sample authenticator accounts">
              <span className="visually-hidden" id="demo-account-drag-instructions">With a mouse, hold outside the code row and drag a sample account to a sidebar group. Dragging a selected account moves the selection together. Keyboard and touch users can use Move to group.</span>
              {visibleAccounts.map((account) => {
                const { current: currentCode, next: nextCode, remaining } = codePreview(account, tick, codePairs[account.id]);
                const revealNextCode = isTotpExpiring(remaining);
                const selected = selectedVisibleAccountIds.has(account.id);
                const accessibleCurrentCode = currentCode?.replace(/\s/gu, "").split("").join(" ");
                const draggableAccount = view === "all" && !account.archived;
                const accountCardProps: HTMLAttributes<HTMLElement> = {
                  draggable: draggableAccount,
                  "aria-describedby": draggableAccount ? "demo-account-drag-instructions" : undefined,
                  title: draggableAccount
                    ? selectionMode && selected
                      ? "Hold and drag outside the code area to move selected sample accounts"
                      : "Hold and drag outside the code area to move this sample account"
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
                return (
                  <article
                    className={`account-card ${account.archived ? "archived-card" : ""} ${selectionMode ? "selection-mode" : ""} ${selected ? "selected" : ""} ${draggingSelectedAccounts && draggedAccountIds.has(account.id) ? "drag-source" : ""}`}
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
                      <div className="service-meta"><h2>{account.service}</h2><OverflowingIdentity text={account.identity} /></div>
                      {selectionMode ? (
                        <AccountSelectionIndicator selected={selected} />
                      ) : (
                      <div className="account-card-actions">
                        {account.archived && <span className="archived-badge">Archived</span>}
                        {!account.archived && (
                          <button
                            type="button"
                            className={`favorite ${account.favorite ? "selected" : ""}`}
                            onClick={() => toggleFavorite(account.id)}
                            aria-label={`${account.favorite ? "Remove" : "Add"} ${account.service} ${account.favorite ? "from" : "to"} favorites`}
                          >✦</button>
                        )}
                        <div
                          className="account-menu-wrap"
                          onBlur={(event) => {
                            if (editingAccountId !== account.id && !event.currentTarget.contains(event.relatedTarget)) {
                              setAccountMenuId(null);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="more-button"
                            aria-haspopup="menu"
                            aria-expanded={accountMenuId === account.id}
                            aria-controls={accountMenuId === account.id ? `demo-account-menu-${account.id}` : undefined}
                            onClick={() => setAccountMenuId((current) => current === account.id ? null : account.id)}
                            aria-label={`Open ${account.service} sample options`}
                          >•••</button>
                          {accountMenuId === account.id && (
                            <div className="account-menu" id={`demo-account-menu-${account.id}`} role="menu">
                              <button type="button" role="menuitem" onClick={(event) => openDemoAccountEditor(account.id, event.currentTarget)}>Edit account</button>
                              {!account.archived && <button type="button" role="menuitem" onClick={() => toggleFavorite(account.id)}>{account.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>}
                              {!account.archived && <button type="button" role="menuitem" onClick={() => toggleArchive(account.id)}>Move to Archive</button>}
                              {account.archived && <button type="button" role="menuitem" className="danger" onClick={() => removeSampleAccount(account.id)}>Remove sample account</button>}
                            </div>
                          )}
                        </div>
                      </div>
                      )}
                    </div>
                    <div className="code-row">
                      <div className={`code-stack ${!selectionMode && !revealNextCode ? "copy-current-area" : ""}`}>
                        {selectionMode ? (
                          <span className={`code selection-code ${revealNextCode ? "expiring-code" : ""}`} aria-hidden="true"><span className="code-value" data-digits={account.digits}>{currentCode ?? "--- ---"}</span></span>
                        ) : (
                        <button
                          type="button"
                          className={`code ${revealNextCode ? "expiring-code" : ""}`}
                          onClick={() => void copyCode(account)}
                          aria-label={accessibleCurrentCode
                            ? `Copy ${account.service} ${account.identity} sample code ${accessibleCurrentCode}`
                            : `Copy ${account.service} ${account.identity} sample code when ready`}
                        ><span className="code-value" data-digits={account.digits} aria-hidden="true">{currentCode ?? "--- ---"}</span></button>
                        )}
                        <div className={`next-code ${revealNextCode ? "visible" : ""}`} aria-hidden={selectionMode || !revealNextCode ? true : undefined}>
                          <span className="visually-hidden">{nextCode ? `Next sample code ${nextCode.replace(/\s/gu, "").split("").join(" ")}` : "Next sample code loading"}</span>
                          <span className="next-code-label" aria-hidden="true">Next</span>
                          <span className="next-code-value" aria-hidden="true">{nextCode ?? "--- ---"}</span>
                        </div>
                      </div>
                      <div
                        className={`countdown ${revealNextCode ? "urgent" : ""}`}
                        style={{ "--progress": `${(remaining / account.period) * 360}deg` } as CSSProperties}
                      ><span>{remaining}</span></div>
                    </div>
                  </article>
                );
              })}

              {view !== "archive" && !selectionMode && (
                <button type="button" className="add-card" onClick={(event) => openDemoAddAccount(event.currentTarget)} aria-label="Add another safe sample authenticator account">
                  <span className="add-card-icon" aria-hidden="true">+</span>
                  <strong>Add a sample account</strong>
                  <small>Uses a known dummy secret and stays only in this demo</small>
                </button>
              )}
            </section>
          ) : (
            <section className="empty-state">
              <div className="empty-rings" aria-hidden="true"><span /><span /><span /></div>
              <h2>{view === "archive" ? query.trim() ? "No archived samples found" : "Demo Archive is empty" : "No sample codes found"}</h2>
              <p>{view === "archive" ? query.trim() ? "Try a different search." : "Archive a sample account to see it here." : "Try another search or add a safe sample account."}</p>
              {view === "archive" ? (
                <button type="button" onClick={() => { if (query.trim()) setQuery(""); else showAllAccounts(); }}>{query.trim() ? "Clear search" : "Back to all codes"}</button>
              ) : (
                <button type="button" onClick={(event) => openDemoAddAccount(event.currentTarget)}>Add sample account</button>
              )}
            </section>
          )}
        </div>
        )}
      </section>

      <DemoAddAccountDialog
        open={addOpen}
        groups={groups.length > 0 ? groups : ["Personal"]}
        preferredGroup={group !== "All" ? group : undefined}
        returnFocusTo={addReturnFocusTo}
        onAdd={addDemoAccount}
        onClose={() => {
          setAddOpen(false);
          setAddReturnFocusTo(null);
        }}
      />

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
        ) ? "Move every active and archived sample account to another group before deleting this group." : undefined}
        returnFocusTo={groupCustomizationReturnFocusTo}
      />

      <DemoAccountEditor
        account={editingAccount}
        codePreview={editingCodePreview}
        onClose={() => {
          setEditingAccountId(null);
          setAccountEditorReturnFocusTo(null);
        }}
        onSave={saveDemoAccountEdits}
        returnFocusTo={accountEditorReturnFocusTo}
        renderIcon={({ color, iconBrand, iconDataUrl, letter, service: previewService }) => (
          <ServiceLogo
            color={color}
            fallback={letter}
            service={previewService}
            brandId={isServiceBrandId(iconBrand) ? iconBrand : null}
            iconDataUrl={iconDataUrl}
          />
        )}
      />

      <DemoBulkLogoPicker
        open={bulkLogoOpen}
        selectedCount={selectedVisibleAccountIds.size}
        suggestedService={selectedLogoSuggestedService}
        previewAccount={selectedLogoPreviewAccount}
        returnFocusTo={bulkLogoReturnFocusTo}
        onApply={applySelectedAccountLogo}
        onClose={() => {
          setBulkLogoOpen(false);
          setBulkLogoReturnFocusTo(null);
        }}
      />

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">
        <span className="toast-check" aria-hidden="true">✓</span>{toast}
      </div>
    </main>
  );
}
