import {
  parsePersistedVault,
  VAULT_PAYLOAD_FORMAT,
  VAULT_PAYLOAD_VERSION,
  type PersistedVault,
  type VaultAccount,
} from "./vault-model";

// Public test vectors only. These are RFC 6238 secrets plus the widely used
// "Hello!" Base32 demo secret; none of them may be used for a real account.
const RFC_6238_SHA_1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_6238_SHA_256_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const RFC_6238_SHA_512_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
const PUBLIC_HELLO_DEMO_SECRET = "JBSWY3DPEHPK3PXP";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export function createDemoVault(now = new Date()): PersistedVault {
  const updatedAt = now.toISOString();
  const nowMilliseconds = now.getTime();
  const usedAt = (millisecondsAgo: number) => Math.max(0, nowMilliseconds - millisecondsAgo);

  const accounts: VaultAccount[] = [
    {
      id: "demo-github",
      service: "GitHub",
      identity: "octo-demo@coffer.example",
      secret: RFC_6238_SHA_1_SECRET,
      group: "Work",
      color: "ink",
      letter: "GI",
      favorite: true,
      lastUsed: usedAt(15 * 60 * 1_000),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-microsoft",
      service: "Microsoft",
      identity: "demo.user@coffer.example",
      secret: PUBLIC_HELLO_DEMO_SECRET,
      group: "Work",
      color: "blue",
      letter: "MI",
      favorite: true,
      lastUsed: usedAt(2 * HOUR_MS),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-aws",
      service: "AWS",
      identity: "coffer-demo-global-infrastructure-security-administrator",
      secret: RFC_6238_SHA_256_SECRET,
      group: "Work",
      color: "orange",
      letter: "AW",
      favorite: false,
      lastUsed: usedAt(6 * HOUR_MS),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-cloudflare",
      service: "Cloudflare",
      identity: "demo-zone@coffer.example",
      secret: RFC_6238_SHA_256_SECRET,
      group: "Work",
      color: "orange",
      letter: "CL",
      favorite: false,
      lastUsed: usedAt(DAY_MS),
      algorithm: "SHA-256",
      digits: 6,
      period: 60,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-slack",
      service: "Slack",
      identity: "coffer-demo-workspace",
      secret: RFC_6238_SHA_512_SECRET,
      group: "Work",
      color: "violet",
      letter: "SL",
      favorite: false,
      lastUsed: usedAt(2 * DAY_MS),
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-notion",
      service: "Notion",
      identity: "notes-demo@coffer.example",
      secret: RFC_6238_SHA_512_SECRET,
      group: "Personal",
      color: "ink",
      letter: "NO",
      favorite: false,
      lastUsed: usedAt(3 * DAY_MS),
      algorithm: "SHA-512",
      digits: 8,
      period: 30,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-reddit",
      service: "Reddit",
      identity: "u/coffer_demo_account",
      secret: PUBLIC_HELLO_DEMO_SECRET,
      group: "Personal",
      color: "orange",
      letter: "RE",
      favorite: false,
      lastUsed: usedAt(14 * DAY_MS),
      algorithm: "SHA-1",
      digits: 6,
      period: 60,
      archived: true,
      iconBrand: null,
      iconDataUrl: null,
    },
    {
      id: "demo-1password",
      service: "1Password",
      identity: "finance-demo@coffer.example",
      secret: RFC_6238_SHA_1_SECRET,
      group: "Finance",
      color: "blue",
      letter: "1P",
      favorite: true,
      lastUsed: usedAt(5 * DAY_MS),
      algorithm: "SHA-256",
      digits: 6,
      period: 60,
      archived: false,
      iconBrand: null,
      iconDataUrl: null,
    },
  ];
  accounts.sort((left, right) => (
    left.service.localeCompare(right.service, "en") || left.identity.localeCompare(right.identity, "en")
  ));

  return parsePersistedVault({
    format: VAULT_PAYLOAD_FORMAT,
    version: VAULT_PAYLOAD_VERSION,
    profile: {
      name: "Coffer Demo",
      email: "demo@coffer.example",
      avatarDataUrl: null,
    },
    settings: {
      autoLockMinutes: 0,
      lockWhenHidden: false,
      clearClipboard: true,
      theme: "dark",
    },
    accounts,
    groupCustomizations: [
      { name: "Work", icon: "briefcase", color: "blue" },
      { name: "Personal", icon: "person", color: "rose" },
      { name: "Finance", icon: "finance", color: "emerald" },
    ],
    groupOrder: ["Finance", "Personal", "Work"],
    createdAt: new Date(Math.max(0, nowMilliseconds - 30 * DAY_MS)).toISOString(),
    updatedAt,
  });
}
