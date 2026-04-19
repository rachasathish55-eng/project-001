import type { StrawberryNode } from "../../../../shared/src";

export interface GraphEdgeLike {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
}

export function topologicalSort(nodes: StrawberryNode[], edges: GraphEdgeLike[]): StrawberryNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    const source = edge.source ?? edge.from;
    const target = edge.target ?? edge.to;

    if (!source || !target || !nodeById.has(source) || !nodeById.has(target) || source === target) {
      continue;
    }

    adjacency.get(source)?.push(target);
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0);
  const ordered: StrawberryNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    ordered.push(current);

    for (const neighbor of adjacency.get(current.id) ?? []) {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);

      if (nextDegree === 0) {
        const nextNode = nodeById.get(neighbor);
        if (nextNode) {
          queue.push(nextNode);
        }
      }
    }
  }

  if (ordered.length === nodes.length) {
    return ordered;
  }

  const remaining = nodes.filter((node) => !ordered.some((orderedNode) => orderedNode.id === node.id));
  return [...ordered, ...remaining];
}
