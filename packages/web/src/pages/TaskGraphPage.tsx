import { useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type MiniMapNodeProps } from '@xyflow/react';
import type { EngineStatus } from '@/components/Layout';
import { useTasks } from '@/hooks/useTasks';
import { useProject } from '@/hooks/useProject';
import { useToast } from '@/components/Toast';
import { taskApi } from '@/api/task';
import { stepApi } from '@/api/step';
import TaskNode from '@/components/TaskNode';
import StepNode from '@/components/StepNode';
import TaskEdge from '@/components/TaskEdge';
import AIChatWidget from '@/components/AIChatWidget';
import type { AIChatWidgetHandle, FocusedItem } from '@/components/AIChatWidget';
import { applyDagreLayout } from '@/utils/layout';
import { buildTaskPageContext } from '@/utils/pageContext';
import { log } from '@/utils/log';

const S = 'TaskGraphPage';

interface Props {
  engineStatus: EngineStatus;
}

const taskNodeTypes = { task: TaskNode, step: StepNode };
const edgeTypes = { task: TaskEdge };

const taskStatusColor: Record<string, string> = {
  PENDING: '#9ca3af',
  IN_PROGRESS: '#0ea5e9',
  COMPLETED: '#22c55e',
  BLOCKED: '#ef4444',
};

const stepStatusColor: Record<string, string> = {
  PENDING: '#d1d5db',
  IN_PROGRESS: '#7dd3fc',
  COMPLETED: '#86efac',
  BLOCKED: '#fca5a5',
};

const miniMapNodeColor = (node: Node) => {
  if (node.type === 'task') return taskStatusColor[(node.data as any).aggregatedStatus] || '#94a3b8';
  if (node.type === 'step') return stepStatusColor[(node.data as any).status] || '#d1d5db';
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

export default function TaskGraphPage({ engineStatus }: Props) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tasks, dependencies, orphanSteps, loading, error, refetch } = useTasks(projectId);
  const { project } = useProject(projectId);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** 聚焦任务ID — 用户点击任务卡片时设置，用于 AI 上下文聚焦 */
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const chatRef = useRef<AIChatWidgetHandle>(null);

  /** 聚焦任务对象 — 用于 pageContext 注入 */
  const focusedTask = useMemo(
    () => tasks.find((t) => t.id === focusedTaskId) ?? undefined,
    [tasks, focusedTaskId],
  );

  /** 聚焦卡片信息 — 传入 AIChatWidget 用于输入区视觉提示 */
  const focusedItem: FocusedItem | undefined = useMemo(() => {
    if (!focusedTask) return undefined;
    const statusLabels: Record<string, string> = {
      PENDING: '待处理', IN_PROGRESS: '进行中', COMPLETED: '已完成', BLOCKED: '阻塞',
    };
    return { name: focusedTask.name, status: statusLabels[focusedTask.aggregatedStatus] ?? focusedTask.aggregatedStatus, type: 'task' };
  }, [focusedTask]);

  /** 取消聚焦 */
  const handleClearFocus = useCallback(() => {
    setFocusedTaskId(null);
  }, []);

  const pageContext = useMemo(
    () => buildTaskPageContext(project, tasks, focusedTask),
    [project, tasks, focusedTask]
  );

  const handleEditTask = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    log.info(S, 'handleEditTask', { taskId, name: task.name });
    setEditingTaskId(taskId);
    setEditingName(task.name);
  }, [tasks]);

  const handleEditingNameChange = useCallback((name: string) => {
    setEditingName(name);
  }, []);

  const handleEditingConfirm = useCallback(async () => {
    if (!editingTaskId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingTaskId(null);
      return;
    }
    log.info(S, 'handleEditingConfirm', { editingTaskId, name: trimmed });
    try {
      await taskApi.update(editingTaskId, { name: trimmed });
      showToast('任务已重命名', 'success');
      refetch();
    } catch (err: any) {
      log.error(S, 'handleEditingConfirm error', err);
      showToast(err.message, 'error');
    }
    setEditingTaskId(null);
  }, [editingTaskId, editingName, showToast, refetch]);

  const handleEditingCancel = useCallback(() => {
    setEditingTaskId(null);
  }, []);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const confirmed = window.confirm(`确定要删除任务「${task.name}」吗？该任务下的所有步骤将被一并删除，此操作不可撤销。`);
    if (!confirmed) return;
    log.info(S, 'handleDeleteTask', { taskId });
    try {
      await taskApi.remove(taskId);
      showToast('任务已删除', 'success');
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDeleteTask error', err);
      showToast(err.message, 'error');
    }
  }, [tasks, showToast, refetch]);

  const handleDeleteStep = useCallback(async (stepId: string) => {
    const step = orphanSteps.find((s) => s.id === stepId);
    if (!step) return;
    const confirmed = window.confirm(`确定删除步骤「${step.title}」？`);
    if (!confirmed) return;
    log.info(S, 'handleDeleteStep', { stepId });
    try {
      await stepApi.remove(stepId);
      showToast('步骤已删除', 'success');
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDeleteStep error', err);
      showToast(err.message, 'error');
    }
  }, [orphanSteps, showToast, refetch]);

  /** 跳转到步骤页 — 通过卡片上的箭头按钮触发 */
  const handleNavigateTask = useCallback((taskId: string) => {
    log.info(S, 'handleNavigateTask', { taskId });
    navigate(`/project/${projectId}/task/${taskId}`);
  }, [navigate, projectId]);

  const { nodes: flowNodes, edges: baseEdges } = useMemo(() => {
    const nodes: Node[] = [];

    for (const task of tasks) {
      nodes.push({
        id: task.id,
        type: 'task',
        position: { x: 0, y: 0 },
        data: {
          name: task.name,
          summary: task.summary,
          stepCount: task.stepCount,
          completedStepCount: task.completedStepCount,
          aggregatedStatus: task.aggregatedStatus,
          tokenInput: task.tokenInput,
          tokenOutput: task.tokenOutput,
          cacheRead: task.cacheRead,
          onEdit: handleEditTask,
          onDelete: handleDeleteTask,
          onNavigate: handleNavigateTask,
          focused: task.id === focusedTaskId,
          editing: editingTaskId === task.id,
          editingName,
          onEditingNameChange: handleEditingNameChange,
          onEditingConfirm: handleEditingConfirm,
          onEditingCancel: handleEditingCancel,
        },
      });
    }

    for (const step of orphanSteps) {
      nodes.push({
        id: step.id,
        type: 'step',
        position: { x: 0, y: 0 },
        data: {
          title: step.title,
          status: step.status,
          description: step.description,
          depCount: step.dependencies.length,
          onDelete: handleDeleteStep,
        },
      });
    }

    const edges: Edge[] = dependencies.map((dep) => ({
      id: `${dep.sourceId}-${dep.targetId}`,
      source: dep.sourceId,
      target: dep.targetId,
      type: 'task',
      data: { onDeleted: refetch },
    }));

    return applyDagreLayout(nodes, edges);
  }, [tasks, dependencies, orphanSteps, refetch, editingTaskId, editingName, focusedTaskId, handleEditTask, handleDeleteTask, handleDeleteStep, handleNavigateTask, handleEditingNameChange, handleEditingConfirm, handleEditingCancel]);

  const flowEdges = useMemo(
    () => baseEdges.map((e) => ({ ...e, data: { ...e.data, hovered: e.id === hoveredEdgeId } })),
    [baseEdges, hoveredEdgeId]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    log.info(S, 'onNodeClick', { nodeId: node.id, type: node.type });
    if (node.type === 'task') {
      // 点击任务卡片 → 选中聚焦（不跳转），用于 AI 上下文
      setFocusedTaskId((prev) => prev === node.id ? null : node.id);
    }
  }, []);

  /** 点击画布空白区域取消聚焦 */
  const onPaneClick = useCallback(() => {
    setFocusedTaskId(null);
  }, []);

  const handleCreateTask = useCallback(() => {
    log.info(S, 'handleCreateTask');
    chatRef.current?.openWithMessage('请帮我创建一个任务，讨论并规划一个功能模块的实现', { newSession: true, agent: 'task-helper' });
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
            onClick={() => { log.info(S, 'navigate to /'); navigate('/'); }}
            className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
          >
            项目管理
          </button>
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-800">{project?.name ?? '...'}</span>
          <span className="text-xs text-gray-400 ml-1">{tasks.length} 个任务</span>
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
          nodeTypes={taskNodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onEdgeMouseEnter={(_: React.MouseEvent, edge: Edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
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

        {tasks.length === 0 && orphanSteps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">暂无任务</h3>
              <p className="text-sm text-gray-600 mb-4">通过 AI 助手讨论并生成步骤计划，或手动创建任务</p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={handleCreateTask}
                  className="inline-flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  讨论任务
                </button>
               </div>
            </div>
          </div>
        )}


      </div>

      <AIChatWidget ref={chatRef} directory={project?.path} engineStatus={engineStatus} projectId={projectId} pageContext={pageContext} onPlanImported={refetch} focusedItem={focusedItem} onClearFocus={handleClearFocus} />
    </div>
  );
}
