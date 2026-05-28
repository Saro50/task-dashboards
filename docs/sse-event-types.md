# OpenCode SSE Event Types

本文档说明 OpenCode 引擎通过 SSE（Server-Sent Events）推送的事件类型及其用途。

## 事件来源

OpenCode SDK 的 `event.subscribe()` 方法返回一个 AsyncGenerator，持续产出事件。每个事件的统一结构为：

```typescript
{
  id: string           // 事件唯一 ID，如 "evt_e6caf3d82001DVYDyeVc4amexG"
  type: string         // 事件类型
  properties: object   // 事件载荷数据
}
```

服务端（`chat.controller.ts`）将 `event.properties` 序列化为 SSE `data` 字段，`event.type` 作为 SSE `event` 字段，转发给前端。

---

## 事件类型一览

### 会话生命周期

#### `server.connected`

SSE 连接建立时立即推送。

```json
{ "properties": {} }
```

#### `server.heartbeat`

周期性心跳，约每 30 秒一次，用于保持连接活跃。

```json
{ "properties": {} }
```

#### `session.created`

新会话被创建时推送。可用于实时更新前端会话列表。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "info": {
      "id": "ses_xxx",
      "title": "新会话",
      "directory": "/path/to/project",
      "agent": "build",
      "model": { "id": "glm-5.1", "providerID": "zhipuai-coding-plan" },
      "time": { "created": 1779939877861, "updated": 1779939877892 }
    }
  }
}
```

#### `session.updated`

会话信息变更时推送，如 token 消耗更新、标题变更等。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "info": {
      "id": "ses_xxx",
      "title": "...",
      "tokens": { "input": 14, "output": 9, "reasoning": 0 },
      "time": { "created": ..., "updated": ... }
    }
  }
}
```

#### `session.status`

会话状态切换时推送，用于指示 AI 是否正在生成。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "status": { "type": "busy" }   // "busy" | "idle"
  }
}
```

| status.type | 含义 |
|---|---|
| `busy` | AI 正在处理请求 |
| `idle` | AI 空闲，可接受新请求 |

#### `session.idle`

会话进入空闲状态时推送，表示当前请求处理完毕。通常与 `session.status(idle)` 同时出现，但额外携带 `sessionID`。

```json
{
  "properties": {
    "sessionID": "ses_xxx"
  }
}
```

#### `session.next.agent.switched`

会话切换 agent 时推送（如从 `build` 切换到 `explore`）。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "agent": "build",
    "timestamp": "2026-05-28T03:44:37.883Z"
  }
}
```

#### `session.next.model.switched`

会话切换模型时推送。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "model": { "id": "glm-5.1", "providerID": "zhipuai-coding-plan", "variant": "default" },
    "timestamp": "2026-05-28T03:44:37.883Z"
  }
}
```

#### `session.diff`

会话关联的文件变更 diff，通常在 AI 执行文件操作后推送。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "diff": []
  }
}
```

---

### 消息生命周期

#### `message.updated`

消息状态变更时推送，是最核心的事件之一。一条消息从创建到完成会触发多次此事件。

**用户消息创建时：**

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "info": {
      "id": "msg_xxx",
      "role": "user",
      "sessionID": "ses_xxx",
      "time": { "created": 1779939877883 },
      "agent": "build",
      "model": { "providerID": "zhipuai-coding-plan", "modelID": "glm-5.1" }
    }
  }
}
```

**助手消息创建时（role=assistant，无 finish）：**

用于跟踪 assistant 消息 ID，后续的 delta/part 事件需按此 ID 过滤。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "info": {
      "id": "msg_yyy",
      "parentID": "msg_xxx",
      "role": "assistant",
      "mode": "build",
      "agent": "build",
      "time": { "created": 1779939877942 },
      "sessionID": "ses_xxx"
    }
  }
}
```

**助手消息完成时（role=assistant，有 finish）：**

`finish` 字段存在表示消息生成完毕。此时应清空流式文本并从服务器加载完整消息列表。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "info": {
      "id": "msg_yyy",
      "role": "assistant",
      "finish": "stop",
      "time": { "created": 1779939877942, "completed": 1779939884514 },
      "tokens": { "total": 10711, "input": 14, "output": 9 },
      "cost": 0,
      "sessionID": "ses_xxx"
    }
  }
}
```

| info.finish | 含义 |
|---|---|
| `stop` | 正常完成 |
| `length` | 达到最大输出长度 |
| `tool-use` | 因工具调用停止 |

#### `message.part.updated`

消息的某个 part（文本段、步骤等）状态变更时推送。**注意：此事件同时覆盖用户消息和助手消息的 part**，需通过 `part.messageID` 过滤。

**用户消息的 text part：**

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_xxx",
      "type": "text",
      "text": "用户输入的内容",
      "messageID": "msg_user",
      "sessionID": "ses_xxx"
    },
    "time": 1779939877890
  }
}
```

**助手消息的 step-start part：**

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_yyy",
      "type": "step-start",
      "messageID": "msg_assistant",
      "sessionID": "ses_xxx"
    },
    "time": 1779939884414
  }
}
```

**助手消息的 text part（带完整文本，生成结束时）：**

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_zzz",
      "type": "text",
      "text": "Hello! Nice to meet you.",
      "messageID": "msg_assistant",
      "sessionID": "ses_xxx",
      "time": { "start": 1779939884416, "end": 1779939884506 }
    },
    "time": 1779939884506
  }
}
```

**助手消息的 step-finish part（生成步骤完成）：**

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "part": {
      "id": "prt_www",
      "type": "step-finish",
      "reason": "stop",
      "messageID": "msg_assistant",
      "sessionID": "ses_xxx",
      "tokens": { "total": 10711, "input": 14, "output": 9, "reasoning": 0, "cache": { "write": 0, "read": 10688 } },
      "cost": 0
    },
    "time": 1779939884510
  }
}
```

| part.type | 含义 |
|---|---|
| `text` | 文本内容 |
| `step-start` | 步骤开始标记 |
| `step-finish` | 步骤结束标记，含 token 统计 |
| `tool-invocation` | 工具调用（如有） |

#### `message.part.delta` ⭐ 流式核心

**流式文本的核心事件**。AI 生成过程中逐 token 推送，用于实现打字机效果。

**必须通过 `messageID` 过滤**，确保只处理属于 assistant 消息的 delta，否则用户消息的 part 也会触发。

```json
{
  "properties": {
    "sessionID": "ses_xxx",
    "messageID": "msg_assistant",
    "partID": "prt_zzz",
    "field": "text",
    "delta": "Hello"
  }
}
```

| 字段 | 含义 |
|---|---|
| `messageID` | 所属消息 ID，用于过滤 assistant 消息 |
| `partID` | 所属 part ID |
| `field` | 变更的字段名，通常为 `"text"` |
| `delta` | 增量文本片段，如 `"Hello"`、`"!"`、`" Nice"` |

---

## 典型事件时序

发送一条消息后，SSE 事件按以下顺序到达：

```
1. message.updated          → role=user（用户消息创建）
2. message.part.updated     → 用户 text part
3. session.updated          → 会话信息更新
4. session.status           → status=busy（开始生成）
5. message.updated          → role=assistant（助手消息创建，无 finish）
6. session.updated          → 会话信息更新
7. session.status           → status=busy
8. session.diff             → 文件变更（如有）
9. message.updated          → 用户消息摘要更新
10. message.part.updated    → step-start（步骤开始）
11. message.part.updated    → text part（空文本，生成开始）
12. message.part.delta      → "Hello"          ⭐ 流式开始
13. message.part.delta      → "!"
14. message.part.delta      → " Nice"
15. message.part.delta      → " to"
16. message.part.delta      → " meet"
17. message.part.delta      → " you"
18. message.part.delta      → "."
19. message.part.updated    → text part（完整文本）⭐ 流式结束
20. message.part.updated    → step-finish（含 token 统计）
21. message.updated         → role=assistant, finish=stop ⭐ 消息完成
22. message.updated         → 重复的完成通知
23. session.status          → status=busy
24. session.status          → status=idle
25. session.idle            → 会话空闲
26. session.updated         → 最终会话状态
27. session.diff            → 最终 diff
28. message.updated         → 用户消息最终状态
29. server.heartbeat        → 心跳（持续）
```

---

## 前端处理要点

1. **跟踪 assistant 消息 ID**：从 `message.updated`（role=assistant，无 finish）中获取 `info.id`，后续只处理 `messageID` 匹配的 delta 和 part 事件
2. **delta 追加而非替换**：`message.part.delta` 的 `delta` 字段是增量文本，需追加到现有流式文本
3. **完成时刷新**：收到 `message.updated`（role=assistant + finish）或 `session.idle` 后，清空流式文本并从服务器加载完整消息列表
4. **忽略不相关事件**：`server.connected`、`server.heartbeat`、`session.diff` 等事件对聊天 UI 无直接影响，可安全忽略
5. **避免乐观消息重复**：用户发送后可立即显示乐观消息，AI 完成后 `loadMessages` 整体替换会自动消除乐观消息
