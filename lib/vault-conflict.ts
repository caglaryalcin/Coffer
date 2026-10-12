import { isUngroupedAccountGroup, type PersistedVault, type VaultAccount } from "./vault-model";

export type VaultConflictAccountSummary = {
  id: string;
  label: string;
};

export type VaultConflictValueChange = {
  field: string;
  browserValue: string;
  serverValue: string;
};

export type VaultConflictAccountChange = {
  id: string;
  browserLabel: string;
  serverLabel: string;
  changes: VaultConflictValueChange[];
};

export type VaultConflictDiff = {
  browserAccountCount: number;
  serverAccountCount: number;
  browserUpdatedAt: string;
  serverUpdatedAt: string;
  browserOnlyAccounts: VaultConflictAccountSummary[];
  serverOnlyAccounts: VaultConflictAccountSummary[];
  changedAccounts: VaultConflictAccountChange[];
  profileChanges: VaultConflictValueChange[];
  settingsChanges: VaultConflictValueChange[];
  groupChanges: VaultConflictValueChange[];
  accountOrderChanged: boolean;
  accountOrderChange: VaultConflictValueChange | null;
  hasContentDifferences: boolean;
};

function equalArray(left: readonly unknown[], right: readonly unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function accountLabel(account: VaultAccount) {
  const service = account.service.trim() || "Unnamed account";
  const identity = account.identity.trim();
  return identity ? `${service} · ${identity}` : service;
}

function valueChange(field: string, browserValue: string, serverValue: string): VaultConflictValueChange {
  return { field, browserValue, serverValue };
}

function summarizeValues(values: readonly string[], limit = 10) {
  if (values.length === 0) return "None";
  const visible = values.slice(0, limit).join(" → ");
  return values.length > limit ? `${visible} · +${values.length - limit} more` : visible;
}

function describeUrls(urls: readonly string[]) {
  return urls.length > 0 ? summarizeValues(urls, 5) : "None";
}

function describeLogo(account: VaultAccount) {
  if (account.iconDataUrl) return "Custom logo";
  if (account.iconBrand) return `Brand: ${account.iconBrand}`;
  return `Automatic · ${account.letter} · ${account.color}`;
}

function describeCodeSettings(account: VaultAccount) {
  const type = account.otpType === "hotp" ? `HOTP · counter ${account.counter}` : `TOTP · ${account.period}s`;
  return `${type} · ${account.digits} digits · ${account.algorithm}`;
}

function describeMainScreen(screen: PersistedVault["settings"]["mainScreen"]) {
  if (screen.kind === "favorites") return "Favorites";
  if (screen.kind === "group") return `Group: ${screen.group}`;
  return "All cards";
}

function describeGroupCustomizations(vault: PersistedVault) {
  return summarizeValues(vault.groupCustomizations.map((group) => `${group.name} (${group.icon}, ${group.color})`), 8);
}

function describeOrder(order: readonly string[]) {
  return summarizeValues(order);
}

function changedAccountValues(browser: VaultAccount, server: VaultAccount) {
  const changes: VaultConflictValueChange[] = [];
  if (browser.service !== server.service) changes.push(valueChange("service name", browser.service, server.service));
  if (browser.identity !== server.identity) changes.push(valueChange("account name", browser.identity, server.identity));
  if (!equalArray(browser.urls, server.urls)) changes.push(valueChange("website URLs", describeUrls(browser.urls), describeUrls(server.urls)));
  if (browser.secret !== server.secret) changes.push(valueChange("secret key", "Hidden", "Hidden"));
  if (browser.group !== server.group) changes.push(valueChange(
    "group",
    isUngroupedAccountGroup(browser.group) ? "All Cards (no group)" : browser.group,
    isUngroupedAccountGroup(server.group) ? "All Cards (no group)" : server.group,
  ));
  if (browser.favorite !== server.favorite) changes.push(valueChange("favorite status", browser.favorite ? "Favorite" : "Not favorite", server.favorite ? "Favorite" : "Not favorite"));
  if (browser.archived !== server.archived) changes.push(valueChange("archive status", browser.archived ? "Archived" : "Active", server.archived ? "Archived" : "Active"));
  if (
    browser.color !== server.color ||
    browser.letter !== server.letter ||
    browser.iconBrand !== server.iconBrand ||
    browser.iconDataUrl !== server.iconDataUrl
  ) {
    changes.push(valueChange("logo", describeLogo(browser), describeLogo(server)));
  }
  if (
    browser.algorithm !== server.algorithm ||
    browser.digits !== server.digits ||
    browser.otpType !== server.otpType ||
    browser.period !== server.period ||
    browser.counter !== server.counter
  ) {
    changes.push(valueChange("code settings", describeCodeSettings(browser), describeCodeSettings(server)));
  }
  if (browser.lastUsed !== server.lastUsed) changes.push(valueChange("recent activity", "Different", "Different"));
  return changes;
}

function sharedAccountOrderChanged(browser: PersistedVault, server: PersistedVault) {
  const browserIds = new Set(browser.accounts.map((account) => account.id));
  const serverIds = new Set(server.accounts.map((account) => account.id));
  const sharedBrowserOrder = browser.accounts
    .map((account) => account.id)
    .filter((id) => serverIds.has(id));
  const sharedServerOrder = server.accounts
    .map((account) => account.id)
    .filter((id) => browserIds.has(id));
  return !equalArray(sharedBrowserOrder, sharedServerOrder);
}

export function compareVaultConflictVersions(browser: PersistedVault, server: PersistedVault): VaultConflictDiff {
  const browserAccounts = new Map(browser.accounts.map((account) => [account.id, account]));
  const serverAccounts = new Map(server.accounts.map((account) => [account.id, account]));
  const browserOnlyAccounts = browser.accounts
    .filter((account) => !serverAccounts.has(account.id))
    .map((account) => ({ id: account.id, label: accountLabel(account) }));
  const serverOnlyAccounts = server.accounts
    .filter((account) => !browserAccounts.has(account.id))
    .map((account) => ({ id: account.id, label: accountLabel(account) }));
  const changedAccounts = browser.accounts.flatMap((browserAccount) => {
    const serverAccount = serverAccounts.get(browserAccount.id);
    if (!serverAccount) return [];
    const changes = changedAccountValues(browserAccount, serverAccount);
    return changes.length > 0 ? [{
      id: browserAccount.id,
      browserLabel: accountLabel(browserAccount),
      serverLabel: accountLabel(serverAccount),
      changes,
    }] : [];
  });

  const profileChanges: VaultConflictValueChange[] = [];
  if (browser.profile.name !== server.profile.name) profileChanges.push(valueChange("name", browser.profile.name, server.profile.name));
  if (browser.profile.email !== server.profile.email) profileChanges.push(valueChange("email", browser.profile.email, server.profile.email));
  if (browser.profile.avatarDataUrl !== server.profile.avatarDataUrl) profileChanges.push(valueChange("profile photo", browser.profile.avatarDataUrl ? "Set" : "Not set", server.profile.avatarDataUrl ? "Set" : "Not set"));

  const settingsChanges: VaultConflictValueChange[] = [];
  if (browser.settings.autoLockMinutes !== server.settings.autoLockMinutes) settingsChanges.push(valueChange("automatic lock delay", `${browser.settings.autoLockMinutes} minutes`, `${server.settings.autoLockMinutes} minutes`));
  if (browser.settings.lockWhenHidden !== server.settings.lockWhenHidden) settingsChanges.push(valueChange("lock when hidden", browser.settings.lockWhenHidden ? "On" : "Off", server.settings.lockWhenHidden ? "On" : "Off"));
  if (browser.settings.clearClipboard !== server.settings.clearClipboard) settingsChanges.push(valueChange("clipboard clearing", browser.settings.clearClipboard ? "On" : "Off", server.settings.clearClipboard ? "On" : "Off"));
  if (browser.settings.theme !== server.settings.theme) settingsChanges.push(valueChange("theme", browser.settings.theme, server.settings.theme));
  if (!equalJson(browser.settings.mainScreen, server.settings.mainScreen)) settingsChanges.push(valueChange("default screen", describeMainScreen(browser.settings.mainScreen), describeMainScreen(server.settings.mainScreen)));

  const groupChanges: VaultConflictValueChange[] = [];
  if (!equalJson(browser.groupCustomizations, server.groupCustomizations)) groupChanges.push(valueChange("group names, icons, or colors", describeGroupCustomizations(browser), describeGroupCustomizations(server)));
  if (!equalArray(browser.groupOrder, server.groupOrder)) groupChanges.push(valueChange("group order", describeOrder(browser.groupOrder), describeOrder(server.groupOrder)));

  const accountOrderChanged = sharedAccountOrderChanged(browser, server);
  const browserAccountLabels = new Map(browser.accounts.map((account) => [account.id, accountLabel(account)]));
  const serverAccountLabels = new Map(server.accounts.map((account) => [account.id, accountLabel(account)]));
  const accountOrderChange = accountOrderChanged ? valueChange(
    "card order",
    summarizeValues(browser.accounts.filter((account) => serverAccounts.has(account.id)).map((account) => browserAccountLabels.get(account.id) ?? account.id)),
    summarizeValues(server.accounts.filter((account) => browserAccounts.has(account.id)).map((account) => serverAccountLabels.get(account.id) ?? account.id)),
  ) : null;
  const hasContentDifferences =
    browserOnlyAccounts.length > 0 ||
    serverOnlyAccounts.length > 0 ||
    changedAccounts.length > 0 ||
    profileChanges.length > 0 ||
    settingsChanges.length > 0 ||
    groupChanges.length > 0 ||
    accountOrderChanged;

  return {
    browserAccountCount: browser.accounts.length,
    serverAccountCount: server.accounts.length,
    browserUpdatedAt: browser.updatedAt,
    serverUpdatedAt: server.updatedAt,
    browserOnlyAccounts,
    serverOnlyAccounts,
    changedAccounts,
    profileChanges,
    settingsChanges,
    groupChanges,
    accountOrderChanged,
    accountOrderChange,
    hasContentDifferences,
  };
}
