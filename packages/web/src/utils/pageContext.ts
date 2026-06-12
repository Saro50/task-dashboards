import type { Project } from '@/types/project';
import type { Task } from '@/types/task';
import type { Step } from '@/types/step';

/**
 * pageContext 构建器 — 为 AI 聊天生成动态上下文注入内容。
 *
 * 设计说明：
 * - 静态规则（平台术语、step-plan 格式、模式说明等）已移至 agent prompt (task_helper.md)，
 *   不再在每条消息的 system 中重复注入。
 * - 此处只生成轻量的动态数据：当前模式标记 + 页面数据 + ID 池接口地址。
 * - 首条消息注入后，后续消息通过去重逻辑跳过（除非内容变化）。
 *
 * 上下游影响：
 * - 上游：TaskGraphPage / StepGraphPage 调用 buildXxxPageContext() 构建 pageContext。
 * - 下游：AIChatWidget.handleSubmit 通过 sendMessage 将 context 注入 UserMessage.system。
 */

const statusLabel: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  BLOCKED: '阻塞',
  ACTIVE: '活跃',
  ARCHIVED: '已归档',
  ERROR: '异常',
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** 获取当前 web server 的 origin，用于拼接 ID 池接口地址 */
function getOrigin(): string {
  return window.location.origin;
}

/**
 * 构建 API 接口区块 — 提供项目 ID、ID 池接口和只读查询接口。
 * AI 在规划阶段可通过这些接口获取任务/步骤详情。
 */
function buildApiSection(projectId: string | undefined): string[] {
  const origin = getOrigin();
  const parts: string[] = [];

  if (projectId) {
    parts.push(`\n## 项目ID`);
    parts.push(projectId);
  }

  parts.push(`\n## ID池接口`);
  parts.push(`GET ${origin}/api/id-pool?count=N （返回可用ID列表，用于新步骤ref）`);

  parts.push(`\n## 查询接口`);
  if (projectId) {
    parts.push(`GET ${origin}/api/projects/${projectId}/tasks — 查询项目所有任务`);
    parts.push(`GET ${origin}/api/projects/${projectId}/steps — 查询项目所有步骤`);
  }
  parts.push(`GET ${origin}/api/tasks/{taskId}/steps — 查询某个任务的步骤详情`);

  return parts;
}

export function buildTaskPageContext(
  project: Project | null | undefined,
  tasks: Task[],
  focusedTask?: Task,
): string {
  const parts: string[] = ['[当前上下文: 任务视图]'];

  // 聚焦任务信息 — 当用户选中某个任务卡片时追加，帮助 AI 理解当前讨论焦点
  if (focusedTask) {
    const label = statusLabel[focusedTask.aggregatedStatus] || focusedTask.aggregatedStatus;
    parts.push('## 当前聚焦任务');
    parts.push(`任务名: ${focusedTask.name}`);
    parts.push(`任务ID: ${focusedTask.id}`);
    parts.push(`状态: ${label}`);
    if (focusedTask.summary) parts.push(`概要: ${truncate(focusedTask.summary, 200)}`);
    parts.push(`步骤进度: ${focusedTask.completedStepCount}/${focusedTask.stepCount} 完成`);
    parts.push('说明: 用户当前正在关注此任务，后续对话应围绕此任务展开。');
    parts.push(`查询该任务步骤详情: GET ${window.location.origin}/api/tasks/${focusedTask.id}/steps`);
  }

  parts.push('\n## 当前页面');
  parts.push('页面类型: 项目任务图谱');
  if (project) {
    parts.push(`项目: ${project.name}`);
    if (project.description) parts.push(`项目描述: ${truncate(project.description, 120)}`);
  }

  if (tasks.length > 0) {
    const limit = Math.min(tasks.length, 30);
    parts.push(`\n## 任务列表 (${tasks.length} 个)`);
    for (let i = 0; i < limit; i++) {
      const t = tasks[i];
      const label = statusLabel[t.aggregatedStatus] || t.aggregatedStatus;
      parts.push(`${i + 1}. ${t.name} | 状态: ${label} | 步骤: ${t.completedStepCount}/${t.stepCount} 完成${t.summary ? ' | ' + truncate(t.summary, 60) : ''}`);
    }
    if (tasks.length > limit) {
      parts.push(`... 还有 ${tasks.length - limit} 个任务`);
    }
  } else {
    parts.push('\n## 任务列表');
    parts.push('当前项目暂无任务');
  }

  parts.push(...buildApiSection(project?.id));

  return parts.join('\n');
}

export function buildStepPageContext(
  project: Project | null | undefined,
  task: Task | null | undefined,
  steps: Step[],
  focusedStep?: Step,
): string {
  const parts: string[] = ['[当前上下文: 步骤视图]'];

  // 聚焦步骤信息 — 当用户选中某个步骤卡片时追加，帮助 AI 理解当前讨论焦点
  if (focusedStep) {
    const label = statusLabel[focusedStep.status] || focusedStep.status;
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const depNames = focusedStep.dependencies
      .filter((d) => stepMap.has(d))
      .map((d) => `${stepMap.get(d)!.title}(${d})`);
    parts.push('## 当前聚焦步骤');
    parts.push(`步骤ID: ${focusedStep.id}`);
    parts.push(`标题: ${focusedStep.title}`);
    parts.push(`状态: ${label}`);
    if (focusedStep.description) parts.push(`描述: ${truncate(focusedStep.description, 200)}`);
    if (depNames.length > 0) parts.push(`依赖: ${depNames.join(', ')}`);
    if (focusedStep.blockedReason) parts.push(`阻塞原因: ${focusedStep.blockedReason}`);
    parts.push('说明: 用户当前正在关注此步骤，后续对话应围绕此步骤展开。');
    if (focusedStep.taskId) {
      parts.push(`查询所属任务全部步骤: GET ${window.location.origin}/api/tasks/${focusedStep.taskId}/steps`);
    }
  }

  parts.push('\n## 当前页面');
  parts.push('页面类型: 步骤图谱');
  if (project) {
    parts.push(`项目: ${project.name}`);
  }
  if (task) {
    const label = statusLabel[task.aggregatedStatus] || task.aggregatedStatus;
    parts.push(`当前任务: ${task.name} | 状态: ${label} | 步骤: ${task.completedStepCount}/${task.stepCount} 完成`);
    if (task.summary) parts.push(`任务概述: ${truncate(task.summary, 120)}`);
  }

  if (steps.length > 0) {
    const limit = Math.min(steps.length, 50);
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    parts.push(`\n## 步骤列表 (${steps.length} 个)`);
    for (let i = 0; i < limit; i++) {
      const s = steps[i];
      const label = statusLabel[s.status] || s.status;
      const deps = s.dependencies
        .filter((d) => stepMap.has(d))
        .map((d) => `${stepMap.get(d)!.title}(${d})`);
      const depStr = deps.length > 0 ? ` | 依赖: ${deps.join(', ')}` : '';
      const descStr = s.description ? ` | ${truncate(s.description, 40)}` : '';
      parts.push(`${i + 1}. [id:${s.id}] ${s.title} | 状态: ${label}${depStr}${descStr}`);
    }
    if (steps.length > limit) {
      parts.push(`... 还有 ${steps.length - limit} 个步骤`);
    }
  } else {
    parts.push('\n## 步骤列表');
    parts.push('当前任务暂无步骤');
  }

  parts.push(...buildApiSection(project?.id));

  return parts.join('\n');
}
