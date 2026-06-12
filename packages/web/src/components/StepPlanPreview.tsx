import { useState, useCallback, useMemo } from 'react';
import type { StepPlan, Step, StepPlanItem } from '@/types/step';
import { stepApi } from '@/api/step';
import { taskApi } from '@/api/task';
import { useToast } from './Toast';
import { log } from '@/utils/log';

const S = 'StepPlanPreview';

type DiffStatus = 'new' | 'modified' | 'unchanged' | 'deleted';

/** plan 步骤与已有步骤的 diff */
interface DiffItem {
  planStep: StepPlanItem;
  status: DiffStatus;
  existing?: Step;
}

/** 已有步骤在 plan 中不存在（应删除） */
interface DeletedDiffItem {
  existing: Step;
  status: 'deleted';
}

/** computeDiff 返回的联合结果 */
type DiffResult = DiffItem | DeletedDiffItem;

/** 类型守卫：是否为 deleted 类型（无 planStep） */
function isDeleted(item: DiffResult): item is DeletedDiffItem {
  return item.status === 'deleted';
}

interface Props {
  plan: StepPlan;
  projectId?: string;
  taskId?: string;
  chatSessionId?: string;
  imported: boolean;
  onPlanImported: (taskName: string) => void;
  /** 当前任务已有步骤，存在时进入 diff 更新模式 */
  existingSteps?: Step[];
  /**
   * 当前任务名称，用于判断计划是否属于当前任务。
   * 若提供且 plan.task !== currentTaskName，面板渲染为灰色只读状态（不显示操作按钮）。
   * 若不提供则保持原有行为（向后兼容）。
   */
  currentTaskName?: string;
}

/**
 * 计算计划步骤与已有步骤的 diff。
 *
 * 匹配规则：plan step 的 ref 与已有步骤的 ID 精确匹配（ref 即真实 ID）。
 * - ref 匹配已有 ID + 内容相同 → unchanged
 * - ref 匹配已有 ID + 内容不同 → modified
 * - ref 无匹配 → new
 * - 已有 ID 不在任何 plan ref 中 → deleted（应删除）
 */
function computeDiff(planSteps: StepPlanItem[], existingSteps: Step[]): DiffResult[] {
  const existingById = new Map(existingSteps.map((t) => [t.id, t]));
  const planRefs = new Set(planSteps.map((pt) => pt.ref));

  const planItems: DiffItem[] = planSteps.map((pt) => {
    const existing = existingById.get(pt.ref);
    if (!existing) {
      return { planStep: pt, status: 'new' as const };
    }
    const titleChanged = existing.title !== pt.title;
    const descChanged = existing.description !== pt.description;
    /** 依赖变更：对比排序后的 ID 列表 */
    const depsChanged = JSON.stringify([...existing.dependencies].sort()) !== JSON.stringify([...pt.dependencies].sort());
    if (titleChanged || descChanged || depsChanged) {
      return { planStep: pt, status: 'modified' as const, existing };
    }
    return { planStep: pt, status: 'unchanged' as const, existing };
  });

  // 检测"应删除"：已有步骤不在 plan ref 集合中
  const deletedItems: DeletedDiffItem[] = existingSteps
    .filter((s) => !planRefs.has(s.id))
    .map((s) => ({ existing: s, status: 'deleted' as const }));

  return [...planItems, ...deletedItems];
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
  const color = status === 'new' ? 'bg-green-500' : status === 'modified' ? 'bg-amber-500' : status === 'deleted' ? 'bg-red-500' : 'bg-gray-300';
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

/** 状态标签 */
function StatusLabel({ status, applied }: { status: DiffStatus; applied: boolean }) {
  if (applied) return <span className="text-[10px] text-green-600 font-medium">已应用</span>;
  if (status === 'new') return <span className="text-[10px] text-green-600 font-medium">新增</span>;
  if (status === 'modified') return <span className="text-[10px] text-amber-600 font-medium">修改</span>;
  if (status === 'deleted') return <span className="text-[10px] text-red-600 font-medium">删除</span>;
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

export default function StepPlanPreview({ plan, projectId, taskId, chatSessionId, imported, onPlanImported, existingSteps, currentTaskName }: Props) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState(false);
  /** 已应用的 plan step ref 集合 */
  const [appliedRefs, setAppliedRefs] = useState<Set<string>>(new Set());
  /** 正在单条应用的 ref */
  const [applyingRef, setApplyingRef] = useState<string | null>(null);
  /** 正在批量应用 */
  const [batchApplying, setBatchApplying] = useState(false);

  /** 是否有已有步骤（决定展示模式：导入 vs 更新） */
  const hasExisting = !!(existingSteps && existingSteps.length > 0);

  /**
   * 是否为当前任务的计划面板。
   * currentTaskName 不传时默认为 true（向后兼容）；
   * 传入时需要 plan.task 与之精确匹配才视为当前任务。
   */
  const isCurrentTask = !currentTaskName || plan.task === currentTaskName;

  /** diff 结果 */
  const diffItems = useMemo(() => {
    if (!hasExisting) return null;
    return computeDiff(plan.steps, existingSteps!);
  }, [plan.steps, existingSteps, hasExisting]);

  /** 统计（排除已 applied） */
  const stats = useMemo(() => {
    if (!diffItems) return null;
    const newCount = diffItems.filter((d) => !isDeleted(d) && d.status === 'new' && !appliedRefs.has(d.planStep.ref)).length;
    const modifiedCount = diffItems.filter((d) => !isDeleted(d) && d.status === 'modified' && !appliedRefs.has(d.planStep.ref)).length;
    const deletedCount = diffItems.filter((d) => isDeleted(d) && !appliedRefs.has(d.existing.id)).length;
    const unchangedCount = diffItems.filter((d) => d.status === 'unchanged').length;
    const appliedCount = appliedRefs.size;
    const totalChanges = diffItems.filter((d) => d.status !== 'unchanged').length;
    const pendingChanges = newCount + modifiedCount + deletedCount;
    return { newCount, modifiedCount, deletedCount, unchangedCount, appliedCount, totalChanges, pendingChanges };
  }, [diffItems, appliedRefs]);

  /**
   * 原有导入逻辑：当没有已有步骤时使用。
   * 后端 importPlan 会校验 ref 必须为 cuid 格式，并用 ref 作为 Step.id。
   */
  const handleImport = useCallback(async () => {
    if (!projectId) {
      showToast('未关联项目，无法导入', 'error');
      return;
    }
    log.info(S, 'handleImport', { projectId, taskId, chatSessionId, task: plan.task, stepCount: plan.steps.length });
    setImporting(true);
    try {
      const result = await stepApi.importPlan(projectId, plan.task, plan.summary, plan.steps, {
        chatSessionId,
        taskId,
      });
      log.info(S, 'handleImport response', result);
      showToast(`成功导入 ${result.imported} 个步骤，${result.dependencies} 个依赖关系`, 'success');
      onPlanImported(plan.task);
    } catch (err: any) {
      log.error(S, 'handleImport error', err);
      if (err.message?.includes('already imported') || err.message?.includes('409')) {
        showToast('该计划已导入过', 'info');
        onPlanImported(plan.task);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setImporting(false);
    }
  }, [projectId, taskId, chatSessionId, plan, showToast, onPlanImported]);

  /**
   * 应用单条变更。
   * ref 即真实 ID：
   * - new: 用 ref 作为 Step.id 创建（CreateStepInput.id）
   * - modified: ref 就是 existing.id，直接 update，同时重置 status 为 PENDING
   * - deleted: 删除已有步骤
   *
   * 注意：依赖中的新步骤可能尚未创建，addDependency 会因 FK 约束失败，
   * 此处静默跳过（用户可通过批量应用一次性解决）。
   */
  const handleApplyOne = useCallback(async (item: DiffResult) => {
    if (!projectId || !taskId) {
      showToast('未关联项目或任务', 'error');
      return;
    }
    const ref = isDeleted(item) ? item.existing.id : item.planStep.ref;
    setApplyingRef(ref);
    try {
      if (isDeleted(item)) {
        /** 删除不在 plan 中的步骤 */
        await stepApi.remove(item.existing.id);
        log.info(S, 'handleApplyOne deleted', { ref, id: item.existing.id });
      } else if (item.status === 'new') {
        /** 用预分配的 ref 作为 ID 创建步骤 */
        const newStep = await stepApi.create(projectId, {
          id: ref,
          title: item.planStep.title,
          description: item.planStep.description,
        });
        await stepApi.update(newStep.id, { taskId });
        /** 处理依赖：ref 即目标 ID，若目标尚未创建则静默跳过 */
        for (const depId of item.planStep.dependencies ?? []) {
          try {
            await stepApi.addDependency(newStep.id, depId);
          } catch {
            log.info(S, 'handleApplyOne skip dep (target not created)', { ref, depId });
          }
        }
        log.info(S, 'handleApplyOne created', { ref, id: newStep.id });
      } else if (item.status === 'modified' && item.existing) {
        /** ref 就是 existing.id，直接更新 + 重置状态为 PENDING */
        await stepApi.update(item.existing.id, {
          title: item.planStep.title,
          description: item.planStep.description,
          status: 'PENDING',
        });
        const oldDeps = item.existing.dependencies ?? [];
        const newDepIds = item.planStep.dependencies ?? [];
        const depsToAdd = newDepIds.filter((d) => !oldDeps.includes(d));
        const depsToRemove = oldDeps.filter((d) => !newDepIds.includes(d));
        for (const depId of depsToAdd) {
          try { await stepApi.addDependency(item.existing.id, depId); } catch { /* FK 约束，目标可能不存在 */ }
        }
        for (const depId of depsToRemove) await stepApi.removeDependency(item.existing.id, depId);
        log.info(S, 'handleApplyOne updated', { ref, id: item.existing.id, depsAdded: depsToAdd.length, depsRemoved: depsToRemove.length });
      }
      setAppliedRefs((prev) => new Set(prev).add(ref));
      const title = isDeleted(item) ? item.existing.title : item.planStep.title;
      const actionLabel = isDeleted(item) ? '已删除' : item.status === 'new' ? '已添加' : '已更新';
      showToast(`「${title}」${actionLabel}`, 'success');
    } catch (err: any) {
      log.error(S, 'handleApplyOne error', err);
      showToast(err.message || '操作失败', 'error');
    } finally {
      setApplyingRef(null);
    }
  }, [projectId, taskId, showToast]);
  /**
   * 批量应用所有未应用的变更。
   * 顺序：先删除 → 再创建/更新所有步骤 → 最后统一处理依赖。
   * 如果 plan 的 task 名称或摘要与当前值不同，同步更新任务信息。
   */
  const handleBatchApply = useCallback(async () => {
    if (!projectId || !taskId || !diffItems || !stats) return;
    log.info(S, 'handleBatchApply', { projectId, taskId, pendingChanges: stats.pendingChanges });
    setBatchApplying(true);
    try {
      let updated = 0;
      let created = 0;
      let deleted = 0;

      /** 第一遍：删除不在 plan 中的步骤 */
      for (const item of diffItems) {
        if (!isDeleted(item) || appliedRefs.has(item.existing.id)) continue;
        await stepApi.remove(item.existing.id);
        setAppliedRefs((prev) => new Set(prev).add(item.existing.id));
        deleted++;
      }

      /** 第二遍：创建/更新所有步骤 */
      for (const item of diffItems) {
        if (isDeleted(item) || item.status === 'unchanged') continue;
        if (appliedRefs.has(item.planStep.ref)) continue;
        if (item.status === 'new') {
          const newStep = await stepApi.create(projectId, {
            id: item.planStep.ref,
            title: item.planStep.title,
            description: item.planStep.description,
          });
          await stepApi.update(newStep.id, { taskId });
          created++;
        } else if (item.status === 'modified' && item.existing) {
          await stepApi.update(item.existing.id, {
            title: item.planStep.title,
            description: item.planStep.description,
            status: 'PENDING',
          });
          updated++;
        }
        setAppliedRefs((prev) => new Set(prev).add(item.planStep.ref));
      }

      /** 第三遍：统一处理依赖（排除已删除步骤） */
      for (const item of diffItems) {
        if (isDeleted(item) || item.status === 'unchanged') continue;
        const stepId = item.planStep.ref; // ref = 真实 ID
        if (item.status === 'new') {
          for (const depId of item.planStep.dependencies ?? []) {
            await stepApi.addDependency(stepId, depId);
          }
        } else if (item.status === 'modified' && item.existing) {
          const oldDeps = item.existing.dependencies ?? [];
          const newDepIds = item.planStep.dependencies ?? [];
          for (const depId of newDepIds.filter((d) => !oldDeps.includes(d))) {
            await stepApi.addDependency(stepId, depId);
          }
          for (const depId of oldDeps.filter((d) => !newDepIds.includes(d))) {
            await stepApi.removeDependency(stepId, depId);
          }
        }
      }

      /** 第四遍：同步任务名称/摘要（如有变更） */
      if (currentTaskName && (plan.task !== currentTaskName || plan.summary !== undefined)) {
        try {
          await taskApi.update(taskId, { name: plan.task, summary: plan.summary });
          log.info(S, 'handleBatchApply updated task info', { taskId, name: plan.task });
        } catch (err: any) {
          log.warn(S, 'handleBatchApply task update failed (non-blocking)', { error: err.message });
        }
      }

      log.info(S, 'handleBatchApply done', { updated, created, deleted });
      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} 个步骤已更新`);
      if (created > 0) parts.push(`${created} 个新步骤已创建`);
      if (deleted > 0) parts.push(`${deleted} 个步骤已删除`);
      showToast(parts.join('，'), 'success');
      onPlanImported(plan.task);
    } catch (err: any) {
      log.error(S, 'handleBatchApply error', err);
      showToast(err.message || '批量应用失败', 'error');
    } finally {
      setBatchApplying(false);
    }
  }, [projectId, taskId, diffItems, stats, appliedRefs, plan.task, plan.summary, currentTaskName, showToast, onPlanImported]);

  // ── 渲染 ──────────────────────────────────────────────────

  const importLabel = taskId ? '导入到当前任务' : '导入到当前项目';

  /** 是否进入 diff 更新模式（有已有步骤 + 有 diff 结果 + 有任何变更或已应用） */
  const updateMode = hasExisting && diffItems !== null && stats !== null && (stats.totalChanges > 0 || stats.appliedCount > 0);
  /** diff 更新模式下是否还有未应用的变更 */
  const hasPending = stats ? stats.pendingChanges > 0 : false;

  // 卡片颜色
  const headerBg = isCurrentTask
    ? (updateMode ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200')
    : 'bg-gray-100 border-gray-200';
  const headerText = isCurrentTask
    ? (updateMode ? 'text-amber-700' : 'text-sky-700')
    : 'text-gray-400';
  const headerIcon = isCurrentTask
    ? (updateMode ? 'text-amber-500' : 'text-sky-500')
    : 'text-gray-300';
  const borderColor = isCurrentTask
    ? (updateMode ? 'border-amber-200' : 'border-sky-200')
    : 'border-gray-200';
  const cardBorder = isCurrentTask
    ? (updateMode ? 'border-amber-200' : 'border-sky-200')
    : 'border-gray-200';

  return (
    <div className={`rounded-lg border ${cardBorder} ${isCurrentTask ? 'bg-sky-50/50' : 'bg-gray-50/50 opacity-70'} overflow-hidden my-2`}>
      <div className={`px-3 py-2 ${headerBg} border-b ${borderColor}`}>
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${headerIcon} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className={`text-sm font-medium ${headerText}`}>{plan.task}</span>
          <span className="text-[10px] text-gray-400">{plan.steps.length} 个步骤</span>
          {/* 非当前任务标记 */}
          {!isCurrentTask && (
            <span className="text-[10px] text-gray-400 ml-1 flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              只读
            </span>
          )}
          {/* diff 统计（仅当前任务） */}
          {isCurrentTask && updateMode && stats && (
            <div className="flex items-center gap-1.5 ml-auto">
              {stats.newCount > 0 && <span className="text-[10px] text-green-600 font-medium">+{stats.newCount} 新增</span>}
              {stats.modifiedCount > 0 && <span className="text-[10px] text-amber-600 font-medium">~{stats.modifiedCount} 修改</span>}
              {stats.deletedCount > 0 && <span className="text-[10px] text-red-600 font-medium">-{stats.deletedCount} 删除</span>}
              {stats.appliedCount > 0 && <span className="text-[10px] text-green-500">✓{stats.appliedCount} 已应用</span>}
              {stats.unchangedCount > 0 && <span className="text-[10px] text-gray-400">{stats.unchangedCount} 未变更</span>}
            </div>
          )}
        </div>
        {plan.summary && (
          <p className={`text-xs mt-1 ${isCurrentTask ? (updateMode ? 'text-amber-600' : 'text-sky-600') : 'text-gray-400'}`}>{plan.summary}</p>
        )}
      </div>

      {/* 步骤列表 */}
      <div className="px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto">
        {diffItems && isCurrentTask ? (
          // 更新模式：逐条显示 diff + 独立操作按钮（仅当前任务）
          diffItems.map((item) => {
            // deleted 类型没有 planStep，用 existing.id 作为 key
            const ref = isDeleted(item) ? item.existing.id : item.planStep.ref;
            const applied = appliedRefs.has(ref);
            const isApplying = applyingRef === ref;
            const canOperate = item.status !== 'unchanged' && !applied && !isApplying && !batchApplying;
            const title = isDeleted(item) ? item.existing.title : item.planStep.title;

            return (
              <div key={ref} className={isDeleted(item) && applied ? 'opacity-40' : ''}>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={item.status} applied={applied} />
                  <span className={`text-xs truncate flex-1 ${
                    applied ? (isDeleted(item) ? 'text-red-400 line-through' : 'text-green-700')
                      : isDeleted(item) ? 'text-red-500'
                      : item.status === 'unchanged' ? 'text-gray-400' : 'text-gray-700'
                  }`}>
                    {title}
                  </span>
                  <StatusLabel status={item.status} applied={applied} />
                  {/* 删除类型不显示依赖标记 */}
                  {!isDeleted(item) && <DepBadge deps={item.planStep.dependencies || []} />}
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
                  {canOperate && isDeleted(item) && (
                    <button
                      onClick={() => handleApplyOne(item)}
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-red-500 hover:bg-red-600 text-white cursor-pointer transition-colors"
                    >
                      删除
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
                {!isDeleted(item) && item.status === 'modified' && item.existing && item.existing.title !== item.planStep.title && (
                  <div className="text-[10px] text-gray-400 pl-4">
                    <span className="line-through text-red-300">{item.existing.title}</span>
                    <span className="mx-1">→</span>
                    <span className="text-green-600">{item.planStep.title}</span>
                  </div>
                )}
                {/* 修改态：显示描述 diff */}
                {!isDeleted(item) && item.status === 'modified' && item.existing && (
                  <DescriptionDiff oldDesc={item.existing.description} newDesc={item.planStep.description} />
                )}
              </div>
            );
          })
        ) : (
          // 导入模式 / 非当前任务只读：原始渲染
          plan.steps.map((step) => (
            <div key={step.ref} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrentTask ? 'bg-sky-400' : 'bg-gray-300'}`} />
              <span className={`text-xs truncate flex-1 ${isCurrentTask ? 'text-gray-700' : 'text-gray-400'}`}>{step.title}</span>
              <DepBadge deps={step.dependencies || []} />
            </div>
          ))
        )}
      </div>

      {/* 底部操作区（仅当前任务显示操作按钮） */}
      {isCurrentTask && (
      <div className={`px-3 py-2 border-t ${borderColor}`}>
        {/* 更新模式 + 还有未应用的变更 → 批量应用按钮 */}
        {updateMode && hasPending && stats ? (
          <button
            onClick={handleBatchApply}
            disabled={batchApplying || !projectId || !taskId}
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
          /* 有已有步骤但无变更 */
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            无变更
          </div>
        ) : !hasExisting && imported ? (
          /* 无已有步骤 + 已导入 */
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
      )}
    </div>
  );
}
