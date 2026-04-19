import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import Canvas from "./components/Editor/Canvas";
import CommandPalette, { type CommandPaletteAction } from "./components/CommandPalette";
import Header from "./components/Header";
import NotebookView from "./components/NotebookView";
import TerminalPanel from "./components/TerminalPanel";
import WorkerDashboard from "./components/WorkerDashboard";
import { useShortcuts } from "./hooks/useShortcuts";
import { createScriptNode } from "./lib/node-templates";
import { WorkerManagerProvider } from "./lib/worker-manager-context";
import { WorkerManager } from "./lib/worker-manager";
import { useStore } from "./store/useStore";
import { saveBerryProject } from "./utils/berryFormat";

export default function App() {
  const [viewMode, setViewMode] = useState<"canvas" | "notebook">("canvas");
  const [isWorkerDashboardOpen, setIsWorkerDashboardOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [connectFocusSignal, setConnectFocusSignal] = useState(0);
  const [manager, setManager] = useState<WorkerManager | null>(null);
  const nodes = useStore((state) => state.nodes);
  const workerManager = useStore((state) => state.workerManager);
  const addNode = useStore((state) => state.addNode);
  const activeNodeId = useStore((state) => state.activeNodeId);
  const runNode = useStore((state) => state.runNode);
  const runPipeline = useStore((state) => state.runPipeline);
  const setActiveNodeId = useStore((state) => state.setActiveNodeId);

  const hasExecutableNodes = useMemo(() => nodes.some((node) => node.type === "script" || node.type === "model"), [nodes]);

  useEffect(() => {
    const nextManager = new WorkerManager();
    setManager(nextManager);
    useStore.getState().setWorkerManager(nextManager);

    return () => {
      useStore.getState().setWorkerManager(null);
      nextManager.dispose();
    };
  }, []);

  const handleSaveProject = useCallback(() => {
    void saveBerryProject(viewMode).catch((error) => {
      console.error("Berry export failed", error);
    });
  }, [viewMode]);

  const handleRunFocusedNode = useCallback(() => {
    if (!activeNodeId) {
      return false;
    }

    void runNode(activeNodeId).catch((error) => {
      console.error("Focused node execution failed", error);
    });
    return true;
  }, [activeNodeId, runNode]);

  const handleCreateScriptNode = useCallback(() => {
    const node = createScriptNode(nodes.length);
    addNode(node);
    setActiveNodeId(node.id);
    setViewMode("notebook");
  }, [addNode, nodes.length, setActiveNodeId]);

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(
    () => [
      {
        id: "run-pipeline",
        label: "Run Entire Pipeline",
        description: "Execute the full graph in topological order.",
        disabled: !workerManager || !hasExecutableNodes,
        onSelect: () => {
          void runPipeline().catch((error) => {
            console.error("Pipeline execution failed", error);
          });
        },
      },
      {
        id: "create-script-node",
        label: "Create Script Node",
        description: "Add a new Python cell and jump to notebook view.",
        onSelect: handleCreateScriptNode,
      },
      {
        id: "save-project",
        label: "Save Project (.berry)",
        description: "Export the current workspace to a Berry archive.",
        onSelect: handleSaveProject,
      },
      {
        id: "connect-worker",
        label: "Connect Worker",
        description: "Open the worker dashboard and focus the connection field.",
        disabled: !workerManager,
        onSelect: () => {
          setIsWorkerDashboardOpen(true);
          setConnectFocusSignal((current) => current + 1);
        },
      },
      {
        id: "toggle-view",
        label: "Toggle Notebook/Canvas",
        description: "Switch between the graph canvas and notebook editor.",
        onSelect: () => {
          setViewMode((current) => (current === "canvas" ? "notebook" : "canvas"));
        },
      },
    ],
    [handleCreateScriptNode, handleSaveProject, hasExecutableNodes, runPipeline, workerManager],
  );

  useShortcuts({
    onOpenCommandPalette: () => setIsCommandPaletteOpen((current) => !current),
    onSaveProject: handleSaveProject,
    onRunFocusedNode: handleRunFocusedNode,
    onToggleWorkerDashboard: () => setIsWorkerDashboardOpen((current) => !current),
  });

  return (
    <WorkerManagerProvider manager={manager}>
      <main className="app-shell">
        <Header viewMode={viewMode} onViewModeChange={setViewMode} />

        <section
          className={`workspace-shell${isWorkerDashboardOpen ? "" : " workspace-shell--dashboard-collapsed"}`}
        >
          <WorkerDashboard
            isOpen={isWorkerDashboardOpen}
            onToggle={() => setIsWorkerDashboardOpen((current) => !current)}
            focusConnectSignal={connectFocusSignal}
          />

          <section className="workspace-main">
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === "canvas" ? (
                <motion.section
                  key="canvas"
                  className="editor-shell"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <aside className="editor-sidebar">
                    <span className="editor-sidebar__label">Canvas</span>
                    <h2>Flow-based notebook editing</h2>
                    <p>
                      Each node is draggable, connectable, and mirrors live status from the Claw Worker daemon.
                    </p>
                    <ul>
                      <li>Left handle = incoming data</li>
                      <li>Right handle = outgoing data</li>
                      <li>Status badges update in real time</li>
                    </ul>
                  </aside>

                  <div className="editor-canvas">
                    <Canvas />
                  </div>
                </motion.section>
              ) : (
                <motion.section
                  key="notebook"
                  className="notebook-shell"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                >
                  <NotebookView />
                </motion.section>
              )}
            </AnimatePresence>

            <TerminalPanel />
          </section>
        </section>

        <CommandPalette open={isCommandPaletteOpen} onOpenChange={setIsCommandPaletteOpen} actions={commandPaletteActions} />
      </main>
    </WorkerManagerProvider>
  );
}
