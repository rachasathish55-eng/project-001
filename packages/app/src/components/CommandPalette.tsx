import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

export type CommandPaletteAction = {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  disabled?: boolean;
  onSelect: () => void;
};

export default function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandPaletteAction[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="command-palette" role="presentation">
          <motion.button
            type="button"
            className="command-palette__backdrop"
            aria-label="Close command palette"
            onClick={() => onOpenChange(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          />

          <motion.section
            className="command-palette__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Command className="command-palette__command" loop shouldFilter>
              <div className="command-palette__header">
                <span className="command-palette__eyebrow">Strawberry Studios</span>
                <Command.Input className="command-palette__input" autoFocus placeholder="Search actions..." />
              </div>

              <Command.List className="command-palette__list">
                <Command.Empty className="command-palette__empty">No matching actions.</Command.Empty>
                <Command.Group className="command-palette__group" heading="Actions">
                  {actions.map((action) => (
                    <Command.Item
                      key={action.id}
                      className="command-palette__item"
                      value={action.label}
                      disabled={action.disabled}
                      keywords={[action.description, ...(action.keywords ?? [])]}
                      onSelect={() => {
                        onOpenChange(false);
                        action.onSelect();
                      }}
                    >
                      <div className="command-palette__item-copy">
                        <strong>{action.label}</strong>
                        <span>{action.description}</span>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
