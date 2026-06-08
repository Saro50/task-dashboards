import { useState, useCallback, useMemo } from 'react';
import type { TaskPlan, Task, TaskPlanItem } from '@/types/task';
import { taskApi } from '@/api/task';
import { useToast } from './Toast';
import { log } from '@/utils/log';

const S = 'TaskPlanPreview';

/** 单个 plan task 与已有任务的 diff 状态 */
type DiffStatus = 'new' | 'modified' | 'unchanged';

interface DiffItem {
  planTask: TaskPlanItem;
  status: DiffStatus;
  /** 关联的已有任务（modified / unchanged 时有值） */
  existing?: Task;
}

interface Props {
  plan: TaskPlan;
  projectId?: string;
  topicId?: string;
  chatSessionId?: string;
  imported: boolean;
  onPlanImported: (topicName: string) => void;
  /** 当前主题已有任务，存在时进入 diff 更新模式 */
  existingTasks?: Task[];
}

/**
 * 计算计划任务与已有任务的 diff。
 *
 * 匹配规则：plan task 的 ref 与已有任务的 ID 精确匹配。
 * - ref 匹配 + 内容相同 → unchanged
 * - ref 匹配 + 内容不同 → modified
 * - ref 无匹配 → new
 */
function computeDiff(planTasks: TaskPlanItem[], existingTasks: Task[]): DiffItem[] {
  const existingMap = new Map(existingTasks.map((t) => [t.id, t]));
  return planTasks.map((pt) => {
    const existing = existingMap.get(pt.ref);
    if (!existing) {
      return { planTask: pt, status: 'new' as const };
    }
    const titleChanged = existing.title !== pt.title;
    const descChanged = existing.description !== pt.description;
    /** 依赖变更：对比排序后的 ID 列表 */
    const depsChanged = JSON.stringify([...existing.dependencies].sort()) !== JSON.stringify([...pt.dependencies].sort());
    if (titleChanged || descChanged || depsChanged) {
      return { planTask: pt, status: 'modified' as const, existing };
    }
    return { planTask: pt, status: 'unchanged' as const, existing };
  });
}

/** 依赖数量标记 */
function DepBadge({ deps }: { deps: string[] }) {
  if (deps.length === 0) return null;
  return (
    <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
      {deps.length}
    </span>
  );
}

/** 状态圆点 */
function StatusDot({ status }: { status: DiffStatus }) {
  const color = status === 'new' ? 'bg-green-500' : status === 'modified' ? 'bg-amber-500' : 'bg-gray-300';
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

/** 状态标签 */
function StatusLabel({ status }: { status: DiffStatus }) {
  if (status === 'new') return <span className="text-[10px] text-green-600 font-medium">新增</span>;
  if (status === 'modified') return <span className="text-[10px] text-amber-600 font-medium">修改</span>;
  return null;
}

/** 描述 diff（旧 → 新） */
function DescriptionDiff({ oldDesc, newDesc }: { oldDesc: string; newDesc: string }) {
  if (oldDesc === newDesc) return null;
  return (
    <div className="text-[10px] text-gray-400 mt-0.5 pl-4">
      {oldDesc && <span className="line-through text-red-300 mr-1">{oldDesc.length > 40 ? oldDesc.slice(0, 40) + '...' : oldDesc}</span>}
      <span className="text-green-600">{newDesc.length > 40 ? newDesc.slice(0, 40) + '...' : newDesc}</span>
    </div>
  );
}

export default function TaskPlanPreview({ plan, projectId, topicId, chatSessionId, imported, onPlanImported, existingTasks }: Props) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState(false);

  /** 是否有已有任务（决定展示模式：导入 vs 更新） */
  const hasExisting = !!(existingTasks && existingTasks.length > 0);

  /** diff 结果 */
  const diffItems = useMemo(() => {
    if (!hasExisting) return null;
    return computeDiff(plan.tasks, existingTasks!);
  }, [plan.tasks, existingTasks, hasExisting]);

  /** 统计 */
  const stats = useMemo(() => {
    if (!diffItems) return null;
    const newCount = diffItems.filter((d) => d.status === 'new').length;
    const modifiedCount = diffItems.filter((d) => d.status === 'modified').length;
    const unchangedCount = diffItems.filter((d) => d.status === 'unchanged').length;
    return { newCount, modifiedCount, unchangedCount, totalChanges: newCount + modifiedCount };
  }, [diffItems]);

  /**
   * 原有导入逻辑：当没有已有任务时使用。
   * 对上游（onPlanImported）无影响，仍然通过回调通知刷新。
   */
  const handleImport = useCallback(async () => {
    if (!projectId) {
      showToast('未关联项目，无法导入', 'error');
      return;
    }
    log.info(S, 'handleImport', { projectId, topicId, chatSessionId, topic: plan.topic, taskCount: plan.tasks.length });
    setImporting(true);
    try {
      const result = await taskApi.importPlan(projectId, plan.topic, plan.summary, plan.tasks, {
        chatSessionId,
        topicId,
      });
      log.info(S, 'handleImport response', result);
      showToast(`成功导入 ${result.imported} 个任务，${result.dependencies} 个依赖关系`, 'success');
      onPlanImported(plan.topic);
    } catch (err: any) {
      log.error(S, 'handleImport error', err);
      if (err.message?.includes('already imported') || err.message?.includes('409')) {
        showToast('该计划已导入过', 'info');
        onPlanImported(plan.topic);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setImporting(false);
    }
  }, [projectId, topicId, chatSessionId, plan, showToast, onPlanImported]);

  /**
   * 更新模式：逐项应用变更（修改已有 + 创建新增 + 处理依赖）。
   *
   * 执行顺序：
   * 1. 更新已有任务（title / description）
   * 2. 创建新任务，收集 ref → 新 ID 映射
   * 3. 处理所有任务的依赖变更（addDependency / removeDependency）
   */
  const handleApplyChanges = useCallback(async () => {
    if (!projectId || !topicId || !diffItems || !stats) return;
    log.info(S, 'handleApplyChanges', { projectId, topicId, stats });
    setImporting(true);
    try {
      const refToId = new Map<string, string>();
      // 先注册已有任务的 ID 映射
      for (const item of diffItems) {
        if (item.existing) {
          refToId.set(item.planTask.ref, item.existing.id);
        }
      }

      let updated = 0;
      let created = 0;
      let depChanges = 0;

      // Step 1: 更新已有任务
      for (const item of diffItems) {
        if (item.status === 'modified' && item.existing) {
          await taskApi.update(item.existing.id, {
            title: item.planTask.title,
            description: item.planTask.description,
          });
          updated++;
        }
      }

      // Step 2: 创建新任务
      for (const item of diffItems) {
        if (item.status === 'new') {
          const newTask = await taskApi.create(projectId, {
            title: item.planTask.title,
            description: item.planTask.description,
          });
          refToId.set(item.planTask.ref, newTask.id);
          created++;
        }
      }

      // Step 3: 处理依赖变更
      for (const item of diffItems) {
        if (item.status === 'unchanged') continue;
        const taskId = refToId.get(item.planTask.ref);
        if (!taskId) continue;

        const oldDeps = item.existing?.dependencies ?? [];
        const newDepRefs = item.planTask.dependencies ?? [];

        // 将 dep ref 解析为实际 ID
        const newDepIds = newDepRefs.map((ref) => refToId.get(ref)).filter(Boolean) as string[];
        const depsToAdd = newDepIds.filter((d) => !oldDeps.includes(d));
        const depsToRemove = oldDeps.filter((d) => !newDepIds.includes(d));

        for (const depId of depsToAdd) {
          await taskApi.addDependency(taskId, depId);
          depChanges++;
        }
        for (const depId of depsToRemove) {
          await taskApi.removeDependency(taskId, depId);
          depChanges++;
        }
      }

      log.info(S, 'handleApplyChanges done', { updated, created, depChanges });
      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} 个任务已更新`);
      if (created > 0) parts.push(`${created} 个新任务已创建`);
      if (depChanges > 0) parts.push(`${depChanges} 个依赖关系已调整`);
      showToast(parts.join('，'), 'success');
      onPlanImported(plan.topic);
    } catch (err: any) {
      log.error(S, 'handleApplyChanges error', err);
      showToast(err.message || '应用变更失败', 'error');
    } finally {
      setImporting(false);
    }
  }, [projectId, topicId, diffItems, stats, plan.topic, showToast, onPlanImported]);

  // ── 渲染 ──────────────────────────────────────────────────

  const importLabel = topicId ? '导入到当前主题' : '导入到当前项目';

  // 更新模式：标题栏使用 diff 统计色
  const headerBg = hasExisting && stats && stats.totalChanges > 0 ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200';
  const headerText = hasExisting && stats && stats.totalChanges > 0 ? 'text-amber-700' : 'text-sky-700';
  const headerIcon = hasExisting && stats && stats.totalChanges > 0 ? 'text-amber-500' : 'text-sky-500';
  const borderColor = hasExisting && stats && stats.totalChanges > 0 ? 'border-amber-200' : 'border-sky-200';
  const cardBorder = hasExisting && stats && stats.totalChanges > 0 ? 'border-amber-200' : 'border-sky-200';

  return (
    <div className={`rounded-lg border ${cardBorder} bg-sky-50/50 overflow-hidden my-2`}>
      <div className={`px-3 py-2 ${headerBg} border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${headerIcon} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className={`text-sm font-medium ${headerText}`}>{plan.topic}</span>
          <span className="text-[10px] text-gray-400">{plan.tasks.length} 个任务</span>
          {/* 更新模式下显示 diff 统计 */}
          {stats && stats.totalChanges > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              {stats.newCount > 0 && <span className="text-[10px] text-green-600 font-medium">+{stats.newCount} 新增</span>}
              {stats.modifiedCount > 0 && <span className="text-[10px] text-amber-600 font-medium">~{stats.modifiedCount} 修改</span>}
              {stats.unchangedCount > 0 && <span className="text-[10px] text-gray-400">{stats.unchangedCount} 未变更</span>}
            </div>
          )}
        </div>
        {plan.summary && (
          <p className={`text-xs mt-1 ${hasExisting ? 'text-amber-600' : 'text-sky-600'}`}>{plan.summary}</p>
        )}
      </div>

      {/* 任务列表 */}
      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
        {diffItems ? (
          // 更新模式：显示 diff 标记
          diffItems.map((item) => (
            <div key={item.planTask.ref}>
              <div className="flex items-center gap-2">
                <StatusDot status={item.status} />
                <span className={`text-xs truncate flex-1 ${
                  item.status === 'unchanged' ? 'text-gray-400' : 'text-gray-700'
                }`}>
                  {item.planTask.title}
                </span>
                <StatusLabel status={item.status} />
                <DepBadge deps={item.planTask.dependencies || []} />
              </div>
              {/* 修改态：显示描述 diff */}
              {item.status === 'modified' && item.existing && (
                <DescriptionDiff oldDesc={item.existing.description} newDesc={item.planTask.description} />
              )}
              {/* 标题变更：旧标题被划线 */}
              {item.status === 'modified' && item.existing && item.existing.title !== item.planTask.title && (
                <div className="text-[10px] text-gray-400 pl-4">
                  <span className="line-through text-red-300">{item.existing.title}</span>
                  <span className="mx-1">→</span>
                  <span className="text-green-600">{item.planTask.title}</span>
                </div>
              )}
            </div>
          ))
        ) : (
          // 导入模式：原始渲染
          plan.tasks.map((task) => (
            <div key={task.ref} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
              <span className="text-xs text-gray-700 truncate flex-1">{task.title}</span>
              <DepBadge deps={task.dependencies || []} />
            </div>
          ))
        )}
      </div>

      {/* 底部操作 */}
      <div className={`px-3 py-2 border-t ${borderColor}`}>
        {imported ? (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            已导入
          </div>
        ) : hasExisting && stats && stats.totalChanges > 0 ? (
          // 更新模式：显示 "应用变更" 按钮
          <button
            onClick={handleApplyChanges}
            disabled={importing || !projectId || !topicId}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white text-xs py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {importing ? '应用中...' : `应用 ${stats.totalChanges} 项变更`}
          </button>
        ) : hasExisting && stats && stats.totalChanges === 0 ? (
          // 全部未变更
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            无变更
          </div>
        ) : (
          // 导入模式：原有导入按钮
          <button
            onClick={handleImport}
            disabled={importing || !projectId}
            className="w-full bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-xs py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {importing ? '导入中...' : importLabel}
          </button>
        )}
      </div>
    </div>
  );
}
