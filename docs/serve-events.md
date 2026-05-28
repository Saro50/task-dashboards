# Serve 状态事件订阅指南

当项目处于 **serve** 状态运行时，可以通过 **Server-Sent Events (SSE)** 订阅系统产生的各类事件。

## 事件订阅端点

项目提供了两个 SSE 订阅端点：

1. **`/global/event`** - 订阅全局事件
2. **`/event`** - 订阅特定目录/工作区的事件（支持 `directory` 和 `workspace` 查询参数）

## 健康检查与心跳机制

### 健康检查 API

推荐使用 **`GET /global/health`** 端点检查服务健康状态：

**响应示例：**
```json
{
  "healthy": true,
  "version": "x.x.x"
}
```

**SDK 调用：**
```typescript
const health = await opencode.client.global.health()
console.log(health.data.healthy) // true
console.log(health.data.version) // "x.x.x"
```

### SSE 心跳事件

当通过 SSE 订阅事件时，服务器会每 **10 秒**自动发送一次心跳事件：

| 事件类型 | 说明 |
|---------|------|
| `server.heartbeat` | 服务器心跳（每 10 秒发送一次） |
| `server.connected` | SSE 连接建立时立即发送 |

**心跳事件格式：**
```json
{
  "id": "evt_...",
  "type": "server.heartbeat",
  "properties": {}
}
```

### 工作区连接状态

通过 `workspace.status` 事件监听工作区连接状态变化：

| 状态值 | 说明 |
|-------|------|
| `connected` | 已连接 |
| `connecting` | 连接中 |
| `disconnected` | 已断开 |
| `error` | 连接错误 |

**事件格式：**
```json
{
  "id": "evt_...",
  "type": "workspace.status",
  "properties": {
    "workspaceID": "...",
    "status": "connected"
  }
}
```

### 连接断开检测建议

1. **主动轮询**：定期调用 `GET /global/health` 检查服务状态
2. **心跳超时**：监听 `server.heartbeat` 事件，如果超过 10 秒未收到，可能连接已断开
3. **自动重连**：SSE 客户端内置自动重连机制，支持指数退避策略
4. **连接事件**：监听 `server.connected` 确认连接建立

## 可订阅的事件类型

### TUI 交互事件

| 事件类型 | 说明 |
|---------|------|
| `tui.prompt.append` | 追加提示文本 |
| `tui.command.execute` | 执行命令（如 `session.new`, `prompt.submit`, `agent.cycle` 等） |
| `tui.toast.show` | 显示通知消息（info/success/warning/error） |
| `tui.session.select` | 选择会话 |

### 服务器生命周期事件

| 事件类型 | 说明 |
|---------|------|
| `server.connected` | 服务器已连接 |
| `global.disposed` | 全局资源释放 |
| `server.instance.disposed` | 服务器实例释放 |

### 文件系统事件

| 事件类型 | 说明 |
|---------|------|
| `file.edited` | 文件被编辑 |
| `file.watcher.updated` | 文件监视器更新（add/change/unlink） |

### LSP 相关事件

| 事件类型 | 说明 |
|---------|------|
| `lsp.client.diagnostics` | LSP 客户端诊断信息 |
| `lsp.updated` | LSP 状态更新 |

### 会话状态事件

| 事件类型 | 说明 |
|---------|------|
| `session.created` | 会话创建 |
| `session.updated` | 会话更新 |
| `session.deleted` | 会话删除 |
| `session.status` | 会话状态变更 |
| `session.idle` | 会话空闲 |
| `session.error` | 会话错误 |
| `session.diff` | 会话代码差异 |
| `session.compacted` | 会话压缩 |

### 消息事件

| 事件类型 | 说明 |
|---------|------|
| `message.updated` | 消息更新 |
| `message.removed` | 消息移除 |
| `message.part.updated` | 消息部分更新 |
| `message.part.removed` | 消息部分移除 |
| `message.part.delta` | 消息部分增量（流式输出） |

### 权限与问答事件

| 事件类型 | 说明 |
|---------|------|
| `permission.asked` | 请求权限 |
| `permission.replied` | 权限回复 |
| `question.asked` | 问题被询问 |
| `question.replied` | 问题被回复 |
| `question.rejected` | 问题被拒绝 |

### 工具执行事件（session.next）

| 事件类型 | 说明 |
|---------|------|
| `session.next.step.started` | 步骤开始 |
| `session.next.step.ended` | 步骤结束 |
| `session.next.step.failed` | 步骤失败 |
| `session.next.tool.called` | 工具被调用 |
| `session.next.tool.progress` | 工具执行进度 |
| `session.next.tool.success` | 工具执行成功 |
| `session.next.tool.failed` | 工具执行失败 |
| `session.next.shell.started` | Shell 命令开始 |
| `session.next.shell.ended` | Shell 命令结束 |

### 文本生成事件（session.next）

| 事件类型 | 说明 |
|---------|------|
| `session.next.text.started` | 文本生成开始 |
| `session.next.text.delta` | 文本增量（流式输出） |
| `session.next.text.ended` | 文本生成结束 |
| `session.next.reasoning.started` | 推理开始 |
| `session.next.reasoning.delta` | 推理增量 |
| `session.next.reasoning.ended` | 推理结束 |

### 其他事件

| 事件类型 | 说明 |
|---------|------|
| `todo.updated` | 待办事项更新 |
| `mcp.tools.changed` | MCP 工具变更 |
| `mcp.browser.open.failed` | MCP 浏览器打开失败 |
| `command.executed` | 命令执行 |
| `project.updated` | 项目更新 |
| `vcs.branch.updated` | 版本控制分支更新 |
| `workspace.ready` | 工作区就绪 |
| `workspace.failed` | 工作区失败 |
| `workspace.status` | 工作区状态 |
| `worktree.ready` | 工作树就绪 |
| `worktree.failed` | 工作树失败 |
| `pty.created` | PTY 终端创建 |
| `pty.updated` | PTY 终端更新 |
| `pty.exited` | PTY 终端退出 |
| `pty.deleted` | PTY 终端删除 |
| `installation.updated` | 安装更新 |
| `installation.update-available` | 安装更新可用 |

## 使用方式

### 通过 SDK 订阅事件

```typescript
// 订阅特定项目的事件
const events = await opencode.client.event.subscribe({
  query: { directory: "/path/to/project" }
})

// 订阅全局事件
const globalEvents = await opencode.client.global.event()
```

### 事件流处理

事件通过 SSE 流式传输，支持自动重连和断点续传（通过 `Last-Event-ID` 头部）。

```typescript
for await (const event of events.stream) {
  console.log(event.type, event.properties)
}
```

## 事件数据结构

所有事件均遵循以下结构：

```typescript
{
  id: string        // 事件唯一标识
  type: string      // 事件类型
  properties: {}    // 事件具体数据
}
```

## 相关文件

- `packages/core/src/event.ts` - 核心事件系统实现
- `packages/core/src/session-event.ts` - 会话事件定义
- `packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts` - SSE 客户端实现
