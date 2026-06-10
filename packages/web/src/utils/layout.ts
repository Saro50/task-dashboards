import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

// 节点尺寸常量：与 TaskNode (w-72=288px、高度约 120-140px) 匹配，
// 用于 dagre 计算节点间距。StepNode 尺寸接近，复用同一常量。
const NODE_WIDTH = 288;
const NODE_HEIGHT = 130;

// 网格布局的单元格尺寸：节点宽 + 32 水平间距、节点高 + 50 垂直间距
const GRID_CELL_W = NODE_WIDTH + 32;
const GRID_CELL_H = NODE_HEIGHT + 50;

export function applyDagreLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  // 无依赖边时所有节点会被 dagre 放进同一 rank 横排，体验差；
  // 改走网格布局，列数随节点数自适应（ceil(sqrt(n))）。
  if (edges.length === 0) {
    return applyGridLayout(nodes);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/**
 * 网格布局：节点按行优先排列，列数 = ceil(sqrt(n)) 自适应。
 * 仅在没有任何依赖边时由 applyDagreLayout 调用，避免任务卡片默认横排一行。
 */
function applyGridLayout(nodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const layoutedNodes = nodes.map((node, i) => ({
    ...node,
    position: {
      x: (i % cols) * GRID_CELL_W,
      y: Math.floor(i / cols) * GRID_CELL_H,
    },
  }));
  return { nodes: layoutedNodes, edges: [] };
}
