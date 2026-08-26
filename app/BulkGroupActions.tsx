"use client";

import { useId, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";

export type BulkGroupActionsProps = {
  active: boolean;
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  allSelectedFavorited: boolean;
  showGroupDragHint?: boolean;
  groups: readonly string[];
  disabled?: boolean;
  onBeginSelection: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onExitSelection: () => void;
  onSetFavorite: (favorite: boolean) => boolean | void;
  onArchive: () => boolean | void;
  onChangeLogo: (trigger: HTMLButtonElement) => void;
  onMoveToGroup: (groupName: string) => boolean | void;
  onCreateGroupAndMove: (groupName: string) => boolean | void;
};

export type AccountSelectionIndicatorProps = {
  selected: boolean;
};

export type ArchiveBulkActionsProps = {
  active: boolean;
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  disabled?: boolean;
  onBeginSelection: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onExitSelection: () => void;
  onRestore: () => boolean | void;
  onDelete: () => boolean | void;
};

export function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function mouseIsOutsideAccountCodeRow(event: ReactMouseEvent<HTMLElement>) {
  const card = event.currentTarget.closest(".account-card");
  const codeRow = card?.querySelector(".code-row");
  if (!(codeRow instanceof HTMLElement)) return false;

  const bounds = codeRow.getBoundingClientRect();
  return event.clientX < bounds.left
    || event.clientX > bounds.right
    || event.clientY < bounds.top
    || event.clientY > bounds.bottom;
}

function uniqueGroupNames(groups: readonly string[]) {
  const names = new Map<string, string>();

  for (const rawName of groups) {
    const name = normalizeGroupName(rawName);
    const key = name.toLocaleLowerCase("en");
    if (name && !names.has(key)) names.set(key, name);
  }

  return [...names.values()];
}

export function AccountSelectionIndicator({
  selected,
}: AccountSelectionIndicatorProps) {
  return (
    <span
      className={`account-selection-indicator ${selected ? "selected" : ""}`}
      aria-hidden="true"
    >
      <span className="account-selection-mark" aria-hidden="true" />
    </span>
  );
}

export function ArchiveBulkActions({
  active,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  disabled = false,
  onBeginSelection,
  onSelectAllVisible,
  onClearSelection,
  onExitSelection,
  onRestore,
  onDelete,
}: ArchiveBulkActionsProps) {
  const selectionDisabled = disabled || visibleCount === 0;
  const actionDisabled = disabled || selectedCount === 0;

  if (!active) {
    return (
      <div className="bulk-group-launch archive-bulk-launch">
        <button
          type="button"
          className="bulk-select-trigger"
          onClick={onBeginSelection}
          disabled={selectionDisabled}
        >
          <span className="bulk-select-icon" aria-hidden="true" />
          Select accounts
        </button>
      </div>
    );
  }

  return (
    <section className="bulk-group-actions archive-bulk-actions" aria-label="Archived account selection actions">
      <div className="bulk-action-bar">
        <div className="bulk-selection-summary" aria-live="polite" aria-atomic="true">
          <strong>{selectedCount} selected</strong>
          <span>{visibleCount} visible</span>
        </div>

        <div className="bulk-action-buttons">
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={onSelectAllVisible}
            disabled={selectionDisabled || allVisibleSelected}
          >
            {allVisibleSelected ? "All visible selected" : "Select all visible"}
          </button>
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={onClearSelection}
            disabled={actionDisabled}
          >
            Clear selection
          </button>
          <button
            type="button"
            className="bulk-secondary-action archive-restore-action"
            onClick={onRestore}
            disabled={actionDisabled}
          >
            Restore selected
          </button>
          <button
            type="button"
            className="bulk-danger-action"
            onClick={onDelete}
            disabled={actionDisabled}
          >
            Delete selected
          </button>
          <button
            type="button"
            className="bulk-done-action"
            onClick={onExitSelection}
            disabled={disabled}
          >
            Done
          </button>
        </div>
      </div>
    </section>
  );
}

export default function BulkGroupActions({
  active,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  allSelectedFavorited,
  showGroupDragHint = false,
  groups,
  disabled = false,
  onBeginSelection,
  onSelectAllVisible,
  onClearSelection,
  onExitSelection,
  onSetFavorite,
  onArchive,
  onChangeLogo,
  onMoveToGroup,
  onCreateGroupAndMove,
}: BulkGroupActionsProps) {
  const panelId = useId();
  const newGroupHelpId = useId();
  const [movePanelOpen, setMovePanelOpen] = useState(false);
  const [existingGroup, setExistingGroup] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const existingGroups = uniqueGroupNames(groups);
  const normalizedNewGroup = normalizeGroupName(newGroup);
  const duplicateGroup = existingGroups.some(
    (name) => name.toLocaleLowerCase("en") === normalizedNewGroup.toLocaleLowerCase("en"),
  );
  const selectionDisabled = disabled || visibleCount === 0;
  const moveDisabled = disabled || selectedCount === 0;

  const closeMovePanel = () => {
    setMovePanelOpen(false);
    setExistingGroup("");
    setNewGroup("");
  };

  const finishMove = (accepted: boolean | void) => {
    if (accepted !== false) closeMovePanel();
  };

  const submitExistingGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (moveDisabled || !existingGroup) return;
    finishMove(onMoveToGroup(existingGroup));
  };

  const submitNewGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (moveDisabled || !normalizedNewGroup || duplicateGroup) return;
    finishMove(onCreateGroupAndMove(normalizedNewGroup));
  };

  if (!active) {
    return (
      <div className="bulk-group-launch">
        <button
          type="button"
          className="bulk-select-trigger"
          onClick={onBeginSelection}
          disabled={selectionDisabled}
        >
          <span className="bulk-select-icon" aria-hidden="true" />
          Select accounts
        </button>
      </div>
    );
  }

  return (
    <section className="bulk-group-actions" aria-label="Account selection actions">
      <div className="bulk-action-bar">
        <div className="bulk-selection-copy">
          <div className="bulk-selection-summary" aria-live="polite" aria-atomic="true">
            <strong>{selectedCount} selected</strong>
            <span>{visibleCount} visible</span>
          </div>
          {showGroupDragHint && selectedCount > 0 && <span className="bulk-drag-hint">Hold outside the code row and drag a selected card to a sidebar group, or use Move to group.</span>}
        </div>

        <div className="bulk-action-buttons">
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={onSelectAllVisible}
            disabled={selectionDisabled || allVisibleSelected}
          >
            {allVisibleSelected ? "All visible selected" : "Select all visible"}
          </button>
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={onClearSelection}
            disabled={disabled || selectedCount === 0}
          >
            Clear selection
          </button>
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={() => onSetFavorite(!allSelectedFavorited)}
            disabled={moveDisabled}
          >
            {allSelectedFavorited ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={(event) => onChangeLogo(event.currentTarget)}
            disabled={moveDisabled}
          >
            Change logo
          </button>
          <button
            type="button"
            className="bulk-secondary-action"
            onClick={() => {
              const accepted = onArchive();
              if (accepted !== false) closeMovePanel();
            }}
            disabled={moveDisabled}
          >
            Move to Archive
          </button>
          <button
            type="button"
            className="bulk-move-trigger"
            aria-expanded={movePanelOpen}
            aria-controls={panelId}
            onClick={() => setMovePanelOpen((open) => !open)}
            disabled={moveDisabled}
          >
            Move to group
            <span aria-hidden="true">⌄</span>
          </button>
          <button
            type="button"
            className="bulk-done-action"
            onClick={() => {
              closeMovePanel();
              onExitSelection();
            }}
            disabled={disabled}
          >
            Done
          </button>
        </div>
      </div>

      {movePanelOpen && (
        <div className="bulk-move-panel" id={panelId}>
          <div className="bulk-move-heading">
            <strong>Move selected accounts</strong>
            <span>Choose an existing group or create one now.</span>
          </div>

          <form className="bulk-existing-group" onSubmit={submitExistingGroup}>
            <label htmlFor={`${panelId}-existing`}>Existing group</label>
            <div>
              <select
                id={`${panelId}-existing`}
                value={existingGroup}
                onChange={(event) => setExistingGroup(event.target.value)}
                disabled={disabled || existingGroups.length === 0}
              >
                <option value="">
                  {existingGroups.length === 0 ? "No groups yet" : "Choose a group"}
                </option>
                {existingGroups.map((name) => (
                  <option value={name} key={name} data-i18n-ignore>{name}</option>
                ))}
              </select>
              <button type="submit" disabled={moveDisabled || !existingGroup}>Move</button>
            </div>
          </form>

          <form className="bulk-new-group" onSubmit={submitNewGroup}>
            <label htmlFor={`${panelId}-new`}>New group</label>
            <div>
              <input
                id={`${panelId}-new`}
                value={newGroup}
                onChange={(event) => setNewGroup(event.target.value)}
                placeholder="e.g. Work accounts"
                maxLength={48}
                autoComplete="off"
                aria-describedby={newGroupHelpId}
                aria-invalid={duplicateGroup || undefined}
                disabled={disabled}
              />
              <button
                type="submit"
                disabled={moveDisabled || !normalizedNewGroup || duplicateGroup}
              >
                Create &amp; move
              </button>
            </div>
            <span id={newGroupHelpId} className={duplicateGroup ? "field-error" : "field-hint"}>
              {duplicateGroup
                ? "That group already exists. Choose it above."
                : "The group will be created and the selected accounts moved into it."}
            </span>
          </form>
        </div>
      )}
    </section>
  );
}
