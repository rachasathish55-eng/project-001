import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { WorkerRecord } from "../store/useStore";
import { useWorkerManager } from "../lib/worker-manager-context";
import { useStore } from "../store/useStore";

const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${percentFormatter.format(value)}%`;
}

function formatLastSeen(ts: number | null): string {
  if (ts === null) {
    return "No telemetry yet";
  }

  const seconds = Math.round((ts - Date.now()) / 1000);
  if (seconds >= -59) {
    return relativeFormatter.format(seconds, "second");
  }

  const minutes = Math.round(seconds / 60);
  if (minutes >= -59) {
    return relativeFormatter.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  return relativeFormatter.format(hours, "hour");
}

function ResourceGauge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "cpu" | "mem" | "gpu";
}) {
  const normalizedValue = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="worker-dashboard__gauge">
      <div className="worker-dashboard__gauge-header">
        <span>{label}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div className="worker-dashboard__track" aria-hidden="true">
        <motion.div
          className={`worker-dashboard__fill worker-dashboard__fill--${tone}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: normalizedValue / 100 }}
          style={{ transformOrigin: "0% 50%" }}
          transition={{ type: "spring", stiffness: 140, damping: 26, mass: 0.8 }}
        />
      </div>
    </div>
  );
}

function WorkerCard({ worker }: { worker: WorkerRecord }) {
  const manager = useWorkerManager();

  return (
    <motion.article
      className={`worker-dashboard__card worker-dashboard__card--${worker.status}`}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      <div className="worker-dashboard__card-header">
        <div>
          <span className="worker-dashboard__eyebrow">Claw worker</span>
          <h3 className="worker-dashboard__hostname">{worker.hostname}</h3>
        </div>
        <span className={`worker-dashboard__status worker-dashboard__status--${worker.status}`}>{worker.status}</span>
      </div>

      <div className="worker-dashboard__meta">
        <span>{worker.os}</span>
        <span>{worker.workerId}</span>
        <span>{worker.url}</span>
      </div>

      <div className="worker-dashboard__metrics">
        <ResourceGauge label="CPU" value={worker.cpuPct} tone="cpu" />
        <ResourceGauge label="RAM" value={worker.memPct} tone="mem" />
        <ResourceGauge label="GPU" value={worker.gpuPct} tone="gpu" />
      </div>

      <div className="worker-dashboard__footer">
        <span>Last seen {formatLastSeen(worker.lastHeartbeatAt)}</span>
        {worker.version ? <span>{worker.version}</span> : null}
        <button
          type="button"
          className="worker-dashboard__action"
          onClick={() => manager?.disconnectWorker(worker.id)}
          disabled={!manager}
        >
          Disconnect
        </button>
      </div>
    </motion.article>
  );
}

export default function WorkerDashboard({
  isOpen,
  onToggle,
  focusConnectSignal,
}: {
  isOpen: boolean;
  onToggle: () => void;
  focusConnectSignal: number;
}) {
  const workers = useStore((state) => state.workers);
  const connectionState = useStore((state) => state.connectionState);
  const manager = useWorkerManager();
  const [workerUrl, setWorkerUrl] = useState("ws://localhost:7332");
  const workerInputRef = useRef<HTMLInputElement | null>(null);
  const onlineCount = workers.filter((worker) => worker.status === "online").length;

  const handleConnectWorker = () => {
    const nextUrl = workerUrl.trim();
    if (!nextUrl) {
      return;
    }

    manager?.connectWorker(nextUrl);
    setWorkerUrl(nextUrl);
  };

  useEffect(() => {
    if (!isOpen || focusConnectSignal === 0) {
      return;
    }

    workerInputRef.current?.focus();
    workerInputRef.current?.select();
  }, [focusConnectSignal, isOpen]);

  return (
    <motion.aside
      className={`worker-dashboard${isOpen ? "" : " worker-dashboard--collapsed"}`}
      layout
      initial={false}
      animate={{ opacity: 1, x: isOpen ? 0 : -10, scale: isOpen ? 1 : 0.985 }}
      transition={{ type: "spring", stiffness: 260, damping: 28, mass: 0.9 }}
    >
      <header className="worker-dashboard__header">
        <div>
          <span className="worker-dashboard__eyebrow">Workers</span>
          <h2 className="worker-dashboard__title">Worker dashboard</h2>
          <p className="worker-dashboard__description">
            {connectionState === "connected" || connectionState === "connecting"
              ? "Monitoring live telemetry from connected Claw workers."
              : "Waiting for the worker daemon to connect."}
          </p>
        </div>

        <div className="worker-dashboard__summary">
          <strong>{onlineCount}</strong>
          <span>online</span>
        </div>

        <button
          type="button"
          className="worker-dashboard__toggle"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          {isOpen ? "Collapse" : "Expand"}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="worker-dashboard-body"
            className="worker-dashboard__body"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            <div className="worker-dashboard__composer">
              <input
                ref={workerInputRef}
                className="worker-dashboard__input"
                value={workerUrl}
                onChange={(event) => setWorkerUrl(event.target.value)}
                placeholder="ws://localhost:7332"
                aria-label="Worker websocket URL"
              />
              <button
                type="button"
                className="worker-dashboard__action worker-dashboard__action--primary"
                onClick={handleConnectWorker}
                disabled={!manager}
              >
                Connect worker
              </button>
            </div>

            <div className="worker-dashboard__list">
              {workers.length === 0 ? (
                <div className="worker-dashboard__empty">
                  <strong>No workers connected</strong>
                  <span>Telemetry gauges will appear here when the daemon reports in.</span>
                </div>
              ) : (
                workers.map((worker) => <WorkerCard key={worker.id} worker={worker} />)
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  );
}
