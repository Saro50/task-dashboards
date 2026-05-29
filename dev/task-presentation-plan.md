# 任务呈现模块 — 实施规划

## 本期目标

实现"任务呈现"模块：从 AI 聊天窗输出的结构化 JSON 导入任务数据，在任务图谱页面以 React Flow + dagre 展示依赖关系图，支持编辑和状态追踪。

### 用户故事

1. 用户在 AI 聊天窗讨论需求，AI 输出 `\`\`\`task-plan` 代码块
2. 前端识别 JSON，展示任务预览卡片 + "导入到项目" 按钮
3. 用户点击导入，任务写入数据库
4. 点击项目卡片进入 `/project/:projectId` 任务图谱页
5. dagre 根据依赖关系自动布局，React Flow 渲染节点和连线
6. 用户可编辑任务标题/描述/状态，管理依赖关系

---

## 技术选型

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 依赖存储 | TaskDependency 关联表 | 多对多关系，规范，支持复杂查询 |
| 路由 | react-router | 行业标准，支持嵌套路由和参数 |
| 图谱渲染 | @xyflow/react + dagre | React Flow 渲染交互，dagre 自动布局 |
| 位置存储 | 不存储，前端实时计算 | 位置是纯视觉关注点，可从图结构派生 |
| AI JSON 识别 | `\`\`\`task-plan` 代码块 + 正则 | 对 AI 自然，不侵入聊天协议 |
| 导入策略 | 每次新建一组任务 | 简单清晰，用户可在图谱页手动关联 |

---

## AI 聊天窗 → 任务呈现 JSON 协议

### 数据流

```
AI 回复文本 (```task-plan 代码块)
  → PartRenderer 正则提取 JSON
  → 渲染任务预览卡片 + "导入到项目" 按钮
  → 用户点击导入
  → POST /api/projects/:projectId/tasks/import
  → 后端写入 Task + TaskDependency
  → 任务图谱页展示
```

### AI 输出格式

AI 在 assistant 消息的 text part 中，用 `\`\`\`task-plan` 代码块包裹 JSON：

````
根据讨论，我为你规划了以下任务方案：

```task-plan
{
  "version": "1.0",
  "topic": "用户认证模块实现",
  "summary": "实现完整的用户注册、登录、鉴权功能",
  "tasks": [
    {
      "ref": "task-1",
      "title": "设计用户数据模型",
      "description": "定义 User schema，包含邮箱、密码哈希、角色等字段",
      "dependencies": []
    },
    {
      "ref": "task-2",
      "title": "实现注册接口",
      "description": "POST /api/auth/register，含参数校验和密码加密",
      "dependencies": ["task-1"]
    },
    {
      "ref": "task-3",
      "title": "实现登录接口",
      "description": "POST /api/auth/login，返回 JWT token",
      "dependencies": ["task-1"]
    },
    {
      "ref": "task-4",
      "title": "实现 JWT 鉴权中间件",
      "description": "校验 token，注入 user context",
      "dependencies": ["task-3"]
    },
    {
      "ref": "task-5",
      "title": "编写集成测试",
      "description": "覆盖注册、登录、鉴权完整流程",
      "dependencies": ["task-2", "task-3", "task-4"]
    }
  ]
}
```

以上任务可以 task-2 和 task-3 并行执行。
````

### JSON Schema（task-plan 协议体）

```typescript
interface TaskPlan {
  version: "1.0";
  topic: string;            // 任务主题
  summary: string;          // 方案概述
  tasks: TaskPlanItem[];
}

interface TaskPlanItem {
  ref: string;              // 任务引用ID（仅在本次 plan 内唯一，用于关联依赖）
  title: string;            // 任务标题
  description?: string;     // 任务描述（可选）
  dependencies?: string[];  // 依赖其他任务的 ref 列表
}
```

### 前端提取方式

正则：` /```task-plan\n([\s\S]*?)```/`

在 `PartRenderer` 的 `type === 'text'` 分支中检测，命中后渲染任务预览卡片。

### 导入请求格式

```typescript
// POST /api/projects/:projectId/tasks/import
interface ImportTaskPlanRequest {
  topic: string;
  summary: string;
  tasks: {
    ref: string;
    title: string;
    description: string;
    dependencies: string[];
  }[];
}
```

### 导入响应格式

```typescript
interface ImportTaskPlanResponse {
  imported: number;       // 成功导入的任务数
  tasks: {
    id: string;           // 数据库生成的 cuid
    ref: string;          // 原始 ref，方便前端映射
    title: string;
    status: "PENDING";
  }[];
  dependencies: number;   // 创建的依赖关系数
}
```

---

## 后端数据存储

### Prisma Schema 新增

```prisma
model Task {
  id          String     @id @default(cuid())
  projectId   String
  title       String     @db.VarChar(200)
  description String     @default("") @db.Text
  status      TaskStatus @default(PENDING)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  project     Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fromDeps    TaskDependency[] @relation("DependsOn")
  toDeps      TaskDependency[] @relation("RequiredBy")

  @@index([projectId])
  @@index([status])
}

model TaskDependency {
  id          String  @id @default(cuid())
  taskId      String
  dependsOnId String

  task        Task    @relation("DependsOn", fields: [taskId], references: [id], onDelete: Cascade)
  dependsOn   Task    @relation("RequiredBy", fields: [dependsOnId], references: [id], onDelete: Cascade)

  @@unique([taskId, dependsOnId])
  @@index([taskId])
  @@index([dependsOnId])
}

enum TaskStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  BLOCKED
}
```

Project 模型新增反向关联：

```prisma
model Project {
  // ... 现有字段不变
  tasks Task[]
}
```

### 存储设计要点

| 设计决策 | 说明 |
|----------|------|
| 关联表用独立 id | `TaskDependency` 用 `cuid()` 作主键 + `(taskId, dependsOnId)` 唯一约束 |
| Cascade 级联删除 | 删除 Task 自动清理关联依赖；删除 Project 自动清理所有下属 Task |
| 无位置字段 | 位置由前端 dagre 实时计算，不存数据库 |
| 双向关联命名 | `fromDeps` = 该任务依赖谁，`toDeps` = 谁依赖该任务 |
| 索引 | `projectId` 加速按项目查任务，`status` 加速按状态筛选 |

### API 路由

```
GET    /api/projects/:projectId/tasks              列出项目所有任务(含依赖)
POST   /api/projects/:projectId/tasks/import       从 TaskPlan JSON 批量导入
POST   /api/projects/:projectId/tasks              单个创建任务
PUT    /api/tasks/:taskId                          更新任务(标题/描述/状态)
DELETE /api/tasks/:taskId                          删除任务
POST   /api/tasks/:taskId/dependencies             添加依赖
DELETE /api/tasks/:taskId/dependencies/:depId      删除依赖
```

### GET tasks 返回格式

```json
{
  "tasks": [
    {
      "id": "clx...",
      "projectId": "clx...",
      "title": "设计用户数据模型",
      "description": "...",
      "status": "PENDING",
      "createdAt": "...",
      "updatedAt": "...",
      "dependencies": ["clx..."]
    }
  ]
}
```

### 后端模块结构

```
packages/server/src/modules/task/
├── task.routes.ts       # 路由定义
├── task.controller.ts   # 参数校验、响应格式化
├── task.service.ts      # CRUD + import + 依赖管理
└── types.ts             # 请求/响应类型
```

### Import API 写库流程

```
POST /api/projects/:projectId/tasks/import

1. 校验 projectId 存在
2. 校验 tasks 数组非空、ref 唯一、dependencies 中的 ref 都存在
3. prisma.$transaction([
     批量 create Task,
     批量 create TaskDependency (根据 ref → id 映射)
   ])
4. 返回 ImportTaskPlanResponse
```

---

## 实施步骤

### Phase 1：路由基础设施（前端）

1. `pnpm add react-router` (packages/web)
2. 改造 `App.tsx` 为 `<BrowserRouter>` 路由容器
3. 抽取项目列表为 `ProjectListPage` 组件
4. 配置路由：
   - `/` → `ProjectListPage`
   - `/project/:projectId` → `TaskGraphPage`
5. 改造 `ProjectCard` 的 `onClick`：导航到 `/project/:projectId`

### Phase 2：数据层（后端 + 前端类型）

6. Prisma Schema 新增 Task + TaskDependency + TaskStatus
7. `npx prisma migrate dev` 生成迁移
8. 后端 Task 模块 (`packages/server/src/modules/task/`)
9. 在 `router.ts` 注册 task 路由
10. 前端 `types/task.ts` + `api/task.ts` + `hooks/useTasks.ts`

### Phase 3：任务图谱页面（核心）

11. `pnpm add @xyflow/react dagre @types/dagre` (packages/web)
12. `TaskGraphPage` — `/project/:projectId` 页面容器
13. `TaskNode` — React Flow 自定义节点（状态色条 + 标题 + 依赖 badge）
14. `TaskEdge` — React Flow 自定义边（贝塞尔曲线 + 箭头 + 选中高亮）
15. dagre 自动布局（前端加载时根据依赖关系计算坐标）
16. `TaskDetailPanel` — 右侧滑出编辑面板（标题/描述/状态/依赖管理）
17. `TaskStatusBar` — 底部统计栏（各状态计数 + 进度条）
18. 新建任务：双击画布 / 工具栏按钮
19. 删除任务：编辑面板中删除按钮

### Phase 4：AI 聊天窗联动

20. `PartRenderer` 增加 task-plan 识别（正则提取 `\`\`\`task-plan` 代码块）
21. 渲染任务预览卡片（任务列表 + 依赖关系预览）
22. "导入到项目" 按钮 → 调用 import API
23. TaskGraphPage 中也渲染 `<AIChatWidget>`

---

## 文件结构预期

```
packages/server/src/modules/task/
├── task.routes.ts
├── task.controller.ts
├── task.service.ts
└── types.ts

packages/web/src/
├── App.tsx                    # 改为路由容器
├── pages/
│   ├── ProjectListPage.tsx    # 从 App.tsx 抽取
│   └── TaskGraphPage.tsx      # 任务图谱页
├── components/
│   ├── TaskNode.tsx           # React Flow 自定义节点
│   ├── TaskEdge.tsx           # React Flow 自定义边
│   ├── TaskDetailPanel.tsx    # 右侧编辑面板
│   └── TaskStatusBar.tsx      # 底部统计栏
├── hooks/
│   └── useTasks.ts
├── api/
│   └── task.ts
└── types/
    └── task.ts
```

### 执行顺序

Phase 1 → Phase 2 → Phase 3 → Phase 4，每个 Phase 内可并行开发前后端。
