import type { Project } from '@/types/project';
import type { TaskTopic } from '@/types/topic';
import type { Task } from '@/types/task';

/**
 * pageContext 构建器 — 为 AI 聊天生成动态上下文注入内容。
 *
 * 设计说明：
 * - 静态规则（平台术语、task-plan 格式、模式说明等）已移至 agent prompt (task_helper.md)，
 *   不再在每条消息的 system 中重复注入。
 * - 此处只生成轻量的动态数据：当前模式标记 + 页面数据 + ID 池接口地址。
 * - 首条消息注入后，后续消息通过去重逻辑跳过（除非内容变化）。
 *
 * 上下游影响：
 * - 上游：TopicGraphPage / TaskGraphPage 调用 buildXxxPageContext() 构建 pageContext。
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

export function buildTopicPageContext(
  project: Project | null | undefined,
  topics: TaskTopic[],
): string {
  const parts: string[] = ['[当前上下文: 主题视图]'];

  parts.push('\n## 当前页面');
  parts.push('页面类型: 项目主题图谱');
  if (project) {
    parts.push(`项目: ${project.name}`);
    if (project.description) parts.push(`项目描述: ${truncate(project.description, 120)}`);
  }

  if (topics.length > 0) {
    const limit = Math.min(topics.length, 30);
    parts.push(`\n## 主题列表 (${topics.length} 个)`);
    for (let i = 0; i < limit; i++) {
      const t = topics[i];
      const label = statusLabel[t.aggregatedStatus] || t.aggregatedStatus;
      parts.push(`${i + 1}. ${t.name} | 状态: ${label} | 任务: ${t.completedCount}/${t.taskCount} 完成${t.summary ? ' | ' + truncate(t.summary, 60) : ''}`);
    }
    if (topics.length > limit) {
      parts.push(`... 还有 ${topics.length - limit} 个主题`);
    }
  } else {
    parts.push('\n## 主题列表');
    parts.push('当前项目暂无主题');
  }

  parts.push(`\n## ID池接口`);
  parts.push(`GET ${getIdPoolApiUrl()}?count=N （返回可用ID列表，用于新任务ref）`);

  return parts.join('\n');
}

export function buildTaskPageContext(
  project: Project | null | undefined,
  topic: TaskTopic | null | undefined,
  tasks: Task[],
): string {
  const parts: string[] = ['[当前上下文: 任务视图]'];

  parts.push('\n## 当前页面');
  parts.push('页面类型: 任务图谱');
  if (project) {
    parts.push(`项目: ${project.name}`);
  }
  if (topic) {
    const label = statusLabel[topic.aggregatedStatus] || topic.aggregatedStatus;
    parts.push(`当前主题: ${topic.name} | 状态: ${label} | 任务: ${topic.completedCount}/${topic.taskCount} 完成`);
    if (topic.summary) parts.push(`主题概述: ${truncate(topic.summary, 120)}`);
  }

  if (tasks.length > 0) {
    const limit = Math.min(tasks.length, 50);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    parts.push(`\n## 任务列表 (${tasks.length} 个)`);
    for (let i = 0; i < limit; i++) {
      const t = tasks[i];
      const label = statusLabel[t.status] || t.status;
      const deps = t.dependencies
        .filter((d) => taskMap.has(d))
        .map((d) => `${taskMap.get(d)!.title}(${d})`);
      const depStr = deps.length > 0 ? ` | 依赖: ${deps.join(', ')}` : '';
      const descStr = t.description ? ` | ${truncate(t.description, 40)}` : '';
      parts.push(`${i + 1}. [id:${t.id}] ${t.title} | 状态: ${label}${depStr}${descStr}`);
    }
    if (tasks.length > limit) {
      parts.push(`... 还有 ${tasks.length - limit} 个任务`);
    }
  } else {
    parts.push('\n## 任务列表');
    parts.push('当前主题暂无任务');
  }

  parts.push(`\n## ID池接口`);
  parts.push(`GET ${getIdPoolApiUrl()}?count=N （返回可用ID列表，用于新任务ref）`);

  return parts.join('\n');
}
