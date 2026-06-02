# 任务链执行 — 测试用例规划

## 一、用户操作清单

从用户视角梳理所有与执行链相关的操作：

| # | 操作 | 触发方式 | 涉及链路 |
|---|------|---------|---------|
| O1 | 创建任务 + 添加依赖关系 | 前端 TaskNode/TaskDetailPanel | task.service → DB |
| O2 | 启动执行 | 点击"执行任务链"按钮 | controller → service → engine → DB |
| O3 | 轮询执行进度 | 前端每 3s 自动轮询 | controller.getStatus → DB |
| O4 | 中途停止执行 | 点击"停止执行"按钮 | controller.stop → service.stop → abort |
| O5 | 执行完成后合并 | MergeDialog 选分支 | controller.merge → service.merge |
| O6 | 执行完成后关闭合并对话框 | 点 MergeDialog 的"取消" | 前端 dismissedExecId |
| O7 | 执行中刷新页面 | 浏览器 F5 | restoreExecution → 轮询恢复 |
| O8 | 执行失败后重新执行 | 再次点"执行任务链" | 新一轮 start |
| O9 | 重复点击执行 | 运行中再点执行按钮 | 409 冲突 |
| O10 | 删除正在执行的任务 | 任务节点上的删除按钮 | 任务在执行中删除 |

---

## 二、测试策略

### 分层原则

- **service 层**：用真实 MockEngine（`MOCK_TASK_DELAY=50`），让异步流程真正跑起来，验证 DAG 排序、批量并发、stop 竞态保护、消息验证等核心逻辑。
- **controller 层**：mock 掉 service，专注 HTTP 边界（参数提取、错误码映射、400/404/409）。
- **MockEngine 自身**：独立测试，因为它是测试基础设施，本身有 bug 会导致所有测试结果不可信。

### 为什么 service 层用真实 MockEngine 而非 mock opencode-v2

execution.service.ts 的核心复杂度在于 DAG 排序、批量并发、stop 竞态保护、消息验证——这些逻辑都在 service 内部。如果 mock 掉 opencode-v2，输入/输出被固定，测不到真实的异步交互。用 MockEngine 让递归、竞态、状态流转被完整触发。

---

## 三、测试用例

### 文件 1：`execution.service.test.ts` — 核心业务逻辑

#### 组 1：启动执行的前置校验

| ID | 用例 | 操作 | 预期 | 为什么这样测试 |
|----|------|------|------|-------------|
| S1.1 | topic 不存在 | `start('bad-topic', projectId)` | 抛 "Topic not found" | 防止传入非法 topicId 创建孤儿执行记录 |
| S1.2 | project 不存在 | `start(topicId, 'bad-project')` | 抛 "Project not found or no path configured" | project.path 是 worktree 创建的前提，缺失到 SDK 层才报错，提前校验 |
| S1.3 | 所有任务已 COMPLETED | 所有任务 status=COMPLETED | 抛 "No pending tasks to execute" | 防止对已完成的任务重复执行 |
| S1.4 | 同一 topic 已有 RUNNING 执行 | 连续调用两次 start | 第二次抛 "An execution is already running" | 核心防并发保护：两个执行同时跑会争抢同一个 session |

#### 组 2：正常执行流程（Happy Path）

| ID | 用例 | DAG 结构 | maxConcurrency | 预期 | 为什么这样测试 |
|----|------|---------|---------------|------|-------------|
| S2.1 | 单任务无依赖 | [A] | 2 | A→COMPLETED，执行→COMPLETED，completedTasks=1/1 | 最简路径，验证完整生命周期 |
| S2.2 | 3 任务线性依赖 | A→B→C | 2 | 分 3 批完成，A→B→C 依次 COMPLETED | 验证 DAG 拓扑排序正确：B 等 A 完成，C 等 B 完成 |
| S2.3 | 5 任务菱形依赖 | A→{B,C}→D→E | 2 | 第一批 A，第二批 B+C 并发，第三批 D，第四批 E | 验证并发控制：B 和 C 在同一批发送给 AI |
| S2.4 | 进度统计准确 | A→B→C，maxConcurrency=1 | 1 | 每批完成后 completedTasks 递增：1→2→3 | 前端进度条依赖 completedTasks/totalTasks，必须准确 |

**测试方法：** 启动执行后，轮询等待 `status === 'COMPLETED'`（超时 10s），然后检查所有任务状态和执行记录。

#### 组 3：中途停止

| ID | 用例 | 触发时机 | 预期 | 为什么这样测试 |
|----|------|---------|------|-------------|
| S3.1 | 执行中 stop | RUNNING 状态 | IN_PROGRESS 任务重置为 PENDING，执行→STOPPED | 用户停止后应该能重新执行，不留下僵尸 IN_PROGRESS |
| S3.2 | CREATING_WORKTREE 阶段 stop | worktree 创建中 | 执行→STOPPED | worktree 创建是异步的，stop 必须能中断创建阶段 |
| S3.3 | stop 已停止的执行 | status=STOPPED | 抛 "Execution is not running" | 防止对已停止的执行重复 stop |
| S3.4 | stop 不存在的执行 | 随机 executionId | 抛 "Execution not found" | 基本 404 校验 |

**S3.1 测试方法：** 启动 5 个任务的执行（`MOCK_TASK_DELAY=200`），等待 300ms 确保第一批已进入 `waitForSessionIdle`，然后调用 stop，检查任务状态。

**S3.2 测试方法：** 启动执行后立即（不等 worktree 创建完成）调用 stop，设置 `MOCK_WT_DELAY=500` 给 stop 窗口。

#### 组 4：合并

| ID | 用例 | 前置状态 | 预期 | 为什么这样测试 |
|----|------|---------|------|-------------|
| S4.1 | 正常合并 | COMPLETED | 状态→MERGED，targetBranch='main' | 正常合并路径 |
| S4.2 | 非 COMPLETED 状态 merge | RUNNING | 抛 "Execution must be COMPLETED to merge" | 防止对运行中的执行误合并 |
| S4.3 | merge 不存在的执行 | — | 抛 "Execution not found" | 基本 404 校验 |
| S4.4 | 合并后再次执行 | MERGED | 新执行正常启动 | 验证 MERGED 不阻止新执行 |

#### 组 5：部分失败

| ID | 用例 | Mock 配置 | 预期 | 为什么这样测试 |
|----|------|----------|------|-------------|
| S5.1 | 首个任务成功后续全失败 | `MOCK_FAIL_AFTER=1` | 第 1 个 COMPLETED，其余 BLOCKED，执行→FAILED | 验证部分失败不会导致系统卡死 |
| S5.2 | 依赖链中断 | A→B→C，`MOCK_FAIL_AFTER=1` | A=COMPLETED，B=BLOCKED，C=PENDING，执行→FAILED | 验证上游失败时下游不启动，执行最终 FAILED |

**为什么重要：** 这是最容易出问题的场景——部分任务失败后 executeTasks 的递归是否正确处理 "无可启动任务 + 有 PENDING 任务" → FAILED 的终态判定。

#### 组 6：查询

| ID | 用例 | 预期 | 为什么这样测试 |
|----|------|------|-------------|
| S6.1 | getStatus 返回最新执行 | 返回按 createdAt DESC 第一条 | 前端轮询依赖此接口 |
| S6.2 | getByTopic 返回全部执行历史 | 返回所有执行，按时间倒序 | 用户可能查看历史 |
| S6.3 | 无执行记录时 getStatus | 返回 null | 页面首次加载的正常情况 |
| S6.4 | 多次执行后 getStatus | 返回最近一次 | 验证排序正确 |

---

### 文件 2：`execution.controller.test.ts` — HTTP API 层

沿用现有 `mockCtx()` 模式，mock 掉 service 层。

#### 组 7：Controller 输入校验

| ID | 用例 | 请求 | 预期 HTTP 状态 | 为什么这样测试 |
|----|------|------|--------------|-------------|
| C7.1 | start 正常 | `{ projectId, maxConcurrency: 2 }` | 201 + execution body | 正常路径基准 |
| C7.2 | start 缺少 projectId | `{}` | 500（service 层抛错） | projectId 在 body 中，容易漏传 |
| C7.3 | start 重复执行 | service 抛 "already running" | 409 | 前端需要根据 409 显示"已在执行中" |
| C7.4 | start 无待执行任务 | service 抛 "No pending" | 400 | 前端需要根据 400 显示"无待执行任务" |
| C7.5 | stop 正常 | — | 200 + execution body | 正常路径基准 |
| C7.6 | stop 不存在 | service 抛 "not found" | 404 | controller 区分 404 和 400 |
| C7.7 | stop 非运行中 | service 抛 "not running" | 400 | 防止前端重复点停止 |
| C7.8 | merge 正常 | `{ targetBranch: 'main' }` | 200 + execution body | 正常路径基准 |
| C7.9 | merge 缺少 targetBranch | `{}` | 400 | targetBranch 是必填参数 |
| C7.10 | merge 空字符串 targetBranch | `{ targetBranch: '' }` | 400 | 空字符串不应作为合法分支名 |
| C7.11 | merge 非 COMPLETED | service 抛 "must be COMPLETED" | 400 | 防止运行中合并 |
| C7.12 | merge 不存在 | service 抛 "not found" | 404 | 基本 404 |
| C7.13 | status 正常 | — | 200 + execution/null | 轮询接口基准 |
| C7.14 | list 正常 | — | 200 + `{ data: [...] }` | 列表接口基准 |

---

### 文件 3：`engine-mock.test.ts` — Mock 引擎自身

不依赖 Prisma，直接实例化 MockEngine 验证行为。

| ID | 用例 | 预期 | 为什么这样测试 |
|----|------|------|-------------|
| M1 | createWorktree 返回结构 | `{ name, branch: 'opencode/...', directory: '/tmp/mock-worktree/...' }` | 上层代码依赖 branch 字段 |
| M2 | sendPrompt + waitForSessionIdle 生成消息对 | 每条 prompt 生成 1 user + 1 assistant 消息 | execution.service 的消息验证依赖此行为 |
| M3 | abortSession 中断 waitForSessionIdle | waitForSessionIdle 抛 "Session aborted by user" | 核心：stop 操作必须能中断正在等待的 mock |
| M4 | MOCK_FAIL_AFTER=2 | 前 2 个任务生成 assistant，之后不生成 | 验证 per-session 计数器 |
| M5 | 两个 session 的 failAfter 互不影响 | session A 成功 2 个后开始失败，session B 从 0 开始计数 | 验证 per-session 计数独立（Bug 3 修复） |
| M6 | MOCK_TASK_DELAY=0 | waitForSessionIdle 立即 resolve，不报错 | 验证 0 值不被 `\|\|` 吞掉（Bug 2 修复） |
| M7 | abortCallbacks 清理 | waitForSessionIdle 正常完成后，session.abortCallbacks 为空 | 验证回调正确删除（Bug 1 修复） |
| M8 | removeWorktree | worktree 从列表中移除 | 验证生命周期管理 |

---

## 四、测试文件位置

```
packages/server/src/__tests__/
  execution.service.test.ts    ← 组 1-6（核心链路测试）
  execution.controller.test.ts ← 组 7（API 层校验）
  engine-mock.test.ts          ← 组 M（Mock 引擎自身）
```

## 五、测试基础设施

### Prisma Mock 模式

沿用现有测试的 `vi.mock('../prisma.js')` 模式：

```typescript
const mockPrisma = {
  taskTopic: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  taskExecution: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
};
```

### MockEngine 加速

service 层测试需要 MockEngine 真正运行，设置环境变量加速：

```typescript
process.env.MOCK_ENGINE = 'true';
process.env.MOCK_WT_DELAY = '10';
process.env.MOCK_SESSION_DELAY = '10';
process.env.MOCK_TASK_DELAY = '50';
```

### 异步等待工具

```typescript
function waitFor(predicate: () => boolean, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(check, 50);
    };
    check();
  });
}
```

## 六、用例与操作覆盖矩阵

| 操作 | 覆盖用例 |
|------|---------|
| O1 创建任务+依赖 | S2.2, S2.3（DAG 构造） |
| O2 启动执行 | S1.1-S1.4, S2.1-S2.4, S5.1-S5.2 |
| O3 轮询进度 | S2.4, S6.1-S6.4 |
| O4 中途停止 | S3.1-S3.4 |
| O5 合并 | S4.1-S4.4 |
| O6 关闭合并对话框 | C7.9-C7.10（前端操作对应后端的参数缺失校验） |
| O7 刷新页面 | S6.1（getStatus 恢复轮询） |
| O8 重新执行 | S4.4（合并后重新执行） |
| O9 重复点击执行 | S1.4, C7.3 |
| O10 删除执行中任务 | S5.2（依赖链中断的等价场景） |
