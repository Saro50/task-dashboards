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
function getIdPoolApiUrl(): string {
  return `${window.location.origin}/api/id-pool`;
}

export function buildTaskPageContext(
  project: Project | null | undefined,
  tasks: Task[],
): string {
  const parts: string[] = ['[当前上下文: 任务视图]'];

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

  parts.push(`\n## ID池接口`);
  parts.push(`GET ${getIdPoolApiUrl()}?count=N （返回可用ID列表，用于新步骤ref）`);

  return parts.join('\n');
}

export function buildStepPageContext(
  project: Project | null | undefined,
  task: Task | null | undefined,
  steps: Step[],
): string {
  const parts: string[] = ['[当前上下文: 步骤视图]'];

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

  parts.push(`\n## ID池接口`);
  parts.push(`GET ${getIdPoolApiUrl()}?count=N （返回可用ID列表，用于新步骤ref）`);

  return parts.join('\n');
}
