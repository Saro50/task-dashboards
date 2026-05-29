# Agent 动态创建与 SDK 交互指南

## 概述

OpenCode **支持动态创建 Agent**。Agent 可以通过 CLI 命令、手动配置文件或 API 方式创建，无需重启服务即可生效。系统会从文件系统动态加载 Agent 配置，支持项目级和全局级配置。

## Agent 数据结构

```typescript
interface Agent {
  name: string              // Agent 唯一标识名
  description?: string      // 描述（何时使用此 Agent）
  mode: "subagent" | "primary" | "all"  // Agent 模式
  native?: boolean          // 是否为内置 Agent
  hidden?: boolean          // 是否在 @ 菜单中隐藏
  topP?: number            // 采样参数
  temperature?: number     // 温度参数
  color?: string           // 颜色标识
  permission: PermissionRuleset  // 权限规则
  model?: {                // 指定模型
    modelID: string
    providerID: string
  }
  variant?: string         // 模型变体
  prompt?: string          // 系统提示词
  options: Record<string, unknown>  // 自定义选项
  steps?: number           // 最大迭代次数
}
```

### Agent 模式说明

| 模式 | 说明 |
|-----|------|
| `primary` | 主 Agent，可作为默认助手使用 |
| `subagent` | 子 Agent，只能被其他 Agent 通过 Task 工具调用 |
| `all` | 既可以作为主 Agent，也可以作为子 Agent |

### 内置 Agent

| Agent | 模式 | 说明 |
|-------|------|------|
| `build` | `primary` | 默认主 Agent，执行基于配置权限的工具 |
| `plan` | `primary` | 规划模式，禁止所有编辑工具 |
| `general` | `subagent` | 通用子 Agent，用于并行执行多步骤任务 |
| `explore` | `subagent` | 代码库探索专用，只读权限 |
| `scout` | `subagent` | 文档和依赖源研究（实验性） |
| `compaction` | `primary` | 会话压缩专用（隐藏） |
| `title` | `primary` | 会话标题生成（隐藏） |
| `summary` | `primary` | 会话总结（隐藏） |

## 创建 Agent 的方式

### 方式一：CLI 命令创建（推荐）

使用 `opencode agent create` 命令交互式或命令行方式创建：

```bash
# 交互式创建
opencode agent create

# 命令行方式创建（非交互式）
opencode agent create \
  --description "前端代码审查专家，专注于 React 和 TypeScript" \
  --mode "subagent" \
  --permissions "read,grep,glob" \
  --model "anthropic/claude-sonnet-4"
```

**参数说明**：

| 参数 | 说明 |
|-----|------|
| `--path` | Agent 文件存放目录 |
| `--description` | Agent 功能描述 |
| `--mode` | Agent 模式：`all` / `primary` / `subagent` |
| `--permissions` | 权限列表，逗号分隔 |
| `--model` | 模型，格式 `provider/model` |

**可用权限**：

```
bash, read, edit, glob, grep, webfetch, task, todowrite, websearch, lsp, skill
```

### 方式二：手动创建配置文件

在 `.opencode/agents/` 或 `~/.config/opencode/agents/` 目录下创建 `.md` 文件：

```markdown
---
description: 前端代码审查专家
mode: subagent
permission:
  read: allow
  grep: allow
  glob: allow
  edit: deny
  bash: deny
---

你是一个前端代码审查专家，专注于 React 和 TypeScript 代码质量。

你的职责：
1. 检查代码是否符合最佳实践
2. 识别潜在的性能问题
3. 建议类型安全的改进方案
4. 不要修改代码，只提供审查意见
```

**配置文件结构**：
- **Frontmatter**（YAML 格式）：配置元数据
- **正文**（Markdown）：系统提示词（system prompt）

### 方式三：通过 SDK API 获取后手动创建

目前系统**不提供直接的 Agent 创建 API**，但可以通过以下流程实现程序化创建：

```typescript
// 1. 获取现有 Agent 列表作为参考
const agents = await client.app.agents()

// 2. 使用 AI 生成 Agent 配置（可选）
// 调用 LLM 生成配置内容

// 3. 将配置写入文件系统
// 写入到 .opencode/agents/{name}.md
```

## SDK 交互

### 获取 Agent 列表

```typescript
import { createClient } from "@opencode-ai/sdk/v2"

const client = createClient()

// 获取所有可用 Agent
const response = await client.app.agents({
  directory: "/path/to/project",  // 可选
  workspace: "workspace-name",     // 可选
})

if (response.data) {
  const agents = response.data
  agents.forEach((agent) => {
    console.log(`${agent.name} (${agent.mode})`)
    console.log(`  描述: ${agent.description}`)
    console.log(`  权限: ${JSON.stringify(agent.permission)}`)
  })
}
```

**API 端点**: `GET /agent`

**响应示例**:
```json
[
  {
    "name": "build",
    "description": "The default agent. Executes tools based on configured permissions.",
    "mode": "primary",
    "native": true,
    "permission": [...],
    "options": {}
  },
  {
    "name": "explore",
    "description": "Fast agent specialized for exploring codebases...",
    "mode": "subagent",
    "native": true,
    "permission": [...],
    "options": {}
  }
]
```

### 订阅 Agent 切换事件

当会话中的 Agent 发生变化时，会触发事件：

```typescript
// 订阅全局事件流
const events = await client.global.event()

for await (const event of events.stream) {
  switch (event.payload.type) {
    case "session.next.agent.switched": {
      const { sessionID, agent } = event.payload.properties
      console.log(`会话 ${sessionID} 切换到 Agent: ${agent}`)
      break
    }
  }
}
```

**事件格式**:
```json
{
  "id": "evt_xxx",
  "type": "session.next.agent.switched",
  "properties": {
    "timestamp": 1234567890,
    "sessionID": "ses_xxx",
    "agent": "explore"
  }
}
```

### 在会话中使用 Agent

#### 1. 创建会话时指定 Agent

```typescript
// 创建消息时指定 agent
const message = await client.session.message({
  sessionID: "ses_xxx",
  body: {
    agent: "explore",  // 指定使用的 Agent
    parts: [{
      type: "text",
      text: "分析项目结构"
    }]
  }
})
```

#### 2. 在提示中 @ 提及 Agent

用户可以在输入框中使用 `@agent-name` 来切换或调用特定 Agent：

```
@explore 帮我找到所有使用 useEffect 的地方
```

#### 3. 通过 Task 工具调用子 Agent

主 Agent 可以通过 `task` 工具调用子 Agent：

```typescript
// 在 tool call 中指定 subagent_type
{
  "tool": "task",
  "input": {
    "description": "代码审查",
    "prompt": "审查 src/components/Button.tsx",
    "subagent_type": "reviewer"  // 调用自定义的 reviewer Agent
  }
}
```

### 前端切换 Agent

前端提供 `agent.cycle` 命令来循环切换 Agent：

```typescript
// 执行命令切换 Agent
await client.command.execute({
  body: {
    command: "agent.cycle"  // 或 "agent.cycle.reverse"
  }
})
```

快捷键（可配置）：
- `Mod+.` - 切换到下一个 Agent
- `Mod+Shift+.` - 切换到上一个 Agent

## 配置加载机制

### 加载路径

Agent 配置从以下路径动态加载：

1. **项目级配置**: `{project}/.opencode/{agent,agents}/**/*.md`
2. **全局配置**: `~/.config/opencode/{agent,agents}/**/*.md`

### 配置合并规则

```typescript
// 1. 内置 Agent 定义（代码中硬编码）
const agents = { build, plan, general, explore, ... }

// 2. 用户配置覆盖（opencode.jsonc 中的 agent 字段）
for (const [key, value] of cfg.agent ?? {}) {
  if (value.disable) delete agents[key]
  else agents[key] = merge(agents[key], value)
}

// 3. 文件系统 Agent 定义（.md 文件）
for (const file of await Glob.scan("agents/**/*.md")) {
  const config = parseMarkdown(file)
  agents[config.name] = config
}
```

### 热加载

Agent 配置在以下时机重新加载：
- 服务启动时
- 全局配置更新时（`global.disposed` 事件）
- 实例重新初始化时

**注意**：修改 `.md` 配置文件后，需要触发配置刷新才能生效。可以通过以下方式：
1. 重启 OpenCode 服务
2. 修改 `opencode.jsonc` 触发全局刷新
3. 通过 `global.disposed` 事件触发重新加载

## 权限系统

### Agent 权限配置

```yaml
---
permission:
  # 允许所有工具
  "*": allow
  
  # 禁止特定工具
  edit: deny
  
  # 文件级权限
  read:
    "*": allow
    "*.env": ask      # .env 文件需要询问
    "*.env.*": ask
    "*.env.example": allow
  
  # 外部目录权限
  external_directory:
    "*": ask
    
  # 自定义权限
  doom_loop: ask
  question: deny
---
```

### 权限继承

子 Agent 会话继承父会话的权限：

```typescript
const permissions = deriveSubagentSessionPermission({
  parentSessionPermission: parent.permission ?? [],
  parentAgent,
  subagent: next,
})
```

## 最佳实践

### 1. Agent 命名规范

- 使用小写字母和连字符：`code-reviewer`, `docs-writer`
- 避免与内置 Agent 重名：`build`, `plan`, `general`, `explore`
- 名称应反映 Agent 的核心功能

### 2. 权限最小化原则

```yaml
# 好的做法：只授予必要的权限
permission:
  read: allow
  grep: allow
  edit: deny    # 明确禁止编辑

# 避免：授予过多权限
permission:
  "*": allow    # 危险！允许所有操作
```

### 3. 子 Agent 设计

- **单一职责**：每个子 Agent 专注于一个特定任务
- **明确边界**：通过权限限制操作范围
- **描述清晰**：description 字段说明何时使用此 Agent

### 4. 示例：代码审查 Agent

```markdown
---
description: 专注于代码质量和最佳实践的审查 Agent
mode: subagent
permission:
  read: allow
  grep: allow
  glob: allow
  bash: deny
  edit: deny
  websearch: allow
hidden: false
---

你是一个严格的代码审查专家。你的职责：

1. **安全性**：检查潜在的安全漏洞（SQL 注入、XSS、路径遍历等）
2. **性能**：识别性能瓶颈和低效算法
3. **可维护性**：评估代码可读性和模块化程度
4. **类型安全**：检查 TypeScript 类型定义是否完整

**重要约束**：
- 不要修改任何代码文件
- 提供具体的改进建议，包含代码示例
- 区分 "必须修复" 和 "建议优化"
```

## 相关文件

- `packages/opencode/src/agent/agent.ts` - Agent 服务核心实现
- `packages/opencode/src/cli/cmd/agent.ts` - CLI Agent 管理命令
- `packages/opencode/src/config/agent.ts` - Agent 配置解析
- `packages/sdk/js/src/v2/gen/sdk.gen.ts` - SDK API 定义
- `packages/sdk/js/src/v2/gen/types.gen.ts` - Agent 类型定义
- `packages/app/src/context/local.tsx` - 前端 Agent 状态管理
- `packages/app/src/components/prompt-input.tsx` - Agent 选择 UI
