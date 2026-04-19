import { useMemo } from "react";
import { useStore } from "../store/useStore";

type ViewMode = "canvas" | "notebook";

export default function Header({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const workers = useStore((state) => state.workers);
  const workerStats = useStore((state) => state.workerStats);
  const connectionState = useStore((state) => state.connectionState);
  const workerManager = useStore((state) => state.workerManager);
  const runPipeline = useStore((state) => state.runPipeline);

  const hasExecutableNodes = useMemo(
    () => nodes.some((node) => node.type === "script" || node.type === "model"),
    [nodes],
  );

  const handleRunPipeline = () => {
    void runPipeline().catch((error) => {
      console.error("Pipeline execution failed", error);
    });
  };

  return (
    <header className="app-header">
      <div className="app-header__top">
        <div className="app-header__copy">
          <p className="app-eyebrow">Strawberry Studios</p>
          <h1 className="app-title">Notebook and canvas editor</h1>
          <p className="app-description">
            Switch between the flow canvas and a vertical notebook while staying synced to the worker daemon.
          </p>
        </div>

        <div className="app-header__actions">
          <button
            type="button"
            className="app-header__run-pipeline"
            onClick={handleRunPipeline}
            disabled={!workerManager || !hasExecutableNodes}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="app-header__run-icon">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>Run Pipeline</span>
          </button>

          <div className={`app-pill app-pill--${connectionState}`}>
            <span>Connection</span>
            <strong>{connectionState}</strong>
          </div>
        </div>
      </div>

      <div className="app-statusbar">
        <div className="app-pill">
          <span>Nodes</span>
          <strong>{nodes.length}</strong>
        </div>
        <div className="app-pill">
          <span>Edges</span>
          <strong>{edges.length}</strong>
        </div>
        <div className="app-pill">
          <span>Workers</span>
          <strong>{workers.length}</strong>
        </div>
        <div className="app-pill">
          <span>Telemetry</span>
          <strong>{workerStats ? `${workerStats.cpuPct.toFixed(1)}% CPU / ${workerStats.memPct.toFixed(1)}% MEM` : "waiting"}</strong>
        </div>
      </div>

      <div className="app-switcher" role="tablist" aria-label="Workspace view">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "canvas"}
          className={`app-switcher__tab${viewMode === "canvas" ? " app-switcher__tab--active" : ""}`}
          onClick={() => onViewModeChange("canvas")}
        >
          Canvas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "notebook"}
          className={`app-switcher__tab${viewMode === "notebook" ? " app-switcher__tab--active" : ""}`}
          onClick={() => onViewModeChange("notebook")}
        >
          Notebook
        </button>
      </div>
    </header>
  );
}
