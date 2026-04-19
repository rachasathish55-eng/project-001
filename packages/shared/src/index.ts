export interface StrawberryPosition {
  x: number;
  y: number;
}

export type StrawberryNodeStatus = "idle" | "queued" | "running" | "success" | "error" | "stopped";

export interface StrawberryNode {
  id: string;
  type: string;
  name: string;
  code: string;
  language: string;
  inputs: string[];
  outputs: string[];
  position: StrawberryPosition;
  status: StrawberryNodeStatus;
  lastOutput: string | null;
  lastError: string | null;
  runDuration: number | null;
  assignedWorker: string | null;
  label?: string;
  data?: Record<string, unknown>;
  parentId?: string | null;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export type WorkerCommandType = "command" | "request";

interface WorkerBaseCommand<TCommand extends string, TData> {
  id?: string;
  type?: WorkerCommandType;
  command: TCommand;
  data: TData;
}

export interface RunScriptCommand extends WorkerBaseCommand<"run_script", { code: string }> {}

export interface StopScriptCommand extends WorkerBaseCommand<"stop_script", { script_id: string }> {}

export interface GetStatusCommand extends WorkerBaseCommand<"get_status", Record<string, never>> {}

export interface UploadFileCommand extends WorkerBaseCommand<
  "upload_file",
  { path: string; chunks: string[] | string }
> {}

export interface ListFilesCommand extends WorkerBaseCommand<"list_files", { path: string }> {}

export type WorkerCommand =
  | RunScriptCommand
  | StopScriptCommand
  | GetStatusCommand
  | UploadFileCommand
  | ListFilesCommand;

export interface WorkerHeartbeatEvent {
  type: "heartbeat";
  ts: number;
  cpu_pct: number;
  mem_pct: number;
}

export interface WorkerStreamEvent {
  id: string;
  type: "stream";
  stream: "stdout" | "stderr";
  data: string;
}

export interface WorkerResultEvent<TData = WorkerResultData> {
  id: string;
  type: "result";
  data: TData;
}

export interface WorkerErrorEvent {
  id: string;
  type: "error";
  message: string;
}

export interface RunScriptResult {
  script_id: string;
  pid: number;
  exit_code: number;
}

export interface StopScriptResult {
  script_id: string;
  pid: number;
  stopped: true;
  exit_code: number | null;
}

export interface GetStatusResult {
  ts: number;
  cpu_pct: number;
  mem_pct: number;
}

export interface UploadFileResult {
  path: string;
  bytes_written: number;
}

export interface ListFilesResult {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    type: "dir" | "file";
    size: number;
    mtime: number;
  }>;
}

export type WorkerResultData =
  | RunScriptResult
  | StopScriptResult
  | GetStatusResult
  | UploadFileResult
  | ListFilesResult;

export type WorkerEvent =
  | WorkerHeartbeatEvent
  | WorkerStreamEvent
  | WorkerResultEvent
  | WorkerErrorEvent;
