import { useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type MiniMapNodeProps } from '@xyflow/react';
import type { EngineStatus } from '@/components/Layout';
import { taskApi } from '@/api/task';
import { useTopics } from '@/hooks/useTopics';
import { useToast } from '@/components/Toast';
import TopicNode from '@/components/TopicNode';
import TaskNode from '@/components/TaskNode';
import TaskEdge from '@/components/TaskEdge';
import AIChatWidget from '@/components/AIChatWidget';
import type { AIChatWidgetHandle } from '@/components/AIChatWidget';
import { applyDagreLayout } from '@/utils/layout';
import { log } from '@/utils/log';

const S = 'TopicGraphPage';

interface Props {
  engineStatus: EngineStatus;
}

const topicNodeTypes = { topic: TopicNode, task: TaskNode };
const edgeTypes = { task: TaskEdge };

const topicStatusColor: Record<string, string> = {
  PENDING: '#9ca3af',
  IN_PROGRESS: '#0ea5e9',
  COMPLETED: '#22c55e',
  BLOCKED: '#ef4444',
};

const taskStatusColor: Record<string, string> = {
  PENDING: '#d1d5db',
  IN_PROGRESS: '#7dd3fc',
  COMPLETED: '#86efac',
  BLOCKED: '#fca5a5',
};

const miniMapNodeColor = (node: Node) => {
  if (node.type === 'topic') return topicStatusColor[(node.data as any).aggregatedStatus] || '#94a3b8';
  if (node.type === 'task') return taskStatusColor[(node.data as any).status] || '#d1d5db';
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

export default function TopicGraphPage({ engineStatus }: Props) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { topics, dependencies, orphanTasks, loading, error, refetch } = useTopics(projectId);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const chatRef = useRef<AIChatWidgetHandle>(null);

  const { nodes: flowNodes, edges: baseEdges } = useMemo(() => {
    const nodes: Node[] = [];

    for (const topic of topics) {
      nodes.push({
        id: topic.id,
        type: 'topic',
        position: { x: 0, y: 0 },
        data: {
          name: topic.name,
          summary: topic.summary,
          taskCount: topic.taskCount,
          completedCount: topic.completedCount,
          aggregatedStatus: topic.aggregatedStatus,
        },
      });
    }

    for (const task of orphanTasks) {
      nodes.push({
        id: task.id,
        type: 'task',
        position: { x: 0, y: 0 },
        data: {
          title: task.title,
          status: task.status,
          description: task.description,
          depCount: task.dependencies.length,
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
  }, [topics, dependencies, orphanTasks, refetch]);

  const flowEdges = useMemo(
    () => baseEdges.map((e) => ({ ...e, data: { ...e.data, hovered: e.id === hoveredEdgeId } })),
    [baseEdges, hoveredEdgeId]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    log.info(S, 'onNodeClick', { nodeId: node.id, type: node.type });
    if (node.type === 'topic') {
      navigate(`/project/${projectId}/topic/${node.id}`);
    }
  }, [navigate, projectId]);

  const handleCreateTask = useCallback(() => {
    log.info(S, 'handleCreateTask');
    chatRef.current?.openWithMessage('请帮我创建一组任务计划，用于实现一个功能模块');
  }, []);

  const handleDebugImport = useCallback(async () => {
    log.info(S, 'handleDebugImport', { projectId });
    try {
      const resp = await taskApi.importPlan(projectId!, '用户认证模块', '实现完整的用户注册、登录、鉴权功能', [
        { ref: 'task-1', title: '设计用户数据模型', description: '定义 User schema，包含邮箱、密码哈希、角色等字段', dependencies: [] },
        { ref: 'task-2', title: '实现注册接口', description: 'POST /api/auth/register，含参数校验和密码加密', dependencies: ['task-1'] },
        { ref: 'task-3', title: '实现登录接口', description: 'POST /api/auth/login，返回 JWT token', dependencies: ['task-1'] },
        { ref: 'task-4', title: '实现 JWT 鉴权中间件', description: '校验 token，注入 user context', dependencies: ['task-3'] },
        { ref: 'task-5', title: '编写集成测试', description: '覆盖注册、登录、鉴权完整流程', dependencies: ['task-2', 'task-3', 'task-4'] },
      ]);
      log.info(S, 'handleDebugImport response', resp);
      showToast('已导入 5 个模拟任务', 'success');
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDebugImport error', err);
      showToast(err.message, 'error');
    }
  }, [projectId, showToast, refetch]);

  const handleDebugImport2 = useCallback(async () => {
    log.info(S, 'handleDebugImport2', { projectId });
    try {
      const resp = await taskApi.importPlan(projectId!, '数据库优化', '优化查询性能和索引策略', [
        { ref: 'task-1', title: '分析慢查询日志', description: '收集并分析 TOP 20 慢查询', dependencies: [] },
        { ref: 'task-2', title: '添加数据库索引', description: '针对高频查询添加复合索引', dependencies: ['task-1'] },
        { ref: 'task-3', title: '查询性能基准测试', description: '对比优化前后查询性能', dependencies: ['task-2'] },
      ]);
      log.info(S, 'handleDebugImport2 response', resp);
      showToast('已导入 3 个模拟任务（第二个主题）', 'success');
      refetch();
    } catch (err: any) {
      log.error(S, 'handleDebugImport2 error', err);
      showToast(err.message, 'error');
    }
  }, [projectId, showToast, refetch]);

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
          <span className="font-medium text-gray-800">任务主题</span>
          <span className="text-xs text-gray-400 ml-1">{topics.length} 个主题</span>
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
          nodeTypes={topicNodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
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

        {topics.length === 0 && orphanTasks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">暂无任务</h3>
              <p className="text-sm text-gray-600 mb-4">通过 AI 助手生成任务计划，或手动创建任务</p>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={handleCreateTask}
                  className="inline-flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  新建任务
                </button>
                <button
                  onClick={handleDebugImport}
                  className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer border border-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                  调试导入
                </button>
              </div>
            </div>
          </div>
        )}

        {topics.length > 0 && (
          <div className="absolute bottom-14 right-4 flex flex-col gap-2">
            <button
              onClick={handleDebugImport2}
              className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer border border-gray-200 shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
              追加第二个主题
            </button>
          </div>
        )}
      </div>

      <AIChatWidget ref={chatRef} engineStatus={engineStatus} />
    </div>
  );
}
