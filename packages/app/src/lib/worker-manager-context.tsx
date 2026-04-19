import { createContext, useContext, type PropsWithChildren } from "react";
import type { WorkerManager } from "./worker-manager";

const WorkerManagerContext = createContext<WorkerManager | null>(null);

export function WorkerManagerProvider({
  manager,
  children,
}: PropsWithChildren<{
  manager: WorkerManager | null;
}>) {
  return <WorkerManagerContext.Provider value={manager}>{children}</WorkerManagerContext.Provider>;
}

export function useWorkerManager(): WorkerManager | null {
  return useContext(WorkerManagerContext);
}
