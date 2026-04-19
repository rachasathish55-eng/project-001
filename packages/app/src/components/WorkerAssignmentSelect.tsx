import { useMemo, type ChangeEvent } from "react";
import { useStore } from "../store/useStore";

function formatWorkerLabel(id: string, hostname: string | null, workerId: string | null, url: string): string {
  const primary = hostname ?? workerId ?? url ?? id;
  const details = [workerId && workerId !== primary ? workerId : null, url && url !== primary ? url : null].filter(
    Boolean,
  ) as string[];
  return details.length > 0 ? `${primary} (${details.join(" · ")})` : primary;
}

export default function WorkerAssignmentSelect({
  nodeId,
  value,
  className,
}: {
  nodeId: string;
  value: string | null;
  className?: string;
}) {
  const workers = useStore((state) => state.workers);
  const updateNode = useStore((state) => state.updateNode);

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === value || worker.workerId === value || worker.url === value) ?? null,
    [value, workers],
  );
  const selectedValue = selectedWorker?.id ?? value ?? "";

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateNode(nodeId, {
      assignedWorker: event.target.value.length > 0 ? event.target.value : null,
    });
  };

  return (
    <label className={["worker-select", className].filter(Boolean).join(" ")}>
      <span className="worker-select__label">Worker</span>
      <select
        className="worker-select__control"
        value={selectedValue}
        onChange={handleChange}
        aria-label="Assign worker"
      >
        <option value="">Primary worker</option>
        {value && !selectedWorker ? <option value={value}>Unavailable worker ({value})</option> : null}
        {workers.map((worker) => (
          <option key={worker.id} value={worker.id}>
            {formatWorkerLabel(worker.id, worker.hostname, worker.workerId, worker.url)} [{worker.status}]
          </option>
        ))}
      </select>
    </label>
  );
}
