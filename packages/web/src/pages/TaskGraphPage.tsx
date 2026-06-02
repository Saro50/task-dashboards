import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, type Node, type Edge, type MiniMapNodeProps, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EngineStatus } from '@/components/Layout';
import type { Task, TaskStatus, UpdateTaskInput } from '@/types/task';
import { taskApi } from '@/api/task';
import { useTasks } from '@/hooks/useTasks';
import { useTopics } from '@/hooks/useTopics';
import { useProject } from '@/hooks/useProject';
import { useTaskExecution } from '@/hooks/useTaskExecution';
import { useToast } from '@/components/Toast';
import TaskNode from '@/components/TaskNode';
import TaskEdge from '@/components/TaskEdge';
import TaskDetailPanel from '@/components/TaskDetailPanel';
import TaskStatusBar from '@/components/TaskStatusBar';
import AIChatWidget from '@/components/AIChatWidget';
import type { AIChatWidgetHandle } from '@/components/AIChatWidget';
import { applyDagreLayout } from '@/utils/layout';
import { log } from '@/utils/log';

const S = 'TaskGraphPage';

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

/**
 * 合并对话框组件。
 *
 * 为什么需要这个组件：任务链执行完成后（COMPLETED 状态），所有代码变更都在 worktree
 * 隔离环境中，尚未合回主分支。这个对话框让用户选择目标分支（如 main），
 * 确认后调用后端 merge API 将执行标记为 MERGED。
 * 这是执行流程的最后一环：执行 → 完成 → 合并。
 */
function MergeDialog({ execution, onMerge, onClose }: {
  execution: { id: string; completedTasks: number; totalTasks: number; worktreeName: string | null };
  onMerge: (branch: string) => void;
  onClose: () => void;
}) {
  const [branch, setBranch] = useState('main');
  const [merging, setMerging] = useState(false);

  const handleMerge = async () => {
    setMerging(true);
    await onMerge(branch);
    setMerging(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">合并到分支</h3>
        <p className="text-sm text-gray-600 mb-4">
          任务链已执行完毕（{execution.completedTasks}/{execution.totalTasks}），将 worktree 的变更合并到指定分支。
        </p>
        {execution.worktreeName && (
          <p className="text-xs text-gray-400 mb-4">Worktree: {execution.worktreeName}</p>
        )}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">目标分支</label>
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={merging}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleMerge}
            disabled={merging || !branch.trim()}
            className="px-4 py-2 text-sm bg-sky-500 hover:bg-sky-600 text-white rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {merging ? '合并中...' : '合并'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TaskGraphPage({ engineStatus }: Props) {
  const { projectId, topicId } = useParams<{ projectId: string; topicId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tasks, loading, error, refetch } = useTasks(projectId);
  const { topics } = useTopics(projectId);
  const { project } = useProject(projectId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const chatRef = useRef<AIChatWidgetHandle>(null);

  // 重构说明：新增 projectId 参数传递给 useTaskExecution。
  // 之前 hook 是纯前端模拟，不需要 projectId；现在后端需要 projectId 来查找
  // 项目的本地路径，以便创建 worktree 和 AI 会话。
  const {
    executeChain,
    cancelExecution,
    mergeExecution,
    restoreExecution,
    executing,
    execution,
    maxConcurrency,
    setMaxConcurrency,
  } = useTaskExecution({
    topicId,
    projectId,
    onTaskUpdated: refetch,
  });

  // 页面加载时恢复执行状态
  const restoredRef = useRef(false);
  useEffect(() => {
    restoreExecution();
    restoredRef.current = true;
  }, [restoreExecution]);

  // 首次恢复到 COMPLETED 状态时弹出合并对话框提示用户
  useEffect(() => {
    if (restoredRef.current && execution?.status === 'COMPLETED' && !showMerge) {
      setShowMerge(true);
    }
  }, [execution?.status]);

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
  const prevTaskKey = useRef<string>('');

  const handleDeleteTask = useCallback(async (taskId: string) => {
    const task = filteredTasks.find((t) => t.id === taskId);
    if (!task) return;
    const confirmed = window.confirm(`确定删除任务「${task.title}」？`);
    if (!confirmed) return;
    log.info(S, 'handleDeleteTask', { taskId });
    try {
      await taskApi.remove(taskId);
      showToast('任务已删除', 'success');
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDeleteTask error', err);
      showToast(err.message, 'error');
    }
  }, [filteredTasks, selectedTaskId, showToast, refetch]);

  useEffect(() => {
    const taskMap = new Map(filteredTasks.map((t) => [t.id, t]));
    const filteredTaskIds = new Set(filteredTasks.map((t) => t.id));
    const taskKey = filteredTasks
      .map((t) => `${t.id}:${t.status}:${t.dependencies.filter((d) => filteredTaskIds.has(d)).sort().join(',')}`)
      .sort()
      .join('|');

    if (taskKey !== prevTaskKey.current) {
      prevTaskKey.current = taskKey;

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
          disabled: executing,
          onDelete: handleDeleteTask,
        },
      }));

      const edges: Edge[] = [];
      for (const task of filteredTasks) {
        for (const depId of task.dependencies) {
          if (!filteredTaskIds.has(depId)) continue;
          edges.push({ id: `${depId}-${task.id}`, source: depId, target: task.id, type: 'task', data: { onDeleted: refetch, hovered: false, disabled: false } });
        }
      }

      const { nodes: layoutedNodes } = applyDagreLayout(nodes, edges);
      setFlowNodes(layoutedNodes);
      setFlowEdges(edges);
    }
  }, [filteredTasks, selectedTaskId, executing, handleDeleteTask, setFlowNodes, setFlowEdges]);

  useEffect(() => {
    setFlowEdges((prev) =>
      prev.map((edge) => {
        const isHovered = edge.id === hoveredEdgeId;
        const prevHovered = (edge.data as any)?.hovered;
        const prevDisabled = (edge.data as any)?.disabled;
        if (isHovered === prevHovered && executing === prevDisabled) return edge;
        return { ...edge, data: { ...edge.data, hovered: isHovered, disabled: executing } };
      })
    );
  }, [hoveredEdgeId, executing, setFlowEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    log.info(S, 'onNodeClick', { nodeId: node.id });
    setSelectedTaskId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  const handleHoverDep = useCallback((depId: string | null, type: 'dep' | 'dependent') => {
    if (!depId || !selectedTaskId) {
      setHoveredEdgeId(null);
      return;
    }
    const edgeId = type === 'dep' ? `${depId}-${selectedTaskId}` : `${selectedTaskId}-${depId}`;
    setHoveredEdgeId(edgeId);
  }, [selectedTaskId]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (executing) return;
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    log.info(S, 'onConnect', { source: connection.source, target: connection.target });
    try {
      const resp = await taskApi.addDependency(connection.target, connection.source);
      log.info(S, 'onConnect response', resp);
      refetch();
    } catch (err: any) {
      log.error(S, 'onConnect error', err);
      if (!err.message?.includes('409')) {
        showToast(err.message, 'error');
      }
    }
  }, [refetch, showToast, executing]);

  const handleMerge = useCallback(async (branch: string) => {
    await mergeExecution(branch);
    setShowMerge(false);
  }, [mergeExecution]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] relative">
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => { log.info(S, 'navigate to /'); navigate('/'); }}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
          >
            项目管理
          </button>
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <button
            onClick={() => { log.info(S, 'navigate to project', { projectId }); navigate(`/project/${projectId}`); }}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
          >
            {project?.name ?? '...'}
          </button>
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-800">{topicName || '任务图谱'}</span>
          {!loading && <span className="text-xs text-gray-400 ml-1">{filteredTasks.length} 个任务</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* 执行进度指示器：显示 worktree 创建状态或任务完成进度 */}
          {execution && executing && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              {execution.status === 'CREATING_WORKTREE' && !execution.worktreeBranch ? (
                <span className="text-amber-600">创建 worktree...</span>
              ) : (
                <span className="text-sky-600">{execution.completedTasks}/{execution.totalTasks}</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">并发</span>
            <select
              value={maxConcurrency}
              onChange={(e) => { const v = Number(e.target.value); log.info(S, 'setMaxConcurrency', { value: v }); setMaxConcurrency(v); }}
              disabled={executing}
              className="text-xs border border-gray-200 rounded-md px-1.5 py-1 bg-white text-gray-700 outline-none focus:border-sky-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {execution?.worktreeBranch && execution.status !== 'MERGED' && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-xs text-gray-600">
              <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 4.5h10.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75a2.25 2.25 0 012.25-2.25z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6" />
              </svg>
              <span className="font-mono truncate max-w-48">{execution.worktreeBranch}</span>
            </div>
          )}
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
          onEdgeMouseEnter={(_: React.MouseEvent, edge: Edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          onConnect={onConnect}
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

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-3 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <p className="text-red-500 text-sm mb-4">加载失败：{error}</p>
              <button onClick={() => refetch()} className="text-sm text-sky-500 hover:text-sky-600 cursor-pointer">重试</button>
            </div>
          </div>
        )}

        {!loading && !error && filteredTasks.length === 0 && (
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

      {execution?.status === 'COMPLETED' && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-green-50 border-t border-green-200 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-green-700 font-medium">
              任务链执行完毕 ({execution.completedTasks}/{execution.totalTasks})
            </span>
            {execution.worktreeBranch && (
              <span className="text-green-600 font-mono">· {execution.worktreeBranch}</span>
            )}
          </div>
          <button
            onClick={() => setShowMerge(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            合并到分支
          </button>
        </div>
      )}

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          allTasks={filteredTasks}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={refetch}
          onHoverDep={handleHoverDep}
          disabled={executing}
        />
      )}

      <AIChatWidget ref={chatRef} directory={project?.path} engineStatus={engineStatus} projectId={projectId} topicId={topicId} onPlanImported={refetch} />

      {/* 执行完成时弹出合并对话框，让用户选择目标分支完成 worktree 合并 */}
      {showMerge && execution && execution.status === 'COMPLETED' && (
        <MergeDialog
          execution={execution}
          onMerge={handleMerge}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
}
