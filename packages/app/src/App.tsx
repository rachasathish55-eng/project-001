import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Canvas from "./components/Editor/Canvas";
import Header from "./components/Header";
import NotebookView from "./components/NotebookView";
import TerminalPanel from "./components/TerminalPanel";
import WorkerDashboard from "./components/WorkerDashboard";
import { WorkerManagerProvider } from "./lib/worker-manager-context";
import { WorkerManager } from "./lib/worker-manager";
import { useStore } from "./store/useStore";

export default function App() {
  const [viewMode, setViewMode] = useState<"canvas" | "notebook">("canvas");
  const [isWorkerDashboardOpen, setIsWorkerDashboardOpen] = useState(true);
  const [manager, setManager] = useState<WorkerManager | null>(null);

  useEffect(() => {
    const nextManager = new WorkerManager();
    setManager(nextManager);
    useStore.getState().setWorkerManager(nextManager);

    return () => {
      useStore.getState().setWorkerManager(null);
      nextManager.dispose();
    };
  }, []);

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
      </main>
    </WorkerManagerProvider>
  );
}
