# AI 助手页面上下文注入方案

## 目标

AI 助手窗口需要感知当前用户访问页面的上下文信息，例如：
- 在项目页下，AI 助手能知道当前项目的所有「任务」
- AI 助手掌握平台的所有概念和术语
- 用户提问时，AI 以平台术语和信息回复

## 方案选型过程

### 方案一：拼接到用户消息（已否决）

将页面上下文作为 XML 标签拼接到用户消息文本前，通过 `promptAsync` 的 `parts` 发送。

**否决原因**：
- 每条用户消息都带完整 context，N 轮对话后 token 指数级累积（N × context_size）
- 重复 context 挤占 AI 上下文窗口，降低有效对话空间
- 用户历史消息中会包含 `<page-context>` 标签，需要额外的前端过滤逻辑

### 方案二：SDK `system` 字段注入（最终采用）

OpenCode SDK 的 `session.promptAsync` 支持 `system` 参数，用于注入系统级指令。

**优势**：
- `system` 字段以系统消息形式传递给 LLM，不进入对话历史
- Token 开销固定（每次调用一次），不随对话轮数增长
- 用户消息保持干净，无需前端过滤
- 不覆盖 agent 原有 prompt（追加模式）

## `system` 字段行为验证

### 验证方法

通过三个测试用例验证 `system` 字段的实际行为：

| 测试 | 方法 | 预期 |
|------|------|------|
| 秘密事实注入 | `system` 中包含一个"秘密代号"，用户消息中不提及 | AI 在回复中自然使用该代号 |
| 行为约束 | `system` 要求用法语回复，用户消息要求用中文 | AI 用法语回复 |
| 无 system 对照 | 不传 `system`，正常对话 | AI 保持默认行为 |

### 验证结果

| 测试 | 结果 | 说明 |
|------|------|------|
| 秘密事实注入 | ✅ 通过 | AI 自然使用了 system 中仅有的代号 "ORION-7X" |
| 行为约束 | ✅ 通过 | AI 用法语回复，忽略用户消息中的中文请求 |
| 无 system 对照 | ✅ 正常 | 无 system 时 AI 保持默认行为 |

### 结论

**`system` 字段是追加模式（APPEND），且完全有效。** 它在 agent 原有 prompt 基础上追加额外的系统指令，AI 同时遵循两者。

## 最终方案

### 架构

```
前端页面 (TaskGraphPage / StepGraphPage)
  │ 收集当前页面数据 → pageContext.ts 构建上下文字符串
  │
  ▼
AIChatWidget (新增 pageContext prop)
  │ sendMessage(text, pageContext)
  ▼
useChat hook
  │ chatApi.sendMessage(sessionId, text, directory, agent, context)
  ▼
后端 chat.controller → chat.service
  │ 将 context 传递给 opencode.sendPromptAsync 的 system 参数
  ▼
opencode.sendPromptAsync → OpenCode Engine
  │ promptAsync({ body: { parts, agent, system: context } })
  ▼
LLM 收到: [agent原始prompt] + [system追加指令] + [对话历史] + [用户消息]
```

### 数据流

```
用户输入 "列出所有任务"
  → 前端构建 pageContext（平台术语 + 当前页面数据）
  → 后端调用 promptAsync({
      parts: [{ type: 'text', text: '列出所有任务' }],
      agent: 'task-helper',
      system: '<平台术语和页面上下文，约300-800 tokens>'
    })
  → AI 收到完整上下文，基于平台术语和数据回复
  → 用户看到正常的 AI 回复
  → 对话历史中只有 '列出所有任务'，不含上下文
```

### Token 开销分析

| 方案 | 每轮开销 | 5轮总开销 | 10轮总开销 |
|------|---------|----------|-----------|
| 拼接到用户消息 | context × N | 5 × context | 10 × context |
| `system` 字段 | context × 1 | context | context |

假设 context = 800 tokens，10 轮对话节省 7200 tokens。

## 改动清单

### 后端

| 文件 | 改动 |
|------|------|
| `packages/server/src/modules/chat/types.ts` | `SendMessageBody` 新增 `context?: string` |
| `packages/server/src/modules/engine/opencode.ts` | `sendPromptAsync` 新增 `system` 参数，传入 SDK body |
| `packages/server/src/modules/chat/chat.service.ts` | `sendMessage` 接受 `context`，传给 `sendPromptAsync` |
| `packages/server/src/modules/chat/chat.controller.ts` | 从 request body 解构 `context` 传给 service |

### 前端

| 文件 | 改动 |
|------|------|
| `packages/web/src/utils/pageContext.ts` | **新建** — 页面上下文构建工具 |
| `packages/web/src/api/chat.ts` | `sendMessage` 新增 `context` 参数 |
| `packages/web/src/hooks/useChat.ts` | `sendMessage` 接受并传递 `context` |
| `packages/web/src/components/AIChatWidget.tsx` | Props 新增 `pageContext`，传递到 `useChat` |
| `packages/web/src/pages/TaskGraphPage.tsx` | 用 tasks + project 数据构建上下文 |
| `packages/web/src/pages/StepGraphPage.tsx` | 用 steps + tasks + project 数据构建上下文 |

### 不需要的改动

- ~~更新 agent prompt 文件~~ — 术语通过 `system` 字段动态注入
- ~~前端消息过滤~~ — context 不进入对话历史

## `system` 字段内容格式

```xml
你是 TaskDashboards 任务管理平台的 AI 助手。请使用以下平台术语与用户交流。

## 平台概念
- 项目(Project): 顶层容器，包含多个任务
- 任务(Task): 功能模块划分，包含多个步骤
- 步骤(Step): 工作单元，状态有 PENDING/IN_PROGRESS/COMPLETED/BLOCKED
- 执行(Execution): 按依赖顺序在 worktree 隔离环境中执行任务链
- 任务计划(TaskPlan): AI 生成的结构化任务规划，包含任务、概述和步骤列表

## 当前页面
页面类型: 项目任务图谱
项目: MyProject
路径: /path/to/project

## 当前数据
任务列表:
1. 用户认证 | 状态: IN_PROGRESS | 步骤: 3/5 完成
2. 数据管理 | 状态: PENDING | 步骤: 0/4 完成
```

## 验证脚本

见 `scripts/test-system-field.mjs`
