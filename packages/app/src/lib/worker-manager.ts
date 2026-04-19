import type {
  WorkerExitEvent,
  WorkerIdentityEvent,
  WorkerIncomingMessage,
  WorkerOutboundMessage,
  WorkerPongEvent,
  WorkerRealtimeStreamEvent,
  WorkerTelemetryEvent,
} from "@strawberry/shared";
import { useStore, type WorkerRecord } from "../store/useStore";
import { createTerminalLogEntry, splitTerminalChunk } from "./terminal-logs";

type WorkerSocketLike = Pick<WebSocket, "close" | "send" | "addEventListener" | "removeEventListener"> & {
  readyState: number;
};

type SocketFactory = (url: string) => WorkerSocketLike | null;

type ActiveExecution = {
  nodeId: string;
  commandId: string;
  scriptId: string | null;
  workerId: string;
};

type PendingCommand = {
  kind: "exec" | "kill" | "status";
  nodeId?: string;
};

type TelemetryLike = WorkerTelemetryEvent & {
  worker_id?: string;
  hostname?: string;
  os?: string;
  pid?: number;
  version?: string;
  gpu_pct?: number | null;
};

type ConnectionListeners = {
  open: EventListener;
  message: EventListener;
  close: EventListener;
  error: EventListener;
};

type ManagedConnection = {
  id: string;
  url: string;
  socket: WorkerSocketLike | null;
  listeners: ConnectionListeners | null;
  reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null;
  heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null;
  reconnectAttempts: number;
  disposed: boolean;
  status: WorkerRecord["status"];
  workerId: string | null;
  workerHostname: string | null;
  workerOs: string | null;
  workerPid: number | null;
  workerVersion: string | null;
  latestStats: {
    ts: number;
    cpuPct: number;
    memPct: number;
    gpuPct: number | null;
  } | null;
  commandSequence: number;
  outboundQueue: WorkerOutboundMessage[];
  pendingCommands: Map<string, PendingCommand>;
  activeExecutions: Map<string, ActiveExecution>;
  streamRemainders: Map<string, { stdout: string; stderr: string }>;
};

export interface WorkerManagerOptions {
  url?: string;
  workerUrls?: string[];
  autoConnect?: boolean;
  heartbeatIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  socketFactory?: SocketFactory;
}

const OPEN_STATE = 1;
const DEFAULT_URL = "ws://localhost:7331";
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 60000;

const appendChunk = (existing: string | null, chunk: string) => (existing && existing.length > 0 ? `${existing}${chunk}` : chunk);

const pickNodeId = (payload: Record<string, unknown>, fallback: string | undefined) => {
  const value = payload.node_id ?? payload.nodeId;
  return typeof value === "string" && value.length > 0 ? value : fallback;
};

const pickNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizeUrl = (url: string): string => url.trim();

export class WorkerManager {
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly socketFactory: SocketFactory;
  private readonly canAttemptReconnect: boolean;
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly executionsByNodeId = new Map<string, { connectionId: string; commandId: string; scriptId: string | null }>();
  private disposed = false;
  private primaryConnectionId: string | null = null;

  constructor(options: WorkerManagerOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.canAttemptReconnect = typeof options.socketFactory === "function" || typeof globalThis.WebSocket === "function";
    this.socketFactory = options.socketFactory ?? ((url) => {
      if (typeof globalThis.WebSocket !== "function") {
        return null;
      }

      return new globalThis.WebSocket(url);
    });

    const initialUrls = options.workerUrls?.length ? options.workerUrls : [options.url ?? DEFAULT_URL];
    this.primaryConnectionId = normalizeUrl(initialUrls[0] ?? DEFAULT_URL);

    if (options.autoConnect !== false) {
      for (const url of initialUrls) {
        this.connectWorker(url);
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const connection of this.connections.values()) {
      this.destroyConnection(connection, "disposed", true);
    }
    this.connections.clear();
    this.executionsByNodeId.clear();
  }

  public connectWorker(url: string): string {
    const connectionId = normalizeUrl(url);
    let connection = this.connections.get(connectionId);
    if (connection && !connection.disposed) {
      this.clearReconnectTimer(connection);
      void this.ensureConnected(connection);
      return connection.id;
    }

    connection = this.createConnection(connectionId);
    this.connections.set(connectionId, connection);
    if (!this.primaryConnectionId) {
      this.primaryConnectionId = connectionId;
    }
    this.syncWorkerRecord(connection, "connecting");
    void this.ensureConnected(connection);
    return connection.id;
  }

  public disconnectWorker(workerIdOrUrl: string): void {
    const connection = this.findConnection(workerIdOrUrl);
    if (!connection) {
      return;
    }

    this.connections.delete(connection.id);
    this.destroyConnection(connection, "disconnected by user", true);
    if (this.primaryConnectionId === connection.id) {
      this.primaryConnectionId = this.getFirstConnectionId();
    }
    this.refreshConnectionState();
  }

  public getPrimaryWorkerId(): string | null {
    return this.getPrimaryConnection()?.id ?? null;
  }

  public exec(nodeId: string, code: string, workerId?: string | null): string {
    const connection = this.resolveConnection(workerId);
    if (!connection) {
      throw new Error(workerId ? `Worker ${workerId} is not connected.` : "No connected worker is available.");
    }

    const commandId = this.nextCommandId(connection);
    connection.pendingCommands.set(commandId, { kind: "exec", nodeId });
    connection.activeExecutions.set(nodeId, {
      nodeId,
      commandId,
      scriptId: null,
      workerId: connection.id,
    });
    this.executionsByNodeId.set(nodeId, {
      connectionId: connection.id,
      commandId,
      scriptId: null,
    });

    useStore.getState().updateNode(nodeId, {
      status: this.isSocketOpen(connection) ? "running" : "queued",
      lastOutput: null,
      lastError: null,
      runDuration: null,
    });

    this.send(connection, {
      id: commandId,
      type: "command",
      command: "exec",
      data: {
        code,
        node_id: nodeId,
        nodeId,
      },
    });

    return commandId;
  }

  public kill(nodeId: string, workerId?: string | null): string {
    const execution = this.executionsByNodeId.get(nodeId);
    const connection = workerId ? this.resolveConnection(workerId) : execution ? this.connections.get(execution.connectionId) ?? null : this.getPrimaryConnection();
    if (!connection) {
      throw new Error(workerId ? `Worker ${workerId} is not connected.` : "No connected worker is available.");
    }

    const commandId = this.nextCommandId(connection);
    connection.pendingCommands.set(commandId, { kind: "kill", nodeId });

    const scriptId = connection.activeExecutions.get(nodeId)?.scriptId ?? execution?.scriptId ?? nodeId;

    useStore.getState().updateNode(nodeId, {
      status: "stopped",
    });

    this.send(connection, {
      id: commandId,
      type: "command",
      command: "stop_script",
      data: {
        node_id: nodeId,
        nodeId,
        script_id: scriptId,
        scriptId,
      },
    });

    return commandId;
  }

  public requestStatus(workerId?: string | null): string {
    const connection = workerId ? this.resolveConnection(workerId) : this.getPrimaryConnection();
    if (workerId && !connection) {
      throw new Error(`Worker ${workerId} is not connected.`);
    }

    if (!workerId) {
      for (const nextConnection of this.connections.values()) {
        const commandId = this.nextCommandId(nextConnection);
        nextConnection.pendingCommands.set(commandId, { kind: "status" });
        this.send(nextConnection, {
          id: commandId,
          type: "request",
          command: "get_status",
          data: {},
        });
      }
      return "broadcast";
    }

    const commandId = this.nextCommandId(connection);
    connection.pendingCommands.set(commandId, { kind: "status" });
    this.send(connection, {
      id: commandId,
      type: "request",
      command: "get_status",
      data: {},
    });
    return commandId;
  }

  private createConnection(url: string): ManagedConnection {
    return {
      id: url,
      url,
      socket: null,
      listeners: null,
      reconnectTimer: null,
      heartbeatTimer: null,
      reconnectAttempts: 0,
      disposed: false,
      status: "connecting",
      workerId: null,
      workerHostname: null,
      workerOs: null,
      workerPid: null,
      workerVersion: null,
      latestStats: null,
      commandSequence: 0,
      outboundQueue: [],
      pendingCommands: new Map(),
      activeExecutions: new Map(),
      streamRemainders: new Map(),
    };
  }

  private async ensureConnected(connection: ManagedConnection): Promise<void> {
    if (this.disposed || connection.disposed || connection.socket || connection.reconnectTimer !== null) {
      return;
    }

    const socket = this.socketFactory(connection.url);
    if (!socket) {
      if (this.canAttemptReconnect) {
        this.scheduleReconnect(connection);
      } else {
        connection.status = "offline";
        this.syncWorkerRecord(connection, "offline");
        this.refreshConnectionState();
      }
      return;
    }

    connection.socket = socket;
    connection.status = "connecting";
    this.syncWorkerRecord(connection, "connecting");
    this.refreshConnectionState();

    const handleOpen = () => {
      if (connection.socket !== socket || connection.disposed || this.disposed) {
        return;
      }

      this.clearReconnectTimer(connection);
      connection.reconnectAttempts = 0;
      connection.status = "connecting";
      this.syncWorkerRecord(connection, "connecting");
      this.flushQueue(connection);
      this.startHeartbeat(connection);
      this.requestStatus(connection.id);
      this.refreshConnectionState();
    };

    const handleMessage = (event: MessageEvent) => {
      if (connection.socket !== socket || connection.disposed || this.disposed) {
        return;
      }

      if (typeof event.data !== "string") {
        return;
      }

      this.handleMessage(connection, event.data);
    };

    const handleClose = (event: CloseEvent) => {
      if (connection.socket !== socket) {
        return;
      }

      connection.socket = null;
      this.stopHeartbeat(connection);
      this.handleConnectionDrop(connection, event.reason || "socket closed");
    };

    const handleError = () => {
      if (connection.socket !== socket || connection.disposed || this.disposed) {
        return;
      }

      this.scheduleReconnect(connection);
    };

    connection.listeners = {
      open: handleOpen,
      message: handleMessage as EventListener,
      close: handleClose as EventListener,
      error: handleError as EventListener,
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage as EventListener);
    socket.addEventListener("close", handleClose as EventListener);
    socket.addEventListener("error", handleError as EventListener);
  }

  private handleConnectionDrop(connection: ManagedConnection, reason: string): void {
    const activeNodeIds = [...connection.activeExecutions.keys()];
    for (const nodeId of activeNodeIds) {
      this.flushStreamRemainders(connection, nodeId);
      useStore.getState().updateNode(nodeId, {
        status: "stopped",
        lastError: `Worker disconnected: ${reason}`,
        runDuration: null,
      });
      this.executionsByNodeId.delete(nodeId);
    }

    connection.activeExecutions.clear();
    connection.pendingCommands.clear();
    if (!this.disposed && !connection.disposed) {
      connection.status = "reconnecting";
      this.syncWorkerRecord(connection, "reconnecting");
      this.refreshConnectionState();
      this.scheduleReconnect(connection);
      return;
    }

    connection.status = "offline";
    this.syncWorkerRecord(connection, "offline");
    this.refreshConnectionState();
  }

  private handleMessage(connection: ManagedConnection, rawMessage: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage) as unknown;
    } catch (error) {
      console.error("WorkerManager received invalid JSON", error);
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      console.error("WorkerManager received non-object message", parsed);
      return;
    }

    const message = parsed as WorkerIncomingMessage & Record<string, unknown>;
    switch (message.type) {
      case "identity":
        this.handleIdentity(connection, message);
        return;
      case "telemetry":
      case "heartbeat":
        this.handleTelemetry(connection, message);
        return;
      case "pong":
        this.handlePong(connection, message);
        return;
      case "stdout":
      case "stderr":
      case "stream":
        this.handleStream(connection, message);
        return;
      case "exit":
      case "result":
        this.handleCompletion(connection, message);
        return;
      case "error":
        this.handleWorkerError(connection, message);
        return;
      default:
        console.warn("WorkerManager received unsupported message", message);
    }
  }

  private handleIdentity(connection: ManagedConnection, message: WorkerIdentityEvent): void {
    connection.workerId = message.worker_id ?? message.workerId ?? null;
    connection.workerHostname = message.hostname ?? connection.workerHostname;
    connection.workerOs = message.os ?? connection.workerOs;
    connection.workerPid = typeof message.pid === "number" ? message.pid : connection.workerPid;
    connection.workerVersion = message.version ?? connection.workerVersion;
    connection.status = "online";

    this.syncWorkerRecord(connection, "online");
    this.refreshConnectionState();
  }

  private handleTelemetry(connection: ManagedConnection, message: TelemetryLike | { type: "heartbeat"; ts: number; cpu_pct: number; mem_pct: number; gpu_pct?: number | null }): void {
    connection.workerId = message.worker_id ?? connection.workerId;
    connection.workerHostname = message.hostname ?? connection.workerHostname;
    connection.workerOs = message.os ?? connection.workerOs;
    connection.workerPid = typeof message.pid === "number" ? message.pid : connection.workerPid;
    connection.workerVersion = message.version ?? connection.workerVersion;
    connection.latestStats = {
      ts: message.ts,
      cpuPct: message.cpu_pct,
      memPct: message.mem_pct,
      gpuPct: message.gpu_pct ?? null,
    };
    connection.status = "online";

    useStore.getState().setWorkerStats({
      ts: message.ts,
      cpuPct: message.cpu_pct,
      memPct: message.mem_pct,
      gpuPct: message.gpu_pct ?? null,
      workerId: connection.workerId,
      hostname: connection.workerHostname,
      os: connection.workerOs,
      lastHeartbeatAt: Date.now(),
    });
    this.syncWorkerRecord(connection, "online");
    this.refreshConnectionState();
  }

  private handlePong(connection: ManagedConnection, message: WorkerPongEvent): void {
    if (!connection.latestStats) {
      connection.latestStats = {
        ts: message.ts ?? Date.now(),
        cpuPct: 0,
        memPct: 0,
        gpuPct: null,
      };
    }

    connection.status = "online";
    useStore.getState().setWorkerStats({
      ts: message.ts ?? connection.latestStats.ts,
      cpuPct: connection.latestStats.cpuPct,
      memPct: connection.latestStats.memPct,
      gpuPct: connection.latestStats.gpuPct,
      workerId: connection.workerId,
      hostname: connection.workerHostname,
      os: connection.workerOs,
      lastHeartbeatAt: Date.now(),
    });
    this.syncWorkerRecord(connection, "online");
    this.refreshConnectionState();
  }

  private handleStream(connection: ManagedConnection, message: WorkerRealtimeStreamEvent | Record<string, unknown>): void {
    const pendingNodeId = typeof message.id === "string" ? connection.pendingCommands.get(message.id)?.nodeId : undefined;
    const nodeId = pickNodeId(message, pendingNodeId);
    const data = typeof message.data === "string" ? message.data : "";
    const stream = message.type === "stderr" || message.stream === "stderr" ? "stderr" : "stdout";

    if (!nodeId) {
      console.warn("WorkerManager received stream without node id", message);
      return;
    }

    const state = useStore.getState();
    state.updateNode(nodeId, {
      status: "running",
    });
    state.appendOutput(nodeId, stream, data);
    this.appendTerminalStream(connection, nodeId, stream, data);
  }

  private handleCompletion(connection: ManagedConnection, message: WorkerExitEvent | Record<string, unknown>): void {
    const pending = typeof message.id === "string" ? connection.pendingCommands.get(message.id) : undefined;
    const payload = message && typeof message === "object" && message.data && typeof message.data === "object" ? (message.data as Record<string, unknown>) : message;
    const hasTelemetryShape = typeof payload.ts === "number" && typeof payload.cpu_pct === "number" && typeof payload.mem_pct === "number";

    if (pending?.kind === "status" || hasTelemetryShape) {
      this.handleTelemetry(connection, {
        type: "heartbeat",
        ts: pickNumber(payload.ts) ?? Date.now(),
        cpu_pct: pickNumber(payload.cpu_pct) ?? 0,
        mem_pct: pickNumber(payload.mem_pct) ?? 0,
        gpu_pct: typeof payload.gpu_pct === "number" ? payload.gpu_pct : null,
      });
      if (typeof message.id === "string") {
        connection.pendingCommands.delete(message.id);
      }
      return;
    }

    const nodeId = pickNodeId(payload, pending?.nodeId);
    if (!nodeId) {
      console.warn("WorkerManager received completion without node id", message);
      return;
    }

    this.flushStreamRemainders(connection, nodeId);

    const exitCode = pickNumber(payload.exit_code ?? payload.exitCode ?? (message as Record<string, unknown>).exit_code ?? (message as Record<string, unknown>).exitCode);
    const stopped = Boolean(payload.stopped) || (message.type === "result" && typeof exitCode === "number" && exitCode !== 0 && typeof payload.signal === "undefined");
    const resolvedExitCode = exitCode ?? 0;
    const status = stopped ? "stopped" : resolvedExitCode === 0 ? "success" : "error";

    useStore.getState().updateNode(nodeId, {
      status,
      runDuration: null,
    });

    const execution = connection.activeExecutions.get(nodeId);
    const scriptId = typeof payload.script_id === "string" ? payload.script_id : typeof payload.scriptId === "string" ? payload.scriptId : undefined;
    if (execution && typeof message.id === "string" && execution.commandId === message.id && scriptId) {
      execution.scriptId = scriptId;
      connection.activeExecutions.set(nodeId, execution);
      const globalExecution = this.executionsByNodeId.get(nodeId);
      if (globalExecution) {
        globalExecution.scriptId = scriptId;
        this.executionsByNodeId.set(nodeId, globalExecution);
      }
    }

    connection.activeExecutions.delete(nodeId);
    this.executionsByNodeId.delete(nodeId);
    if (typeof message.id === "string") {
      connection.pendingCommands.delete(message.id);
    }
  }

  private handleWorkerError(connection: ManagedConnection, message: Record<string, unknown>): void {
    const pending = typeof message.id === "string" ? connection.pendingCommands.get(message.id) : undefined;
    const nodeId = pickNodeId(message, pending?.nodeId);
    const errorMessage = typeof message.message === "string" ? message.message : "Worker error";

    if (nodeId) {
      this.flushStreamRemainders(connection, nodeId);
      useStore.getState().updateNode(nodeId, {
        status: "error",
        lastError: errorMessage,
      });
      connection.activeExecutions.delete(nodeId);
      this.executionsByNodeId.delete(nodeId);
      if (typeof message.id === "string") {
        connection.pendingCommands.delete(message.id);
      }
    } else {
      console.error("WorkerManager received worker error", message);
    }
  }

  private send(connection: ManagedConnection, message: WorkerOutboundMessage): void {
    const socket = connection.socket;
    if (!socket || socket.readyState !== OPEN_STATE) {
      connection.outboundQueue.push(message);
      void this.ensureConnected(connection);
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private flushQueue(connection: ManagedConnection): void {
    const socket = connection.socket;
    if (!socket || socket.readyState !== OPEN_STATE) {
      return;
    }

    while (connection.outboundQueue.length > 0) {
      const message = connection.outboundQueue.shift();
      if (message) {
        socket.send(JSON.stringify(message));
      }
    }
  }

  private startHeartbeat(connection: ManagedConnection): void {
    this.stopHeartbeat(connection);

    connection.heartbeatTimer = globalThis.setInterval(() => {
      if (!this.isSocketOpen(connection)) {
        return;
      }

      connection.socket?.send(JSON.stringify({ type: "ping" }));
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(connection: ManagedConnection): void {
    if (connection.heartbeatTimer !== null) {
      globalThis.clearInterval(connection.heartbeatTimer);
      connection.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(connection: ManagedConnection): void {
    if (this.disposed || connection.disposed || connection.reconnectTimer !== null) {
      return;
    }

    const delay = Math.min(this.reconnectBaseDelayMs * 2 ** connection.reconnectAttempts, this.reconnectMaxDelayMs);
    const attemptNumber = connection.reconnectAttempts + 1;
    console.info(`WorkerManager reconnecting ${connection.id} in ${delay}ms (attempt ${attemptNumber})`);
    connection.reconnectAttempts += 1;
    connection.status = "reconnecting";
    this.syncWorkerRecord(connection, "reconnecting");
    this.refreshConnectionState();

    connection.reconnectTimer = globalThis.setTimeout(() => {
      connection.reconnectTimer = null;
      void this.ensureConnected(connection);
    }, delay);
  }

  private clearReconnectTimer(connection: ManagedConnection): void {
    if (connection.reconnectTimer !== null) {
      globalThis.clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }
  }

  private isSocketOpen(connection: ManagedConnection): boolean {
    return connection.socket?.readyState === OPEN_STATE;
  }

  private nextCommandId(connection: ManagedConnection): string {
    connection.commandSequence += 1;
    return `worker-${Date.now()}-${connection.id}-${connection.commandSequence}`;
  }

  private getPrimaryConnection(): ManagedConnection | null {
    if (this.primaryConnectionId) {
      const primary = this.connections.get(this.primaryConnectionId);
      if (primary) {
        return primary;
      }
    }

    return this.connections.values().next().value ?? null;
  }

  private getFirstConnectionId(): string | null {
    return this.connections.keys().next().value ?? null;
  }

  private resolveConnection(workerId?: string | null): ManagedConnection | null {
    if (workerId) {
      return this.findConnection(workerId);
    }

    return this.getPrimaryConnection();
  }

  private findConnection(workerIdOrUrl: string): ManagedConnection | null {
    const normalized = normalizeUrl(workerIdOrUrl);
    for (const connection of this.connections.values()) {
      if (
        connection.id === normalized ||
        connection.url === normalized ||
        connection.workerId === normalized ||
        connection.workerHostname === normalized
      ) {
        return connection;
      }
    }

    return null;
  }

  private syncWorkerRecord(connection: ManagedConnection, status: WorkerRecord["status"]): void {
    const stats = connection.latestStats;
    useStore.getState().upsertWorker({
      id: connection.id,
      url: connection.url,
      ts: stats?.ts ?? Date.now(),
      cpuPct: stats?.cpuPct ?? 0,
      memPct: stats?.memPct ?? 0,
      gpuPct: stats?.gpuPct ?? null,
      workerId: connection.workerId,
      hostname: connection.workerHostname ?? connection.id,
      os: connection.workerOs,
      lastHeartbeatAt: stats ? Date.now() : null,
      status,
      pid: connection.workerPid,
      version: connection.workerVersion,
    });
  }

  private refreshConnectionState(): void {
    const workers = useStore.getState().workers;
    if (workers.some((worker) => worker.status === "online")) {
      useStore.getState().setConnectionState("connected");
      return;
    }

    if (workers.some((worker) => worker.status === "connecting")) {
      useStore.getState().setConnectionState("connecting");
      return;
    }

    if (workers.some((worker) => worker.status === "reconnecting")) {
      useStore.getState().setConnectionState("reconnecting");
      return;
    }

    useStore.getState().setConnectionState("disconnected");
  }

  private appendTerminalStream(connection: ManagedConnection, nodeId: string, stream: "stdout" | "stderr", data: string): void {
    const remainder = connection.streamRemainders.get(nodeId) ?? { stdout: "", stderr: "" };
    const split = splitTerminalChunk(data, remainder[stream]);
    remainder[stream] = split.remainder;
    connection.streamRemainders.set(nodeId, remainder);

    if (split.lines.length === 0) {
      return;
    }

    const node = useStore.getState().nodes.find((entry) => entry.id === nodeId);
    const entries = split.lines.map((text) =>
      createTerminalLogEntry({
        ts: Date.now(),
        stream,
        text,
        nodeId,
        nodeName: node?.name,
        workerId: connection.workerId ?? connection.id,
      }),
    );

    useStore.getState().appendTerminalEntries(entries);
  }

  private flushStreamRemainders(connection: ManagedConnection, nodeId: string): void {
    const remainder = connection.streamRemainders.get(nodeId);
    if (!remainder) {
      return;
    }

    const node = useStore.getState().nodes.find((entry) => entry.id === nodeId);
    const entries: ReturnType<typeof createTerminalLogEntry>[] = [];

    if (remainder.stdout.length > 0) {
      entries.push(
        createTerminalLogEntry({
          ts: Date.now(),
          stream: "stdout",
          text: remainder.stdout,
          nodeId,
          nodeName: node?.name,
          workerId: connection.workerId ?? connection.id,
        }),
      );
    }

    if (remainder.stderr.length > 0) {
      entries.push(
        createTerminalLogEntry({
          ts: Date.now(),
          stream: "stderr",
          text: remainder.stderr,
          nodeId,
          nodeName: node?.name,
          workerId: connection.workerId ?? connection.id,
        }),
      );
    }

    useStore.getState().appendTerminalEntries(entries);
    connection.streamRemainders.delete(nodeId);
  }

  private detachListeners(connection: ManagedConnection): void {
    if (!connection.socket || !connection.listeners) {
      return;
    }

    connection.socket.removeEventListener("open", connection.listeners.open);
    connection.socket.removeEventListener("message", connection.listeners.message);
    connection.socket.removeEventListener("close", connection.listeners.close);
    connection.socket.removeEventListener("error", connection.listeners.error);
    connection.listeners = null;
  }

  private destroyConnection(connection: ManagedConnection, reason: string, removeSocket: boolean): void {
    connection.disposed = true;
    this.clearReconnectTimer(connection);
    this.stopHeartbeat(connection);
    this.detachListeners(connection);

    if (removeSocket && connection.socket) {
      const socket = connection.socket;
      connection.socket = null;
      socket.close(1000, reason);
    }

    this.handleConnectionDrop(connection, reason);
  }
}
