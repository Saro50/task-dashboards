import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlow, Background, Controls, MiniMap, Panel, useNodesState, useEdgesState, type Node, type Edge, type MiniMapNodeProps, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EngineStatus } from '@/components/Layout';
import type { Step } from '@/types/step';
import type { StepStatus } from '@/types/step';
import { stepApi } from '@/api/step';
import { taskApi } from '@/api/task';
import { executionApi } from '@/api/execution';
import { useTasks } from '@/hooks/useTasks';
import { useProject } from '@/hooks/useProject';
import { useTaskExecution } from '@/hooks/useTaskExecution';
import { useToast } from '@/components/Toast';
import StepNode from '@/components/StepNode';
import TaskEdge from '@/components/TaskEdge';
import StepDetailPanel from '@/components/StepDetailPanel';
import StepStatusBar from '@/components/StepStatusBar';
import AIChatWidget from '@/components/AIChatWidget';
import type { AIChatWidgetHandle } from '@/components/AIChatWidget';
import DiffPreview from '@/components/DiffPreview';
import { applyDagreLayout } from '@/utils/layout';
import { buildStepPageContext, buildTaskPageContext } from '@/utils/pageContext';
import { log } from '@/utils/log';

const S = 'StepGraphPage';

interface Props {
  engineStatus: EngineStatus;
  maxConcurrency: number;
}

const stepStatusColor: Record<string, string> = {
  PENDING: '#9ca3af',
  IN_PROGRESS: '#0ea5e9',
  COMPLETED: '#22c55e',
  BLOCKED: '#ef4444',
};

const miniMapNodeColor = (node: Node) => {
  if (node.type === 'step') return stepStatusColor[(node.data as any).status] || '#94a3b8';
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

const nodeTypes = { step: StepNode };
const edgeTypes = { task: TaskEdge };

function MergeDialog({ execution, onMerge, onClose }: {
  execution: { id: string; completedSteps: number; totalSteps: number; worktreeName: string | null };
  onMerge: (branch: string) => void;
  onClose: () => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [current, setCurrent] = useState('main');
  const [branch, setBranch] = useState('');
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    executionApi.getBranches(execution.id).then((res) => {
      if (!cancelled) {
        setBranches(res.branches);
        setCurrent(res.current);
        setBranch(res.current || res.branches[0] || 'main');
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        log.error('MergeDialog', 'getBranches failed', err);
        setError(err.message ?? '获取分支失败');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [execution.id]);

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
          任务链已执行完毕（{execution.completedSteps}/{execution.totalSteps}），将 worktree 的变更合并到指定分支。
        </p>
        {execution.worktreeName && (
          <p className="text-xs text-gray-400 mb-4">Worktree: {execution.worktreeName}</p>
        )}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">目标分支</label>
          {loading ? (
            <div className="w-full px-3 py-2 text-sm text-gray-400 border border-gray-200 rounded-lg">加载分支...</div>
          ) : error ? (
            <div className="w-full px-3 py-2 text-sm text-red-500 border border-red-200 rounded-lg">{error}</div>
          ) : branches.length === 0 ? (
            <div className="w-full px-3 py-2 text-sm text-gray-400 border border-gray-200 rounded-lg">未找到可用分支</div>
          ) : (
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none bg-white cursor-pointer"
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}{b === current ? ' (当前)' : ''}
                </option>
              ))}
            </select>
          )}
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
            disabled={merging || loading || !!error || !branch}
            className="px-4 py-2 text-sm bg-sky-500 hover:bg-sky-600 text-white rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {merging ? '合并中...' : '合并'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StepGraphPage({ engineStatus, maxConcurrency }: Props) {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tasks } = useTasks(projectId);
  const { project } = useProject(projectId);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepsLoading, setStepsLoading] = useState(true);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showDiffPreview, setShowDiffPreview] = useState(false);
  const chatRef = useRef<AIChatWidgetHandle>(null);

  const taskName = useMemo(
    () => tasks.find((t) => t.id === taskId)?.name ?? '',
    [tasks, taskId]
  );

  const currentTask = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId]
  );

  const fetchSteps = useCallback(async () => {
    if (!taskId) return;
    try {
      setStepsLoading(true);
      setStepsError(null);
      const data = await stepApi.listByTask(taskId);
      setSteps(data.steps);
    } catch (err: any) {
      log.error(S, 'fetchSteps error', err);
      setStepsError(err.message);
    } finally {
      setStepsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchSteps();
  }, [fetchSteps]);

  const refetch = fetchSteps;

  const stepContext = useMemo(
    () => buildStepPageContext(project, currentTask ?? null, steps),
    [project, currentTask, steps]
  );

  const taskContext = useMemo(
    () => buildTaskPageContext(project, tasks),
    [project, tasks]
  );

  const chatModes = useMemo(() => [
    { key: 'step', label: '详情步骤', description: '查看当前任务的步骤和依赖关系', context: stepContext },
    { key: 'task', label: '任务', description: '查看项目所有任务信息', context: taskContext },
  ], [stepContext, taskContext]);

  const pageContext = stepContext;

  const {
    executeChain,
    cancelExecution,
    mergeExecution,
    restoreExecution,
    executing,
    execution,
    sessionMessages,
  } = useTaskExecution({
    taskId,
    projectId,
    onStepUpdated: refetch,
    maxConcurrency,
  });

  const restoredRef = useRef(false);
  useEffect(() => {
    restoreExecution();
    restoredRef.current = true;
  }, [restoreExecution]);

  useEffect(() => {
    if (restoredRef.current && execution?.status === 'COMPLETED' && !showDiffPreview && !showMerge) {
      setShowDiffPreview(true);
    }
  }, [execution?.status]);

  const selectedStep = useMemo(
    () => steps.find((s) => s.id === selectedStepId) ?? null,
    [steps, selectedStepId]
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges] = useEdgesState<Edge>([]);
  const prevStepKey = useRef<string>('');

  const handleDeleteStep = useCallback(async (stepId: string) => {
    if (execution) return;
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;
    const confirmed = window.confirm(`确定删除步骤「${step.title}」？`);
    if (!confirmed) return;
    log.info(S, 'handleDeleteStep', { stepId });
    try {
      await stepApi.remove(stepId);
      showToast('步骤已删除', 'success');
      if (selectedStepId === stepId) setSelectedStepId(null);
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDeleteStep error', err);
      showToast(err.message, 'error');
    }
  }, [steps, selectedStepId, showToast, refetch, execution]);

  useEffect(() => {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const stepIds = new Set(steps.map((s) => s.id));
    const stepKey = steps
      .map((s) => `${s.id}:${s.status}:${s.blockedReason ?? ''}:${s.dependencies.filter((d) => stepIds.has(d)).sort().join(',')}`)
      .sort()
      .join('|');

    if (stepKey !== prevStepKey.current) {
      prevStepKey.current = stepKey;

      const nodes: Node[] = steps.map((step) => ({
        id: step.id,
        type: 'step',
        position: { x: 0, y: 0 },
        data: {
          title: step.title,
          status: step.status,
          description: step.description,
          blockedReason: step.blockedReason,
          depCount: step.dependencies.filter((depId) => stepIds.has(depId)).length,
          selected: step.id === selectedStepId,
          disabled: executing,
          onDelete: handleDeleteStep,
        },
      }));

      const edges: Edge[] = [];
      for (const step of steps) {
        for (const depId of step.dependencies) {
          if (!stepIds.has(depId)) continue;
          edges.push({ id: `${depId}-${step.id}`, source: depId, target: step.id, type: 'task', data: { onDeleted: refetch, hovered: false, disabled: false } });
        }
      }

      const { nodes: layoutedNodes } = applyDagreLayout(nodes, edges);
      setFlowNodes(layoutedNodes);
      setFlowEdges(edges);
    }
  }, [steps, selectedStepId, executing, handleDeleteStep, setFlowNodes, setFlowEdges]);

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
    setSelectedStepId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedStepId(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedStepId && !execution) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
        e.preventDefault();
        handleDeleteStep(selectedStepId);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedStepId, execution, handleDeleteStep]);

  const handleHoverDep = useCallback((depId: string | null, type: 'dep' | 'dependent') => {
    if (!depId || !selectedStepId) {
      setHoveredEdgeId(null);
      return;
    }
    const edgeId = type === 'dep' ? `${depId}-${selectedStepId}` : `${selectedStepId}-${depId}`;
    setHoveredEdgeId(edgeId);
  }, [selectedStepId]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (execution) return;
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    log.info(S, 'onConnect', { source: connection.source, target: connection.target });
    try {
      const resp = await stepApi.addDependency(connection.target, connection.source);
      log.info(S, 'onConnect response', resp);
      refetch();
    } catch (err: any) {
      log.error(S, 'onConnect error', err);
      if (!err.message?.includes('409')) {
        showToast(err.message, 'error');
      }
    }
  }, [refetch, showToast, execution]);

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
          <span className="font-medium text-gray-800">{taskName || '步骤图谱'}</span>
          {!stepsLoading && <span className="text-xs text-gray-400 ml-1">{steps.length} 个步骤</span>}
        </div>
        <div className="flex items-center gap-2">
          {execution && executing && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              {execution.status === 'CREATING_WORKTREE' && !execution.worktreeBranch ? (
                <span className="text-amber-600">创建 worktree...</span>
              ) : (
                <span className="text-sky-600">{execution.completedSteps}/{execution.totalSteps}</span>
              )}
            </div>
          )}
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
              onClick={() => executeChain(steps)}
              disabled={!steps.some((s) => s.status === 'PENDING')}
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
          deleteKeyCode={null}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} size={1} />
          <Controls
            showInteractive={false}
            className="!bg-white !border-gray-200 !rounded-lg !shadow-sm [&>button]:!border-gray-200 [&>button]:!bg-white"
          />
          <Panel position="bottom-left" style={{ left: 40 }}>
            <div className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-[10px] text-gray-400 flex flex-col gap-1.5">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-mono">Delete</kbd>
                删除步骤
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-mono">拖拽</kbd>
                连接依赖
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] font-mono">点击</kbd>
                查看详情
              </span>
            </div>
          </Panel>
          <MiniMap
            nodeColor={miniMapNodeColor}
            nodeComponent={MiniMapNode}
            zoomable
            pannable
            className="!bg-white !border-gray-200 !rounded-lg !shadow-sm"
          />
        </ReactFlow>

        {stepsLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-3 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
          </div>
        )}

        {stepsError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <p className="text-red-500 text-sm mb-4">加载失败：{stepsError}</p>
              <button onClick={() => refetch()} className="text-sm text-sky-500 hover:text-sky-600 cursor-pointer">重试</button>
            </div>
          </div>
        )}

        {!stepsLoading && !stepsError && steps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">该任务下暂无步骤</h3>
              <p className="text-sm text-gray-600">返回任务层查看所有步骤</p>
            </div>
          </div>
        )}
      </div>

      <StepStatusBar steps={steps} />

      {(execution?.status === 'COMPLETED' || execution?.status === 'MERGED') && (
        <div className={`flex items-center justify-between px-4 py-2.5 border-t shrink-0 ${
          execution.status === 'MERGED'
            ? 'bg-gray-50 border-gray-200'
            : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-center gap-2 text-xs">
            {execution.status === 'MERGED' ? (
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className={`font-medium ${execution.status === 'MERGED' ? 'text-gray-600' : 'text-green-700'}`}>
              {execution.status === 'MERGED'
                ? `已合并到 ${execution.targetBranch ?? '分支'}`
                : `任务链执行完毕 (${execution.completedSteps}/${execution.totalSteps})`}
            </span>
            {execution.worktreeBranch && (
              <span className={`font-mono ${execution.status === 'MERGED' ? 'text-gray-400' : 'text-green-600'}`}>
                · {execution.worktreeBranch}
              </span>
            )}
          </div>
          {execution.status === 'COMPLETED' && (
            <button
              onClick={() => setShowDiffPreview(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              合并到分支
            </button>
          )}
        </div>
      )}

      {selectedStep && (
        <StepDetailPanel
          step={selectedStep}
          allSteps={steps}
          executionId={execution?.id}
          onClose={() => setSelectedStepId(null)}
          onUpdated={refetch}
          onHoverDep={handleHoverDep}
          disabled={executing}
        />
      )}

      <AIChatWidget ref={chatRef} directory={project?.path} engineStatus={engineStatus} projectId={projectId} taskId={taskId} pageContext={pageContext} chatModes={chatModes} onPlanImported={refetch} existingSteps={steps} />

      {showDiffPreview && execution && execution.status === 'COMPLETED' && (
        <DiffPreview
          executionId={execution.id}
          completedSteps={execution.completedSteps}
          totalSteps={execution.totalSteps}
          onConfirm={() => {
            setShowDiffPreview(false);
            setShowMerge(true);
          }}
          onClose={() => setShowDiffPreview(false)}
        />
      )}

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
