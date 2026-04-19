import { motion } from "framer-motion";
import { useStore, type WorkerRecord } from "../store/useStore";

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
          initial={{ width: 0 }}
          animate={{ width: `${normalizedValue}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function WorkerCard({ worker }: { worker: WorkerRecord }) {
  return (
    <motion.article
      className={`worker-dashboard__card worker-dashboard__card--${worker.status}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
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
      </div>

      <div className="worker-dashboard__metrics">
        <ResourceGauge label="CPU" value={worker.cpuPct} tone="cpu" />
        <ResourceGauge label="RAM" value={worker.memPct} tone="mem" />
        <ResourceGauge label="GPU" value={worker.gpuPct} tone="gpu" />
      </div>

      <div className="worker-dashboard__footer">
        <span>Last seen {formatLastSeen(worker.lastHeartbeatAt)}</span>
        {worker.version ? <span>{worker.version}</span> : null}
      </div>
    </motion.article>
  );
}

export default function WorkerDashboard() {
  const workers = useStore((state) => state.workers);
  const connectionState = useStore((state) => state.connectionState);
  const onlineCount = workers.filter((worker) => worker.status === "online").length;

  return (
    <aside className="worker-dashboard">
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
      </header>

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
    </aside>
  );
}
