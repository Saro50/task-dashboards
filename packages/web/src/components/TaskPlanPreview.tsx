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
 * 匹配规则：plan task 的 ref 与已有任务的 ID 精确匹配（ref 即真实 ID）。
 * - ref 匹配已有 ID + 内容相同 → unchanged
 * - ref 匹配已有 ID + 内容不同 → modified
 * - ref 无匹配 → new
 */
function computeDiff(planTasks: TaskPlanItem[], existingTasks: Task[]): DiffItem[] {
  const existingById = new Map(existingTasks.map((t) => [t.id, t]));
  return planTasks.map((pt) => {
    const existing = existingById.get(pt.ref);
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
function StatusDot({ status, applied }: { status: DiffStatus; applied: boolean }) {
  if (applied) return <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500" />;
  const color = status === 'new' ? 'bg-green-500' : status === 'modified' ? 'bg-amber-500' : 'bg-gray-300';
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

/** 状态标签 */
function StatusLabel({ status, applied }: { status: DiffStatus; applied: boolean }) {
  if (applied) return <span className="text-[10px] text-green-600 font-medium">已应用</span>;
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
  /** 已应用的 plan task ref 集合 */
  const [appliedRefs, setAppliedRefs] = useState<Set<string>>(new Set());
  /** 正在单条应用的 ref */
  const [applyingRef, setApplyingRef] = useState<string | null>(null);
  /** 正在批量应用 */
  const [batchApplying, setBatchApplying] = useState(false);

  /** 是否有已有任务（决定展示模式：导入 vs 更新） */
  const hasExisting = !!(existingTasks && existingTasks.length > 0);

  /** diff 结果 */
  const diffItems = useMemo(() => {
    if (!hasExisting) return null;
    return computeDiff(plan.tasks, existingTasks!);
  }, [plan.tasks, existingTasks, hasExisting]);

  /** 统计（排除已 applied） */
  const stats = useMemo(() => {
    if (!diffItems) return null;
    const newCount = diffItems.filter((d) => d.status === 'new' && !appliedRefs.has(d.planTask.ref)).length;
    const modifiedCount = diffItems.filter((d) => d.status === 'modified' && !appliedRefs.has(d.planTask.ref)).length;
    const unchangedCount = diffItems.filter((d) => d.status === 'unchanged').length;
    const appliedCount = appliedRefs.size;
    const totalChanges = diffItems.filter((d) => d.status !== 'unchanged').length;
    return { newCount, modifiedCount, unchangedCount, appliedCount, totalChanges, pendingChanges: newCount + modifiedCount };
  }, [diffItems, appliedRefs]);

  /**
   * 原有导入逻辑：当没有已有任务时使用。
   * 后端 importPlan 会校验 ref 必须为 cuid 格式，并用 ref 作为 Task.id。
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
   * 应用单条变更。
   * ref 即真实 ID：
   * - new: 用 ref 作为 Task.id 创建（CreateTaskInput.id）
   * - modified: ref 就是 existing.id，直接 update
   *
   * 注意：依赖中的新任务可能尚未创建，addDependency 会因 FK 约束失败，
   * 此处静默跳过（用户可通过批量应用一次性解决）。
   */
  const handleApplyOne = useCallback(async (item: DiffItem) => {
    if (!projectId || !topicId) {
      showToast('未关联项目或主题', 'error');
      return;
    }
    const ref = item.planTask.ref;
    setApplyingRef(ref);
    try {
      if (item.status === 'new') {
        /** 用预分配的 ref 作为 ID 创建任务 */
        const newTask = await taskApi.create(projectId, {
          id: ref,
          title: item.planTask.title,
          description: item.planTask.description,
        });
        await taskApi.update(newTask.id, { topicId });
        /** 处理依赖：ref 即目标 ID，若目标尚未创建则静默跳过 */
        for (const depId of item.planTask.dependencies ?? []) {
          try {
            await taskApi.addDependency(newTask.id, depId);
          } catch {
            log.info(S, 'handleApplyOne skip dep (target not created)', { ref, depId });
          }
        }
        log.info(S, 'handleApplyOne created', { ref, id: newTask.id });
      } else if (item.status === 'modified' && item.existing) {
        /** ref 就是 existing.id，直接更新 */
        await taskApi.update(item.existing.id, {
          title: item.planTask.title,
          description: item.planTask.description,
        });
        const oldDeps = item.existing.dependencies ?? [];
        const newDepIds = item.planTask.dependencies ?? [];
        const depsToAdd = newDepIds.filter((d) => !oldDeps.includes(d));
        const depsToRemove = oldDeps.filter((d) => !newDepIds.includes(d));
        for (const depId of depsToAdd) {
          try { await taskApi.addDependency(item.existing.id, depId); } catch { /* FK 约束，目标可能不存在 */ }
        }
        for (const depId of depsToRemove) await taskApi.removeDependency(item.existing.id, depId);
        log.info(S, 'handleApplyOne updated', { ref, id: item.existing.id, depsAdded: depsToAdd.length, depsRemoved: depsToRemove.length });
      }
      setAppliedRefs((prev) => new Set(prev).add(ref));
      showToast(`「${item.planTask.title}」已${item.status === 'new' ? '添加' : '更新'}`, 'success');
    } catch (err: any) {
      log.error(S, 'handleApplyOne error', err);
      showToast(err.message || '操作失败', 'error');
    } finally {
      setApplyingRef(null);
    }
  }, [projectId, topicId, showToast]);

  /**
   * 批量应用所有未应用的变更。
   * 先创建所有新任务（保证依赖目标存在），再统一处理依赖。
   */
  const handleBatchApply = useCallback(async () => {
    if (!projectId || !topicId || !diffItems || !stats) return;
    log.info(S, 'handleBatchApply', { projectId, topicId, pendingChanges: stats.pendingChanges });
    setBatchApplying(true);
    try {
      let updated = 0;
      let created = 0;

      /** 第一遍：创建/更新所有任务 */
      for (const item of diffItems) {
        if (item.status === 'unchanged' || appliedRefs.has(item.planTask.ref)) continue;
        if (item.status === 'new') {
          const newTask = await taskApi.create(projectId, {
            id: item.planTask.ref,
            title: item.planTask.title,
            description: item.planTask.description,
          });
          await taskApi.update(newTask.id, { topicId });
          created++;
        } else if (item.status === 'modified' && item.existing) {
          await taskApi.update(item.existing.id, {
            title: item.planTask.title,
            description: item.planTask.description,
          });
          updated++;
        }
        setAppliedRefs((prev) => new Set(prev).add(item.planTask.ref));
      }

      /** 第二遍：统一处理依赖 */
      for (const item of diffItems) {
        if (item.status === 'unchanged') continue;
        const taskId = item.planTask.ref; // ref = 真实 ID
        if (item.status === 'new') {
          for (const depId of item.planTask.dependencies ?? []) {
            await taskApi.addDependency(taskId, depId);
          }
        } else if (item.status === 'modified' && item.existing) {
          const oldDeps = item.existing.dependencies ?? [];
          const newDepIds = item.planTask.dependencies ?? [];
          for (const depId of newDepIds.filter((d) => !oldDeps.includes(d))) {
            await taskApi.addDependency(taskId, depId);
          }
          for (const depId of oldDeps.filter((d) => !newDepIds.includes(d))) {
            await taskApi.removeDependency(taskId, depId);
          }
        }
      }

      log.info(S, 'handleBatchApply done', { updated, created });
      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} 个任务已更新`);
      if (created > 0) parts.push(`${created} 个新任务已创建`);
      showToast(parts.join('，'), 'success');
      onPlanImported(plan.topic);
    } catch (err: any) {
      log.error(S, 'handleBatchApply error', err);
      showToast(err.message || '批量应用失败', 'error');
    } finally {
      setBatchApplying(false);
    }
  }, [projectId, topicId, diffItems, stats, appliedRefs, plan.topic, showToast, onPlanImported]);

  // ── 渲染 ──────────────────────────────────────────────────

  const importLabel = topicId ? '导入到当前主题' : '导入到当前项目';

  /** 是否进入 diff 更新模式（有已有任务 + 有 diff 结果 + 有任何变更或已应用） */
  const updateMode = hasExisting && diffItems !== null && stats !== null && (stats.totalChanges > 0 || stats.appliedCount > 0);
  /** diff 更新模式下是否还有未应用的变更 */
  const hasPending = stats ? stats.pendingChanges > 0 : false;

  // 卡片颜色
  const headerBg = updateMode ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200';
  const headerText = updateMode ? 'text-amber-700' : 'text-sky-700';
  const headerIcon = updateMode ? 'text-amber-500' : 'text-sky-500';
  const borderColor = updateMode ? 'border-amber-200' : 'border-sky-200';
  const cardBorder = updateMode ? 'border-amber-200' : 'border-sky-200';

  return (
    <div className={`rounded-lg border ${cardBorder} bg-sky-50/50 overflow-hidden my-2`}>
      <div className={`px-3 py-2 ${headerBg} border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${headerIcon} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className={`text-sm font-medium ${headerText}`}>{plan.topic}</span>
          <span className="text-[10px] text-gray-400">{plan.tasks.length} 个任务</span>
          {/* diff 统计 */}
          {updateMode && stats && (
            <div className="flex items-center gap-1.5 ml-auto">
              {stats.newCount > 0 && <span className="text-[10px] text-green-600 font-medium">+{stats.newCount} 新增</span>}
              {stats.modifiedCount > 0 && <span className="text-[10px] text-amber-600 font-medium">~{stats.modifiedCount} 修改</span>}
              {stats.appliedCount > 0 && <span className="text-[10px] text-green-500">✓{stats.appliedCount} 已应用</span>}
              {stats.unchangedCount > 0 && <span className="text-[10px] text-gray-400">{stats.unchangedCount} 未变更</span>}
            </div>
          )}
        </div>
        {plan.summary && (
          <p className={`text-xs mt-1 ${updateMode ? 'text-amber-600' : 'text-sky-600'}`}>{plan.summary}</p>
        )}
      </div>

      {/* 任务列表 */}
      <div className="px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto">
        {diffItems ? (
          // 更新模式：逐条显示 diff + 独立操作按钮
          diffItems.map((item) => {
            const ref = item.planTask.ref;
            const applied = appliedRefs.has(ref);
            const isApplying = applyingRef === ref;
            const canOperate = item.status !== 'unchanged' && !applied && !isApplying && !batchApplying;

            return (
              <div key={ref}>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={item.status} applied={applied} />
                  <span className={`text-xs truncate flex-1 ${
                    applied ? 'text-green-700' : item.status === 'unchanged' ? 'text-gray-400' : 'text-gray-700'
                  }`}>
                    {item.planTask.title}
                  </span>
                  <StatusLabel status={item.status} applied={applied} />
                  <DepBadge deps={item.planTask.dependencies || []} />
                  {/* 逐条操作按钮 */}
                  {canOperate && item.status === 'new' && (
                    <button
                      onClick={() => handleApplyOne(item)}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-500 hover:bg-green-600 text-white cursor-pointer transition-colors"
                    >
                      添加
                    </button>
                  )}
                  {canOperate && item.status === 'modified' && (
                    <button
                      onClick={() => handleApplyOne(item)}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white cursor-pointer transition-colors"
                    >
                      更新
                    </button>
                  )}
                  {isApplying && (
                    <svg className="w-3 h-3 animate-spin text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </div>
                {/* 修改态：显示标题 diff */}
                {item.status === 'modified' && item.existing && item.existing.title !== item.planTask.title && (
                  <div className="text-[10px] text-gray-400 pl-4">
                    <span className="line-through text-red-300">{item.existing.title}</span>
                    <span className="mx-1">→</span>
                    <span className="text-green-600">{item.planTask.title}</span>
                  </div>
                )}
                {/* 修改态：显示描述 diff */}
                {item.status === 'modified' && item.existing && (
                  <DescriptionDiff oldDesc={item.existing.description} newDesc={item.planTask.description} />
                )}
              </div>
            );
          })
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

      {/* 底部操作区 */}
      <div className={`px-3 py-2 border-t ${borderColor}`}>
        {/* 更新模式 + 还有未应用的变更 → 批量应用按钮 */}
        {updateMode && hasPending && stats ? (
          <button
            onClick={handleBatchApply}
            disabled={batchApplying || !projectId || !topicId}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white text-xs py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {batchApplying ? '批量应用中...' : `批量应用 ${stats.pendingChanges} 项变更`}
          </button>
        ) : updateMode && !hasPending ? (
          /* 更新模式 + 全部已应用 */
          <div className="flex items-center gap-1 text-xs text-green-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            全部已应用
          </div>
        ) : !updateMode && hasExisting && stats && stats.totalChanges === 0 ? (
          /* 有已有任务但无变更 */
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            无变更
          </div>
        ) : !hasExisting && imported ? (
          /* 无已有任务 + 已导入 */
          <div className="flex items-center gap-1 text-xs text-green-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            已导入
          </div>
        ) : (
          /* 纯导入模式 */
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
