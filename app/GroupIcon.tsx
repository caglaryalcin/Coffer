import type { VaultGroupColor, VaultGroupIcon } from "../lib/vault-model";

type GroupIconProps = {
  icon: VaultGroupIcon;
  color: VaultGroupColor;
  className: string;
};

function groupIconPaths(icon: VaultGroupIcon) {
  switch (icon) {
    case "dot":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      );
    case "folder":
      return <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />;
    case "briefcase":
      return (
        <>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" />
        </>
      );
    case "person":
      return (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 21a7 7 0 0 1 14 0" />
        </>
      );
    case "shield":
      return <path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" />;
    case "star":
      return <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />;
    case "home":
      return (
        <>
          <path d="m3 10.5 9-7.5 9 7.5" />
          <path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" />
        </>
      );
    case "code":
      return <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />;
    case "work":
      return (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M9 21v-5h6v5" />
        </>
      );
    case "personal":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="9" r="2.5" />
          <path d="M7.5 18a5 5 0 0 1 9 0" />
        </>
      );
    case "shopping":
      return (
        <>
          <path d="M6 8h12l1 12H5L6 8Z" />
          <path d="M9 9V6a3 3 0 0 1 6 0v3" />
        </>
      );
    case "finance":
      return (
        <>
          <path d="M5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" />
          <path d="M16 11h5v4h-5a2 2 0 0 1 0-4ZM18 13h.01" />
        </>
      );
    case "travel":
      return <path d="M22 16 13 12V5.5a2 2 0 0 0-4 0V12l-7 4v2l7-2v4l-2 1v1l4-1 4 1v-1l-2-1v-4l9 2Z" />;
    case "education":
      return (
        <>
          <path d="M11 5a5 5 0 0 0-4-2H3v15h4a5 5 0 0 1 4 2Z" />
          <path d="M13 5a5 5 0 0 1 4-2h4v15h-4a5 5 0 0 0-4 2Z" />
        </>
      );
    case "health":
      return <path d="M20.8 5.7a5.4 5.4 0 0 0-7.6 0L12 6.9l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.6Z" />;
    case "social":
      return <path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.5 9.5 0 0 1-4-.9L3 21l1.7-4.5A8.5 8.5 0 1 1 21 11.5Z" />;
    case "import":
      return (
        <>
          <path d="M12 3v12m0 0 5-5m-5 5-5-5" />
          <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
        </>
      );
    case "ai":
      return (
        <>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
        </>
      );
    case "drive":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M3 14h18M7 17h.01M11 17h.01" />
        </>
      );
    case "forum":
      return (
        <>
          <path d="M21 14a3 3 0 0 1-3 3h-7l-4 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />
          <path d="M8 9h8M8 13h5" />
        </>
      );
    case "globe":
      return <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>;
    case "key":
      return <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3" /></>;
    case "lock":
      return <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>;
    case "cloud":
      return <path d="M7 19h11a4 4 0 0 0 1-7.9A7 7 0 0 0 5.4 9.3 5 5 0 0 0 7 19Z" />;
    case "server":
      return <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" /></>;
    case "database":
      return <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>;
    case "terminal":
      return <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>;
    case "smartphone":
      return <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 5h4M12 18h.01" /></>;
    case "gamepad":
      return <><path d="M7 7h10a3 3 0 0 1 3 2.5l1.5 8a2.5 2.5 0 0 1-4.3 2L14 16h-4l-3.2 3.5a2.5 2.5 0 0 1-4.3-2l1.5-8A3 3 0 0 1 7 7Z" /><path d="M7 10v5M4.5 12.5h5M16 11h.01M18 14h.01" /></>;
    case "music":
      return <><path d="M9 18V5l12-2v13M9 9l12-2" /><ellipse cx="6" cy="18" rx="3" ry="3" /><ellipse cx="18" cy="16" rx="3" ry="3" /></>;
    case "camera":
      return <><path d="M8 6 10 3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></>;
    case "video":
      return <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-4v12l-6-4" /></>;
    case "calendar":
      return <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2" /></>;
    case "bookmark":
      return <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z" />;
    case "link":
      return <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-5.7-5.7l4-4a4 4 0 0 1 5.7 0M16 8l1-1a4 4 0 0 1 5.7 5.7l-4 4a4 4 0 0 1-5.7 0" transform="translate(1 -1) scale(.92)" /></>;
    case "wifi":
      return <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01" /></>;
    case "tools":
      return <path d="m14 6 4 4 3-3a6 6 0 0 1-8 7L6 21a2.1 2.1 0 0 1-3-3l7-7a6 6 0 0 1 7-8Z" />;
    case "layers":
      return <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />;
    case "coffee":
      return <><path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM16 8h2a3 3 0 0 1 0 6h-2M2 22h18M7 2v3M12 2v3" /></>;
    case "users":
      return <><circle cx="9" cy="7" r="3" /><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6M22 21v-2a7 7 0 0 0-4-6.3" /></>;
  }
}

export default function GroupIcon({ icon, color, className }: GroupIconProps) {
  return (
    <span
      className={className}
      data-icon={icon}
      data-color={color}
      aria-hidden="true"
    >
      <svg
        className="group-icon-glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {groupIconPaths(icon)}
      </svg>
    </span>
  );
}
