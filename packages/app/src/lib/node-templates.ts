import type { StrawberryNode } from "@strawberry/shared";

export function createScriptNode(index: number): StrawberryNode {
  const suffix = index + 1;

  return {
    id: `script-${Date.now()}-${suffix}`,
    type: "script",
    name: `Script ${suffix}`,
    code: "",
    language: "python",
    inputs: [],
    outputs: [],
    position: {
      x: 0,
      y: index * 220,
    },
    status: "idle",
    lastOutput: null,
    lastError: null,
    runDuration: null,
    assignedWorker: null,
  };
}
