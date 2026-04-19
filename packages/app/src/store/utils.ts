import type { StrawberryNode } from "@strawberry/shared";

export interface GraphEdgeLike {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
}

export function topologicalSort(nodes: StrawberryNode[], edges: GraphEdgeLike[]): string[] {
  const nodeIds = nodes.map((node) => node.id);
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0] as const));
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []] as const));
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    const source = edge.source ?? edge.from;
    const target = edge.target ?? edge.to;

    if (!source || !target || !nodeById.has(source) || !nodeById.has(target) || source === target) {
      continue;
    }

    const edgeKey = `${source}->${target}`;
    if (seenEdges.has(edgeKey)) {
      continue;
    }

    seenEdges.add(edgeKey);
    adjacency.get(source)?.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    ordered.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);

      if (nextDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (ordered.length === nodeIds.length) {
    return ordered;
  }

  return [...ordered, ...nodeIds.filter((id) => !visited.has(id))];
}
