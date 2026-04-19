import { useEffect, useRef, useState } from "react";
import type { TerminalLogEntry } from "../lib/terminal-logs";
import { useStore } from "../store/useStore";

const AUTO_SCROLL_THRESHOLD_PX = 40;
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

function formatTimestamp(ts: number): string {
  return timestampFormatter.format(new Date(ts));
}

function formatNodeLabel(entry: TerminalLogEntry): string | null {
  if (entry.nodeName && entry.nodeId) {
    return `${entry.nodeName} (${entry.nodeId})`;
  }

  return entry.nodeName ?? entry.nodeId ?? null;
}

export default function TerminalPanel() {
  const entries = useStore((state) => state.terminalEntries);
  const clearTerminalEntries = useStore((state) => state.clearTerminalEntries);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const hasEntries = entries.length > 0;

  useEffect(() => {
    if (!autoScroll || collapsed) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [autoScroll, collapsed, entries]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setAutoScroll(distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX);
  };

  return (
    <section className={`terminal-panel${collapsed ? " terminal-panel--collapsed" : ""}`}>
      <header className="terminal-panel__header">
        <div>
          <span className="terminal-panel__eyebrow">Terminal</span>
          <strong className="terminal-panel__title">Live worker logs</strong>
        </div>

        <div className="terminal-panel__controls">
          <button type="button" className="terminal-panel__button" onClick={() => setAutoScroll((current) => !current)}>
            {autoScroll ? "Pause follow" : "Resume follow"}
          </button>
          <button
            type="button"
            className="terminal-panel__button"
            onClick={() => clearTerminalEntries()}
            disabled={!hasEntries}
          >
            Clear
          </button>
          <button
            type="button"
            className="terminal-panel__button terminal-panel__button--primary"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </header>

      {!collapsed ? (
        <div className="terminal-panel__body">
          <div className="terminal-panel__viewport" ref={viewportRef} onScroll={handleScroll}>
            {entries.length === 0 ? (
              <div className="terminal-panel__empty">Run a script node to stream stdout and stderr here.</div>
            ) : (
              entries.map((entry) => {
                const nodeLabel = formatNodeLabel(entry);

                return (
                  <div key={entry.id} className={`terminal-panel__line terminal-panel__line--${entry.stream}`}>
                    <span className="terminal-panel__timestamp">{formatTimestamp(entry.ts)}</span>
                    <span className={`terminal-panel__stream terminal-panel__stream--${entry.stream}`}>
                      {entry.stream}
                    </span>
                    {nodeLabel ? <span className="terminal-panel__node">{nodeLabel}</span> : null}
                    <span className="terminal-panel__text">{entry.text}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
