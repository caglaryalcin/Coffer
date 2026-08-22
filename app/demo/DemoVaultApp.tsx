"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createDemoVault } from "../../lib/demo-vault";
import {
  formatCode,
  generateTotp,
  isTotpExpiring,
  totpWindow,
} from "../../lib/totp";
import type {
  PersistedVault,
  VaultAccount,
  VaultGroupCustomization,
  VaultSettings,
  VaultTheme,
} from "../../lib/vault-model";
import CardViewMenu, { type CardView } from "../CardViewMenu";
import OverflowingIdentity from "../OverflowingIdentity";
import ProfileMenu from "../ProfileMenu";
import ServiceLogo, { isServiceBrandId } from "../ServiceLogo";
import ThemeToggle from "../ThemeToggle";
import DemoSettingsCenter from "./DemoSettingsCenter";

type DemoView = "all" | "favorites" | "archive" | "settings";
type GeneratedCodePair = Readonly<{
  counter: number;
  configKey: string;
  current: string;
  next: string;
}>;

const SAFE_SAMPLE_SECRET = "JBSWY3DPEHPK3PXP";
const DEMO_ADDITIONS = [
  { service: "Linear", identity: "sample-team@coffer.example", group: "Work", color: "violet" },
  { service: "Stripe", identity: "sample-billing@coffer.example", group: "Finance", color: "blue" },
  { service: "Dropbox", identity: "sample-files@coffer.example", group: "Personal", color: "green" },
  { service: "GitLab", identity: "sample-code@coffer.example", group: "Work", color: "orange" },
] as const satisfies ReadonlyArray<Pick<VaultAccount, "service" | "identity" | "group" | "color">>;

const FALLBACK_GROUP_CUSTOMIZATION: Pick<VaultGroupCustomization, "icon" | "color"> = {
  icon: "folder",
  color: "rose",
};

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
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

export default function DemoVaultApp() {
  const [vault, setVault] = useState<PersistedVault>(() => createDemoVault());
  const [theme, setTheme] = useState<VaultTheme>(() => vault.settings.theme);
  const [view, setView] = useState<DemoView>("all");
  const [group, setGroup] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [cardView, setCardView] = useState<CardView>("default");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuId, setAccountMenuId] = useState<string | null>(null);
  const [codePairs, setCodePairs] = useState<Record<string, GeneratedCodePair>>({});
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const vaultRef = useRef(vault);
  const demoGenerationRef = useRef(0);
  const additionSequenceRef = useRef(0);
  const accounts = vault.accounts;

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

  useEffect(() => () => {
    demoGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const searchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("en") === "k";
      if (searchShortcut || (event.key === "/" && !typing)) {
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

  const groups = useMemo(() => Array.from(new Set(
    accounts.filter((account) => !account.archived).map((account) => account.group),
  )).sort((left, right) => left.localeCompare(right, "en")), [accounts]);

  const groupCustomizations = useMemo(() => new Map(
    vault.groupCustomizations.map((customization) => [groupKey(customization.name), customization]),
  ), [vault.groupCustomizations]);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    return accounts
      .filter((account) => {
        if (view === "archive" ? !account.archived : account.archived) return false;
        if (view === "favorites" && !account.favorite) return false;
        if (view === "all" && group !== "All" && account.group !== group) return false;
        if (!normalizedQuery) return true;
        return `${account.service}\0${account.identity}\0${account.group}`
          .toLocaleLowerCase("en")
          .includes(normalizedQuery);
      })
      .sort((left, right) => left.service.localeCompare(right.service, "en") || left.identity.localeCompare(right.identity, "en"));
  }, [accounts, group, query, view]);

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

  const showAllAccounts = () => {
    setView("all");
    setGroup("All");
    setAccountMenuId(null);
  };

  const openDemoSettingsSection = (sectionId: string) => {
    setView("settings");
    setGroup("All");
    setAccountMenuId(null);
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

  const addSampleAccount = () => {
    const sequence = additionSequenceRef.current;
    additionSequenceRef.current += 1;
    const template = DEMO_ADDITIONS[sequence % DEMO_ADDITIONS.length];
    const copyNumber = Math.floor(sequence / DEMO_ADDITIONS.length) + 1;
    const suffix = copyNumber > 1 ? ` ${copyNumber}` : "";
    const account: VaultAccount = {
      id: `demo-added-${Date.now()}-${sequence}`,
      service: `${template.service}${suffix}`,
      identity: template.identity,
      secret: SAFE_SAMPLE_SECRET,
      group: template.group,
      color: template.color,
      letter: template.service.slice(0, 2).toUpperCase(),
      favorite: false,
      lastUsed: Date.now(),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    };
    setAccounts((current) => [...current, account]);
    setView("all");
    setGroup("All");
    setAccountMenuId(null);
    setToast(`${account.service} sample account added.`);
  };

  const updateDemoSettings = (patch: Partial<VaultSettings>) => {
    setVault((current) => {
      const nextSettings = { ...current.settings, ...patch };
      const next = { ...current, settings: nextSettings, updatedAt: new Date().toISOString() };
      vaultRef.current = next;
      return next;
    });
    if (patch.theme) setTheme(patch.theme);
    setToast("Demo settings updated for this page only.");
  };

  const updateDemoProfileName = (name: string) => {
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 80) return false;
    setVault((current) => {
      const next = {
        ...current,
        profile: { ...current.profile, name: normalizedName },
        updatedAt: new Date().toISOString(),
      };
      vaultRef.current = next;
      return next;
    });
    setToast("Demo profile updated for this page only.");
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
    } catch {
      setToast("Clipboard access is unavailable in this browser.");
    }
  };

  const activeAccountCount = accounts.filter((account) => !account.archived).length;
  const favoriteAccountCount = accounts.filter((account) => account.favorite && !account.archived).length;
  const archivedAccountCount = accounts.filter((account) => account.archived).length;

  return (
    <main className={`app-shell demo-shell theme-${theme} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
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
          <button type="button" title="Favorite sample accounts" className={`nav-item ${view === "favorites" ? "active" : ""}`} onClick={() => { setView("favorites"); setGroup("All"); setAccountMenuId(null); }}>
            <span className="nav-icon star-icon" aria-hidden="true" />Favorites<span className="nav-count">{favoriteAccountCount}</span>
          </button>
          <button type="button" title="Archived sample accounts" className={`nav-item ${view === "archive" ? "active" : ""}`} onClick={() => { setView("archive"); setGroup("All"); setAccountMenuId(null); }}>
            <span className="nav-icon trash-icon" aria-hidden="true" />Archive<span className="nav-count">{archivedAccountCount}</span>
          </button>
          <button type="button" className="nav-item demo-disabled-nav" title="Unavailable in demo — no data is imported or saved" disabled>
            <span className="nav-icon transfer-icon" aria-hidden="true" />Data &amp; backup
          </button>
          <button type="button" className={`nav-item ${view === "settings" ? "active" : ""}`} title="Demo settings" onClick={() => { setView("settings"); setGroup("All"); setAccountMenuId(null); }}>
            <span className="nav-icon settings-icon" aria-hidden="true" />Settings
          </button>
        </nav>

        <div className="sidebar-label">Groups</div>
        <nav className="group-nav" aria-label="Sample account groups">
          {groups.map((name) => {
            const customization = groupCustomizations.get(groupKey(name)) ?? FALLBACK_GROUP_CUSTOMIZATION;
            const active = view === "all" && group === name;
            const count = accounts.filter((account) => !account.archived && account.group === name).length;
            return (
              <div key={name} className={`group-nav-row ${active ? "active" : ""}`}>
                <button
                  type="button"
                  className="group-nav-main"
                  aria-pressed={active}
                  title={`Open ${name} sample accounts`}
                  onClick={() => { setGroup(name); setView("all"); setAccountMenuId(null); }}
                >
                  <span className="group-symbol" data-icon={customization.icon} data-color={customization.color} aria-hidden="true" />
                  <span className="group-name">{name}</span>
                  <span className="group-count">{count}</span>
                </button>
              </div>
            );
          })}
        </nav>

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
            <ThemeToggle theme={theme} onToggle={() => updateDemoSettings({ theme: theme === "dark" ? "light" : "dark" })} />
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
            <p>Sample accounts only. Changes reset when you refresh this page. Never enter real secrets in this demo.</p>
          </div>
        </section>

        {view === "settings" ? (
          <DemoSettingsCenter
            profile={vault.profile}
            settings={vault.settings}
            onProfileNameChange={updateDemoProfileName}
            onSettingsChange={updateDemoSettings}
          />
        ) : (
        <div className="content">
          {view !== "archive" && (
            <div className="title-row title-row-actions-only">
              <div className="title-row-account-actions">
                <CardViewMenu value={cardView} onChange={setCardView} onOpen={() => setAccountMenuId(null)} />
                <button type="button" className="add-button" onClick={addSampleAccount}><span aria-hidden="true">+</span>Add sample account</button>
              </div>
            </div>
          )}

          {view === "archive" ? (
            <section className="archive-explainer" aria-label="About the demo Archive">
              <span className="archive-explainer-icon" aria-hidden="true"><span className="nav-icon trash-icon" /></span>
              <div><strong>Temporary archive</strong><p>These sample accounts keep generating codes and return after a demo reset.</p></div>
              <span>{archivedAccountCount} archived</span>
            </section>
          ) : query.trim() ? (
            <p className="result-count" role="status">{visibleAccounts.length} {visibleAccounts.length === 1 ? "account" : "accounts"}</p>
          ) : null}

          {visibleAccounts.length > 0 ? (
            <section className="account-grid" data-card-view={cardView} aria-label="Sample authenticator accounts">
              {visibleAccounts.map((account) => {
                const { current: currentCode, next: nextCode, remaining } = codePreview(account, tick, codePairs[account.id]);
                const revealNextCode = isTotpExpiring(remaining);
                const accessibleCurrentCode = currentCode?.replace(/\s/gu, "").split("").join(" ");
                return (
                  <article className={`account-card ${account.archived ? "archived-card" : ""}`} key={account.id}>
                    <div className="account-topline">
                      <ServiceLogo
                        service={account.service}
                        fallback={account.letter}
                        color={account.color}
                        brandId={isServiceBrandId(account.iconBrand) ? account.iconBrand : null}
                        iconDataUrl={account.iconDataUrl}
                      />
                      <div className="service-meta"><h2>{account.service}</h2><OverflowingIdentity text={account.identity} /></div>
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
                            if (!event.currentTarget.contains(event.relatedTarget)) setAccountMenuId(null);
                          }}
                        >
                          <button
                            type="button"
                            className="more-button"
                            aria-expanded={accountMenuId === account.id}
                            aria-controls={accountMenuId === account.id ? `demo-account-menu-${account.id}` : undefined}
                            onClick={() => setAccountMenuId((current) => current === account.id ? null : account.id)}
                            aria-label={`Open ${account.service} sample options`}
                          >•••</button>
                          {accountMenuId === account.id && (
                            <div className="account-menu" id={`demo-account-menu-${account.id}`}>
                              {!account.archived && <button type="button" onClick={() => toggleFavorite(account.id)}>{account.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>}
                              <button type="button" onClick={() => toggleArchive(account.id)}>{account.archived ? "Restore to All codes" : "Move to Archive"}</button>
                              {account.archived && <button type="button" className="danger" onClick={() => removeSampleAccount(account.id)}>Remove sample account</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="code-row">
                      <div className="code-stack">
                        <button
                          type="button"
                          className={`code ${revealNextCode ? "expiring-code" : ""}`}
                          onClick={() => void copyCode(account)}
                          aria-label={accessibleCurrentCode
                            ? `Copy ${account.service} ${account.identity} sample code ${accessibleCurrentCode}`
                            : `Copy ${account.service} ${account.identity} sample code when ready`}
                        ><span className="code-value" aria-hidden="true">{currentCode ?? "--- ---"}</span></button>
                        <div className={`next-code ${revealNextCode ? "visible" : ""}`} aria-hidden={!revealNextCode}>
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

              {view !== "archive" && (
                <button type="button" className="add-card" onClick={addSampleAccount} aria-label="Add another safe sample authenticator account">
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
                <button type="button" onClick={addSampleAccount}>Add sample account</button>
              )}
            </section>
          )}
        </div>
        )}
      </section>

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">
        <span className="toast-check" aria-hidden="true">✓</span>{toast}
      </div>
    </main>
  );
}
