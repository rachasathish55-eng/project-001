export type TerminalStream = "stdout" | "stderr";

export interface TerminalLogEntry {
  id: string;
  ts: number;
  stream: TerminalStream;
  text: string;
  nodeId?: string;
  nodeName?: string;
  workerId?: string | null;
}

export const TERMINAL_LOG_LIMIT = 1000;

let terminalSequence = 0;

export function createTerminalLogEntry(entry: Omit<TerminalLogEntry, "id">): TerminalLogEntry {
  terminalSequence += 1;
  return {
    id: `terminal-log-${Date.now()}-${terminalSequence}`,
    ...entry,
  };
}

export function appendTerminalLogEntries(existing: TerminalLogEntry[], next: TerminalLogEntry[]): TerminalLogEntry[] {
  if (next.length === 0) {
    return existing;
  }

  const merged = [...existing, ...next];
  if (merged.length <= TERMINAL_LOG_LIMIT) {
    return merged;
  }

  return merged.slice(merged.length - TERMINAL_LOG_LIMIT);
}

export function splitTerminalChunk(chunk: string, carry = ""): { lines: string[]; remainder: string } {
  const combined = `${carry}${chunk}`;
  const parts = combined.split(/\r?\n/);
  const remainder = parts.pop() ?? "";
  return {
    lines: parts,
    remainder,
  };
}
