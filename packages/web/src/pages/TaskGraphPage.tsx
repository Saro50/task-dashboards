import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type Node, type Edge, type MiniMapNodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EngineStatus } from '@/components/Layout';
import type { Task, TaskStatus, UpdateTaskInput } from '@/types/task';
import { taskApi } from '@/api/task';
import { useTasks } from '@/hooks/useTasks';
import { useTopics } from '@/hooks/useTopics';
import { useTaskExecution } from '@/hooks/useTaskExecution';
import { useToast } from '@/components/Toast';
import TaskNode from '@/components/TaskNode';
import TaskEdge from '@/components/TaskEdge';
import TaskDetailPanel from '@/components/TaskDetailPanel';
import TaskStatusBar from '@/components/TaskStatusBar';
import AIChatWidget from '@/components/AIChatWidget';
import type { AIChatWidgetHandle } from '@/components/AIChatWidget';
import { applyDagreLayout } from '@/utils/layout';

interface Props {
  engineStatus: EngineStatus;
}

const taskStatusColor: Record<string, string> = {
  PENDING: '#9ca3af',
  IN_PROGRESS: '#0ea5e9',
  COMPLETED: '#22c55e',
  BLOCKED: '#ef4444',
};

const miniMapNodeColor = (node: Node) => {
  if (node.type === 'task') return taskStatusColor[(node.data as any).status] || '#94a3b8';
  return '#94a3b8';
};

function MiniMapNode({ x, y, width, height, color }: MiniMapNodeProps) {
  const scale = 2.5;
  const sw = width * scale;
  const sh = height * scale;
  return (
    <rect
      x={x - (sw - width) / 2}
      y={y - (sh - height) / 2}
      width={sw}
      height={sh}
      rx={4}
      ry={4}
      fill={color}
      stroke="#fff"
      strokeWidth={1}
      opacity={0.9}
    />
  );
}

const nodeTypes = { task: TaskNode };
const edgeTypes = { task: TaskEdge };

export default function TaskGraphPage({ engineStatus }: Props) {
  const { projectId, topicId } = useParams<{ projectId: string; topicId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tasks, loading, error, refetch } = useTasks(projectId);
  const { topics } = useTopics(projectId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const chatRef = useRef<AIChatWidgetHandle>(null);

  const { executeChain, cancelExecution, executing } = useTaskExecution({
    topicId,
    onTaskUpdated: refetch,
  });

  const topicName = useMemo(
    () => topics.find((t) => t.id === topicId)?.name ?? '',
    [topics, topicId]
  );

  const filteredTasks = useMemo(
    () => tasks.filter((t) => t.topicId === topicId),
    [tasks, topicId]
  );

  const selectedTask = useMemo(
    () => filteredTasks.find((t) => t.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId]
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges] = useEdgesState<Edge>([]);
  const prevTaskIds = useRef<string>('');

  useEffect(() => {
    const taskIds = filteredTasks.map((t) => t.id).sort().join(',');
    const taskMap = new Map(filteredTasks.map((t) => [t.id, t]));
    const filteredTaskIds = new Set(filteredTasks.map((t) => t.id));

    if (taskIds !== prevTaskIds.current) {
      prevTaskIds.current = taskIds;

      const nodes: Node[] = filteredTasks.map((task) => ({
        id: task.id,
        type: 'task',
        position: { x: 0, y: 0 },
        data: {
          title: task.title,
          status: task.status,
          description: task.description,
          depCount: task.dependencies.filter((depId) => filteredTaskIds.has(depId)).length,
          selected: task.id === selectedTaskId,
        },
      }));

      const edges: Edge[] = [];
      for (const task of filteredTasks) {
        for (const depId of task.dependencies) {
          if (!filteredTaskIds.has(depId)) continue;
          edges.push({ id: `${depId}-${task.id}`, source: depId, target: task.id, type: 'task' });
        }
      }

      const { nodes: layoutedNodes } = applyDagreLayout(nodes, edges);
      setFlowNodes(layoutedNodes);
      setFlowEdges(edges);
    } else {
      setFlowNodes((prev) =>
        prev.map((node) => {
          const task = taskMap.get(node.id);
          if (!task) return node;
          const prevData = node.data as any;
          const newSelected = task.id === selectedTaskId;
          if (prevData.status === task.status && prevData.selected === newSelected) {
            return node;
          }
          return {
            ...node,
            data: { ...node.data, status: task.status, selected: newSelected },
          };
        })
      );
    }
  }, [filteredTasks, selectedTaskId, setFlowNodes, setFlowEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedTaskId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-4">加载失败：{error}</p>
          <button onClick={() => refetch()} className="text-sm text-sky-500 hover:text-sky-600 cursor-pointer">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] relative">
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => navigate('/')}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
          >
            项目管理
          </button>
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <button
            onClick={() => navigate(`/project/${projectId}`)}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
          >
            任务主题
          </button>
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-800">{topicName || '任务图谱'}</span>
          <span className="text-xs text-gray-400 ml-1">{filteredTasks.length} 个任务</span>
        </div>
        <div className="flex items-center gap-2">
          {executing ? (
            <button
              onClick={cancelExecution}
              className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer border border-red-200 bg-red-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
              </svg>
              停止执行
            </button>
          ) : (
            <button
              onClick={() => executeChain(filteredTasks)}
              disabled={!filteredTasks.some((t) => t.status === 'PENDING')}
              className="inline-flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              执行任务链
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        <svg className="absolute w-0 h-0" aria-hidden>
          <defs>
            <marker id="task-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
            </marker>
          </defs>
        </svg>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={(instance) => {
            setTimeout(() => instance.fitView({ padding: 0.2 }), 50);
          }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} size={1} />
          <Controls
            showInteractive={false}
            className="!bg-white !border-gray-200 !rounded-lg !shadow-sm [&>button]:!border-gray-200 [&>button]:!bg-white"
          />
          <MiniMap
            nodeColor={miniMapNodeColor}
            nodeComponent={MiniMapNode}
            zoomable
            pannable
            className="!bg-white !border-gray-200 !rounded-lg !shadow-sm"
          />
        </ReactFlow>

        {filteredTasks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">该主题下暂无任务</h3>
              <p className="text-sm text-gray-600">返回主题层查看所有任务</p>
            </div>
          </div>
        )}
      </div>

      <TaskStatusBar tasks={filteredTasks} />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          allTasks={filteredTasks}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={refetch}
        />
      )}

      <AIChatWidget ref={chatRef} engineStatus={engineStatus} />
    </div>
  );
}
