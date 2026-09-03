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
