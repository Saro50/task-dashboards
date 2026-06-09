import type { Project } from '@/types/project';
import type { TaskTopic } from '@/types/topic';
import type { Task } from '@/types/task';

const PLATFORM_CONCEPTS = `你是 TaskDashboards 任务管理平台的 AI 助手。请使用以下平台术语与用户交流。

## 平台概念
- 项目(Project): 顶层容器，包含多个主题
- 主题(Topic): 功能模块划分，一个主题下包含多个任务
- 任务(Task): 具体的工作单元，有状态和依赖关系
- 任务状态: PENDING(待处理) / IN_PROGRESS(进行中) / COMPLETED(已完成) / BLOCKED(阻塞)
- 执行(Execution): 按依赖顺序在 worktree 隔离环境中执行任务链
- 任务计划(TaskPlan): AI 生成的结构化任务规划，包含主题、概述和任务列表
- 任务链: 按依赖关系排序的一组任务，可以批量执行

## 回复要求
- 使用平台术语（项目、主题、任务）而非通用词汇（文件夹、模块、工作项）
- 如果用户提到数据相关的内容，参考下方「当前数据」部分回复
- 如果需要生成任务计划，使用 <task-plan> 格式

## 任务修改能力
你可以帮用户修改当前主题下的任务链。修改方式与创建相同，输出完整 <task-plan> 格式：
1. 所有任务的 ref 必须使用下方「可分配ID池」中的 ID，或已有任务的真实 ID
2. 对已有任务：将其真实 ID 作为 ref（如任务列表中的 [id:clxxxx] → "ref": "clxxxx"），修改 title / description / dependencies
3. 对新增任务：从 ID 池中取一个未使用的 ID 作为 ref
4. 不需要删除的任务直接省略即可（前端不会自动删除）
5. dependencies 使用目标任务的 ref 值
6. 单次 plan 任务数量不得超过 20 个，超出请拆分为多次输出`;

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

export function buildTopicPageContext(
  project: Project | null | undefined,
  topics: TaskTopic[],
): string {
  const parts: string[] = [PLATFORM_CONCEPTS];

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

  return parts.join('\n');
}

export function buildTaskPageContext(
  project: Project | null | undefined,
  topic: TaskTopic | null | undefined,
  tasks: Task[],
  idPool?: string[],
): string {
  const parts: string[] = [PLATFORM_CONCEPTS];

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

  /** 注入预分配 ID 池，供 AI 创建新任务时使用 */
  if (idPool && idPool.length > 0) {
    parts.push(`\n## 可分配ID池（新增任务请从以下 ID 中选用，每个 ID 只能用一次）`);
    parts.push(idPool.join(', '));
  }

  return parts.join('\n');
}
