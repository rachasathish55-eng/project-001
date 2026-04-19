import { useEffect } from "react";

type ShortcutHandlers = {
  onOpenCommandPalette: () => void;
  onSaveProject: () => void;
  onRunFocusedNode: () => void;
  onToggleWorkerDashboard: () => void;
};

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (!target.isContentEditable) {
    return false;
  }

  return target.closest(".cm-editor") === null;
}

function hasPrimaryShortcutModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function useShortcuts({
  onOpenCommandPalette,
  onSaveProject,
  onRunFocusedNode,
  onToggleWorkerDashboard,
}: ShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (hasPrimaryShortcutModifier(event) && key === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onOpenCommandPalette();
        return;
      }

      if (hasPrimaryShortcutModifier(event) && key === "s" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onSaveProject();
        return;
      }

      if (hasPrimaryShortcutModifier(event) && key === "b" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onToggleWorkerDashboard();
        return;
      }

      if (event.shiftKey && !event.metaKey && !event.ctrlKey && key === "enter") {
        if (isTextInputTarget(event.target)) {
          return;
        }

        event.preventDefault();
        onRunFocusedNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onOpenCommandPalette, onRunFocusedNode, onSaveProject, onToggleWorkerDashboard]);
}
