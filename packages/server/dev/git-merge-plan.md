# Git Merge 执行计划

## 背景

当前 `merge()` 只标记状态 + 销毁 worktree，没有实际 git merge。`worktree.remove()` 会删除分支，导致代码变更丢失。

## 方案：SDK diff 预览 + simple-git merge --squash

### 依赖引入

```
pnpm add simple-git --filter @task-dashboards/server
```

### 改动文件清单

| # | 文件 | 改动 |
|---|------|------|
| **1** | `packages/server/package.json` | 新增 `simple-git` 依赖 |
| **2** | `packages/server/src/modules/engine/opencode-v2.ts` | 新增 VCS 封装：`getVcsInfo()`, `getDiff()`, `getDiffRaw()` |
| **3** | `packages/server/src/modules/engine/engine-mock.ts` | Mock 实现 VCS 方法 |
| **4** | `packages/server/src/modules/execution/execution.service.ts` | 新增 `getDiff()`；重写 `merge()`：预览 → git merge --squash → commit → 销毁 worktree |
| **5** | `packages/server/src/modules/execution/execution.controller.ts` | 新增 `diff` 端点 |
| **6** | `packages/server/src/modules/execution/execution.routes.ts` | 注册 `GET /diff` 路由 |
| **7** | `packages/web/src/api/execution.ts` | 新增 `getDiff()` |
| **8** | `packages/web/src/types/execution.ts` | 新增 `FileDiff` 类型 |
| **9** | `packages/web/src/pages/StepGraphPage.tsx` | 合并前展示变更预览 |
| **10** | `packages/web/src/components/MergeDialog.tsx` | 改造：展示 diff 预览 + 确认合并 |

---

## 合并流程

```
用户点击"合并到分支"
  ↓
1. 前端调用 GET /api/executions/:id/diff
   └─ 后端: client.vcs.diff({ directory: worktreeDir, mode: "branch" })
   └─ 返回: Array<{ file, patch, additions, deletions, status }>
  ↓
2. MergeDialog 展示变更文件列表 + diff 预览
   用户确认目标分支，点击"确认合并"
  ↓
3. 前端调用 POST /api/executions/:id/merge { targetBranch: "main" }
  ↓
4. 后端 merge() 执行:
   a) simple-git(project.path).checkout(targetBranch)
   b) simple-git(project.path).merge(['--squash', worktreeBranch])
      ├─ 成功 → 继续
      └─ 冲突 → merge --abort，返回错误，execution 保持 COMPLETED
   c) simple-git(project.path).commit(`feat: ${taskName} 任务链执行完成`)
   d) OpencodeV2.removeWorktree(baseUrl, project.path, worktreeDirectory)
   e) prisma update → status: MERGED, targetBranch
  ↓
5. 前端显示"已合并到 main"
```

---

## 新增类型

```typescript
// packages/web/src/types/execution.ts 新增
export interface FileDiff {
  file: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
}
```

---

## opencode-v2.ts 新增方法

EngineAdapter 接口新增：

```typescript
getVcsInfo(baseUrl: string, directory: string): Promise<{ branch?: string; defaultBranch?: string }>;
getDiff(baseUrl: string, directory: string, mode: 'git' | 'branch'): Promise<any[]>;
getDiffRaw(baseUrl: string, directory: string): Promise<string>;
```

realEngine 实现：

```typescript
async getVcsInfo(baseUrl, directory) {
  const client = await getClient(baseUrl);
  const result = await client.vcs.get({ directory });
  return {
    branch: result.data?.branch,
    defaultBranch: result.data?.default_branch,
  };
},

async getDiff(baseUrl, directory, mode) {
  const client = await getClient(baseUrl);
  const result = await client.vcs.diff({ directory, mode });
  return (result.data as any[]) ?? [];
},

async getDiffRaw(baseUrl, directory) {
  const client = await getClient(baseUrl);
  const result = await client.vcs.diff2.raw({ directory });
  return (result.data as string) ?? '';
},
```

---

## execution.service.ts — merge() 重写

```typescript
export async function getDiff(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (!execution.worktreeDirectory) throw new Error('No worktree for this execution');

  const baseUrl = await EngineService.getBaseUrl();
  return OpencodeV2.getDiff(baseUrl, execution.worktreeDirectory, 'branch');
}

export async function merge(executionId: string, targetBranch: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (execution.status !== 'COMPLETED') throw new Error('Execution must be COMPLETED to merge');

  const project = await prisma.project.findUnique({ where: { id: execution.projectId } });
  if (!project?.path) throw new Error('Project not found or no path configured');

  const baseUrl = await EngineService.getBaseUrl();

  // git merge --squash
  const git = simpleGit(project.path);
  await git.checkout(targetBranch);

  try {
    await git.merge(['--squash', execution.worktreeBranch!]);
  } catch (err: any) {
    await git.merge(['--abort']).catch(() => {});
    throw new Error(`合并冲突: ${err.message}`);
  }

  const task = await prisma.task.findUnique({ where: { id: execution.taskId } });
  await git.commit(`feat: ${task?.name ?? '任务链'} 执行完成`);

  // 销毁 worktree
  if (execution.worktreeDirectory) {
    try {
      await OpencodeV2.removeWorktree(baseUrl, project.path, execution.worktreeDirectory);
    } catch (err: any) {
      logger.warn(S, 'worktree removal error after merge', { executionId, error: err.message });
    }
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: 'MERGED' as ExecutionStatus, targetBranch },
  });

  return prisma.taskExecution.findUnique({ where: { id: executionId } });
}
```

---

## execution.controller.ts + routes.ts 新增

```typescript
// controller
export async function diff(ctx: Context) {
  const { executionId } = ctx.params;
  const diffs = await Service.getDiff(executionId);
  ctx.body = { diffs };
}

// routes (executionRouter)
executionRouter.get('/diff', Controller.diff);
executionRouter.get('/messages', Controller.messages);
```

---

## 冲突处理

- `simple-git` 的 `merge(['--squash', branch])` 遇到冲突时抛错
- 捕获后执行 `merge --abort` 回滚
- 返回错误信息给前端
- execution 状态保持 COMPLETED，用户可重试

---

## 前端 MergeDialog 改造

打开时：
1. 调用 `executionApi.getDiff(executionId)` 获取变更列表
2. 展示变更文件列表（文件名、增删行数、状态图标）
3. 可展开查看每个文件的 diff patch

确认合并时：
1. 调用 `executionApi.merge(executionId, targetBranch)`
2. 成功 → 显示"已合并"
3. 冲突 → 显示错误信息

---

## 执行顺序

```
Phase 1: 安装 simple-git + opencode-v2 VCS 封装 + mock
Phase 2: 后端 diff 端点 + merge 重写
Phase 3: 前端 MergeDialog 改造 + diff 预览
Phase 4: 测试 + 验证
```

---

## 关键注意点

1. SDK VCS 方法在 `client.vcs`（根级别），不是 `client.v2.vcs`
2. `vcs.diff({ mode: "branch" })` 返回结构化的逐文件 diff（非原始 patch 字符串）
3. `vcs.diff2.raw()` 返回单个 raw unified diff 字符串
4. `vcs.apply({ patch })` 接受 unified diff patch，可用于 apply 补丁（但方案 C 用 simple-git merge）
5. `worktree.remove()` 会删除分支 — 必须在 merge 成功后才调用
6. 合并前需要 `checkout(targetBranch)` 确保在正确分支上操作
