import type {
  WorkerExitEvent,
  WorkerIdentityEvent,
  WorkerIncomingMessage,
  WorkerOutboundMessage,
  WorkerPongEvent,
  WorkerRealtimeStreamEvent,
  WorkerTelemetryEvent,
} from "@strawberry/shared";
import { useStore } from "../store/useStore";

type WorkerSocketLike = Pick<WebSocket, "close" | "send" | "addEventListener" | "removeEventListener"> & {
  readyState: number;
};

type SocketFactory = (url: string) => WorkerSocketLike | null;

type ActiveExecution = {
  nodeId: string;
  commandId: string;
  scriptId: string | null;
};

type PendingCommand = {
  kind: "exec" | "kill" | "status";
  nodeId?: string;
};

export interface WorkerManagerOptions {
  url?: string;
  autoConnect?: boolean;
  heartbeatIntervalMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  socketFactory?: SocketFactory;
}

const OPEN_STATE = 1;
const DEFAULT_URL = "ws://localhost:7331";
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 10000;

const appendChunk = (existing: string | null, chunk: string) => (existing && existing.length > 0 ? `${existing}${chunk}` : chunk);

const pickNodeId = (payload: Record<string, unknown>, fallback: string | undefined) => {
  const value = payload.node_id ?? payload.nodeId;
  return typeof value === "string" && value.length > 0 ? value : fallback;
};

const pickNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export class WorkerManager {
  private readonly url: string;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly socketFactory: SocketFactory;
  private readonly canAttemptReconnect: boolean;
  private socket: WorkerSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private workerId: string | null = null;
  private commandSequence = 0;
  private readonly outboundQueue: WorkerOutboundMessage[] = [];
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly executionsByNodeId = new Map<string, ActiveExecution>();

  constructor(options: WorkerManagerOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
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

    if (options.autoConnect !== false) {
      void this.connect();
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close(1000, "disposed");
    }
  }

  public exec(nodeId: string, code: string): string {
    const commandId = this.nextCommandId();
    this.pendingCommands.set(commandId, { kind: "exec", nodeId });
    this.executionsByNodeId.set(nodeId, {
      nodeId,
      commandId,
      scriptId: null,
    });

    useStore.getState().updateNode(nodeId, {
      status: this.isSocketOpen() ? "running" : "queued",
      lastOutput: null,
      lastError: null,
      assignedWorker: this.workerId,
      runDuration: null,
    });

    this.send({
      id: commandId,
      type: "command",
      command: "run_script",
      data: {
        code,
        node_id: nodeId,
        nodeId,
      },
    });

    return commandId;
  }

  public kill(nodeId: string): string {
    const commandId = this.nextCommandId();
    this.pendingCommands.set(commandId, { kind: "kill", nodeId });

    const execution = this.executionsByNodeId.get(nodeId);
    const scriptId = execution?.scriptId ?? nodeId;

    useStore.getState().updateNode(nodeId, {
      status: "stopped",
      assignedWorker: null,
    });

    this.send({
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

  public requestStatus(): string {
    const commandId = this.nextCommandId();
    this.pendingCommands.set(commandId, { kind: "status" });

    this.send({
      id: commandId,
      type: "request",
      command: "get_status",
      data: {},
    });

    return commandId;
  }

  private async connect(): Promise<void> {
    if (this.disposed || this.socket || this.reconnectTimer !== null) {
      return;
    }

    const socket = this.socketFactory(this.url);
    if (!socket) {
      if (this.canAttemptReconnect) {
        this.scheduleReconnect();
      } else {
        useStore.getState().setConnectionState("disconnected");
      }
      return;
    }

    this.socket = socket;
    useStore.getState().setConnectionState("connecting");

    const handleOpen = () => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      useStore.getState().setConnectionState("connected");
      this.flushQueue();
      this.startHeartbeat();
    };

    const handleMessage = (event: MessageEvent) => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      if (typeof event.data !== "string") {
        return;
      }

      this.handleMessage(event.data);
    };

    const handleClose = (event: CloseEvent) => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.stopHeartbeat();
      this.handleDisconnect(event.reason || "socket closed");
    };

    const handleError = () => {
      if (this.socket !== socket || this.disposed) {
        return;
      }

      this.scheduleReconnect();
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage as EventListener);
    socket.addEventListener("close", handleClose as EventListener);
    socket.addEventListener("error", handleError as EventListener);
  }

  private handleDisconnect(reason: string): void {
    const activeNodeIds = [...this.executionsByNodeId.keys()];
    for (const nodeId of activeNodeIds) {
      useStore.getState().updateNode(nodeId, {
        status: "stopped",
        lastError: `Worker disconnected: ${reason}`,
        assignedWorker: null,
      });
    }

    this.executionsByNodeId.clear();
    useStore.getState().setConnectionState("disconnected");

    if (!this.disposed) {
      this.scheduleReconnect();
    }
  }

  private handleMessage(rawMessage: string): void {
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
        this.handleIdentity(message);
        return;
      case "telemetry":
      case "heartbeat":
        this.handleTelemetry(message);
        return;
      case "pong":
        this.handlePong(message);
        return;
      case "stdout":
      case "stderr":
      case "stream":
        this.handleStream(message);
        return;
      case "exit":
      case "result":
        this.handleCompletion(message);
        return;
      case "error":
        this.handleWorkerError(message);
        return;
      default:
        console.warn("WorkerManager received unsupported message", message);
    }
  }

  private handleIdentity(message: WorkerIdentityEvent): void {
    const workerId = message.worker_id ?? message.workerId ?? null;
    this.workerId = workerId;

    const stats = useStore.getState().workerStats;
    if (stats) {
      useStore.getState().setWorkerStats({
        ...stats,
        workerId,
      });
    } else {
      useStore.getState().setWorkerStats({
        ts: Date.now(),
        cpuPct: 0,
        memPct: 0,
        workerId,
        lastHeartbeatAt: null,
      });
    }

    for (const nodeId of this.executionsByNodeId.keys()) {
      useStore.getState().updateNode(nodeId, {
        assignedWorker: workerId,
      });
    }
  }

  private handleTelemetry(message: WorkerTelemetryEvent | { type: "heartbeat"; ts: number; cpu_pct: number; mem_pct: number }): void {
    const stats = {
      ts: message.ts,
      cpuPct: message.cpu_pct,
      memPct: message.mem_pct,
      workerId: this.workerId,
      lastHeartbeatAt: Date.now(),
    };

    useStore.getState().setWorkerStats(stats);
  }

  private handlePong(message: WorkerPongEvent): void {
    const stats = useStore.getState().workerStats;
    if (!stats) {
      useStore.getState().setWorkerStats({
        ts: message.ts ?? Date.now(),
        cpuPct: 0,
        memPct: 0,
        workerId: this.workerId,
        lastHeartbeatAt: Date.now(),
      });
      return;
    }

    useStore.getState().setWorkerStats({
      ...stats,
      lastHeartbeatAt: Date.now(),
    });
  }

  private handleStream(message: WorkerRealtimeStreamEvent | Record<string, unknown>): void {
    const pendingNodeId = typeof message.id === "string" ? this.pendingCommands.get(message.id)?.nodeId : undefined;
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
  }

  private handleCompletion(message: WorkerExitEvent | Record<string, unknown>): void {
    const pending = typeof message.id === "string" ? this.pendingCommands.get(message.id) : undefined;
    const payload = message && typeof message === "object" && message.data && typeof message.data === "object" ? (message.data as Record<string, unknown>) : message;
    const hasTelemetryShape =
      typeof payload.ts === "number" && typeof payload.cpu_pct === "number" && typeof payload.mem_pct === "number";
    if (pending?.kind === "status" || hasTelemetryShape) {
      this.handleTelemetry({
        type: "heartbeat",
        ts: pickNumber(payload.ts) ?? Date.now(),
        cpu_pct: pickNumber(payload.cpu_pct) ?? 0,
        mem_pct: pickNumber(payload.mem_pct) ?? 0,
      });
      if (typeof message.id === "string") {
        this.pendingCommands.delete(message.id);
      }
      return;
    }

    const nodeId = pickNodeId(payload, pending?.nodeId);
    if (!nodeId) {
      console.warn("WorkerManager received completion without node id", message);
      return;
    }

    const exitCode = pickNumber(payload.exit_code ?? payload.exitCode ?? (message as Record<string, unknown>).exit_code ?? (message as Record<string, unknown>).exitCode);

    const stopped = Boolean(payload.stopped) || (message.type === "result" && typeof exitCode === "number" && exitCode !== 0 && typeof payload.signal === "undefined");
    const resolvedExitCode = exitCode ?? 0;
    const status = stopped ? "stopped" : resolvedExitCode === 0 ? "success" : "error";

    useStore.getState().updateNode(nodeId, {
      status,
      assignedWorker: null,
      runDuration: null,
    });

    const execution = this.executionsByNodeId.get(nodeId);
    const scriptId = typeof payload.script_id === "string" ? payload.script_id : typeof payload.scriptId === "string" ? payload.scriptId : undefined;
    if (execution && typeof message.id === "string" && execution.commandId === message.id && scriptId) {
      execution.scriptId = scriptId;
      this.executionsByNodeId.set(nodeId, execution);
    }

    this.executionsByNodeId.delete(nodeId);
    if (typeof message.id === "string") {
      this.pendingCommands.delete(message.id);
    }
  }

  private handleWorkerError(message: Record<string, unknown>): void {
    const nodeId = pickNodeId(message, typeof message.id === "string" ? this.pendingCommands.get(message.id)?.nodeId : undefined);
    const errorMessage = typeof message.message === "string" ? message.message : "Worker error";

    if (nodeId) {
      useStore.getState().updateNode(nodeId, {
        status: "error",
        lastError: errorMessage,
      });
    } else {
      console.error("WorkerManager received worker error", message);
    }
  }

  private send(message: WorkerOutboundMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN_STATE) {
      this.outboundQueue.push(message);
      this.connectQueue();
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private connectQueue(): void {
    if (!this.socket && !this.disposed) {
      void this.connect();
    }
  }

  private flushQueue(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN_STATE) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (message) {
        socket.send(JSON.stringify(message));
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = globalThis.setInterval(() => {
      if (!this.isSocketOpen()) {
        return;
      }

      this.socket?.send(JSON.stringify({ type: "ping" }));
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      globalThis.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    const delay = Math.min(this.reconnectBaseDelayMs * 2 ** this.reconnectAttempts, this.reconnectMaxDelayMs);
    this.reconnectAttempts += 1;
    useStore.getState().setConnectionState("reconnecting");

    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === OPEN_STATE;
  }

  private nextCommandId(): string {
    this.commandSequence += 1;
    return `worker-${Date.now()}-${this.commandSequence}`;
  }
}
