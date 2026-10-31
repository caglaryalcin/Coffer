export function HeartIcon({ className, filled = false }: { className: string; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={filled
        ? "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z"
        : "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3Zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05Z"} />
    </svg>
  );
}

export function SidebarFavoritesIcon({ className, filled = false }: { className: string; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="sidebar-favorites-heart-path"
        d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"
      />
    </svg>
  );
}

export function ArchiveIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function SidebarArchiveIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="sidebar-scale-pop-part sidebar-icon-delay-0" width="20" height="5" x="2" y="3" rx="1" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-1" d="M4 8v11a2 2 0 0 0 2 2h2" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-2" d="M20 8v11a2 2 0 0 1-2 2h-2" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-3" d="m9 15 3-3 3 3" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-4" d="M12 12v9" />
    </svg>
  );
}

export function CardsIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <path className="sidebar-scale-pop-part sidebar-icon-delay-0" d="M16 10h2" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-1" d="M16 14h2" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-2" d="M6.17 15a3 3 0 0 1 5.66 0" />
      <circle className="sidebar-scale-pop-part sidebar-icon-delay-3" cx="9" cy="11" r="2" />
      <rect className="sidebar-scale-pop-part sidebar-icon-delay-4" x="2" y="5" width="20" height="14" rx="2" />
    </svg>
  );
}

export function DataBackupIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="sidebar-scale-pop-part sidebar-icon-delay-0" cx="12" cy="5" rx="9" ry="3" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-1" d="M3 12a9 3 0 0 0 5 2.69" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-2" d="M21 9.3V5" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-3" d="M3 5v14a9 3 0 0 0 6.47 2.88" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-4" d="M12 12v4h4" />
      <path className="sidebar-scale-pop-part sidebar-icon-delay-5" d="M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16" />
    </svg>
  );
}

export function SettingsIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      <path className="sidebar-settings-gear sidebar-icon-delay-0" d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle className="sidebar-settings-gear sidebar-icon-delay-1" cx="12" cy="12" r="3" />
    </svg>
  );
}

export function HeaderLockIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="10" width="18" height="12" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
    </svg>
  );
}

export function AddAccountIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="add-button-icon-bg" x="1" y="1" width="22" height="22" rx="7" />
      <path
        className="add-button-icon-mark"
        d="M8 12h8M12 8v8"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GroupAddIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

export function RestoreCodesIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="add-button-icon-bg" x="1" y="1" width="22" height="22" rx="7" />
      <path
        className="add-button-icon-mark"
        d="M5 5v4h4M5.3 9A7 7 0 1 1 6.1 17"
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

