/**
 * Mock AI 引擎
 * 模拟 AI 响应，延迟返回预设中文文本
 */

const MockAI = (() => {
  // ====================
  // 预设回复模板
  // ====================

  const generalResponses = [
    '我理解你的需求。根据你的描述，我建议从以下几个方面来考虑：\n\n1. **明确目标** — 确定项目的核心价值和交付标准\n2. **拆分任务** — 将复杂需求分解为可独立执行的小任务\n3. **制定计划** — 按照依赖关系安排执行顺序\n\n请问你想从哪个方面开始深入讨论？',

    '这是一个很好的想法！让我帮你梳理一下思路。\n\n根据我的分析，这个需求可以拆解为以下几个关键步骤：\n\n- 首先，需要搭建基础项目结构\n- 其次，实现核心业务逻辑\n- 最后，完善测试和文档\n\n你希望我针对某个具体步骤进行展开吗？',

    '收到你的指令。我正在分析需求...\n\n经过分析，我认为当前需求的核心挑战在于：\n\n1. **架构设计** — 需要保证模块之间的低耦合、高内聚\n2. **数据管理** — 合理的数据流和状态管理方案\n3. **用户体验** — 交互流程需要直观且高效\n\n建议我们先确定技术选型，再逐步推进。你觉得怎么样？',

    '好的，让我来帮你规划一下。\n\n基于你的需求，我推荐以下工作流程：\n\n📌 **第一步：需求确认**\n明确功能范围和优先级，排除模糊地带\n\n📌 **第二步：技术方案**\n选择合适的技术栈和架构模式\n\n📌 **第三步：迭代开发**\n按模块逐步实现，每一步都可验证\n\n需要我针对某个环节给出更详细的方案吗？',
  ];

  // 任务步骤模板
  const taskPlanTemplates = {
    default: [
      {
        id: 'task-1',
        title: '环境搭建与项目初始化',
        description: '创建项目目录结构，配置开发环境，初始化基础配置文件。',
        status: 'pending',
        dependencies: [],
      },
      {
        id: 'task-2',
        title: '核心模块开发',
        description: '实现项目核心业务逻辑，包括数据模型定义和主要功能接口。',
        status: 'pending',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        title: '用户界面搭建',
        description: '构建用户交互界面，完成页面布局和组件开发。',
        status: 'pending',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        title: '功能集成与联调',
        description: '将各模块进行集成，完成接口联调和功能验证。',
        status: 'pending',
        dependencies: ['task-2', 'task-3'],
      },
      {
        id: 'task-5',
        title: '测试与优化',
        description: '编写测试用例，执行全面测试，修复问题并优化性能。',
        status: 'pending',
        dependencies: ['task-4'],
      },
      {
        id: 'task-6',
        title: '文档编写与部署',
        description: '完善项目文档，配置部署流程，发布上线。',
        status: 'pending',
        dependencies: ['task-5'],
      },
    ],
    web: [
      {
        id: 'task-1',
        title: '项目脚手架搭建',
        description: '使用脚手架工具初始化前端项目，配置 TypeScript、ESLint 等基础工具链。',
        status: 'pending',
        dependencies: [],
      },
      {
        id: 'task-2',
        title: '页面路由与布局',
        description: '设计页面路由结构，搭建全局布局组件（导航栏、侧边栏、内容区）。',
        status: 'pending',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        title: '数据层与状态管理',
        description: '实现 API 请求封装，配置状态管理方案，定义数据模型。',
        status: 'pending',
        dependencies: ['task-1'],
      },
      {
        id: 'task-4',
        title: '核心页面开发',
        description: '实现主要业务页面，包括列表页、详情页、表单页等核心视图。',
        status: 'pending',
        dependencies: ['task-2', 'task-3'],
      },
      {
        id: 'task-5',
        title: '交互优化与响应式适配',
        description: '优化交互动画，确保各屏幕尺寸下的响应式显示效果。',
        status: 'pending',
        dependencies: ['task-4'],
      },
      {
        id: 'task-6',
        title: '联调、测试与上线',
        description: '与后端接口联调，执行 E2E 测试，配置 CI/CD 流水线并部署。',
        status: 'pending',
        dependencies: ['task-5'],
      },
    ],
  };

  // ====================
  // 工具函数
  // ====================

  /**
   * 生成随机延迟 (ms)
   * @param {number} min - 最小延迟
   * @param {number} max - 最大延迟
   * @returns {number}
   */
  function randomDelay(min = 1000, max = 2000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 模拟异步延迟
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 从数组中随机选择一项
   */
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ====================
  // 公开 API
  // ====================

  return {
    /**
     * simulateAIResponse — 模拟 AI 回复
     * 根据用户输入的 prompt，延迟 1-2 秒返回模拟的 AI 回复文本
     *
     * @param {string} prompt - 用户输入的提示文本
     * @returns {Promise<string>} AI 回复内容
     */
    async simulateAIResponse(prompt) {
      await sleep(randomDelay(1000, 2000));

      // 根据关键词选择更贴合的回复
      const lowerPrompt = (prompt || '').toLowerCase();

      if (lowerPrompt.includes('任务') || lowerPrompt.includes('计划') || lowerPrompt.includes('规划')) {
        return '好的，让我来帮你分析任务需求并制定执行计划。\n\n基于你的描述，我建议按以下方式推进：\n\n**阶段一：需求分析** 🔍\n- 梳理核心功能点和边界条件\n- 确定技术约束和依赖关系\n\n**阶段二：方案设计** 📐\n- 确定技术架构和模块划分\n- 设计数据流和接口规范\n\n**阶段三：迭代实现** 🚀\n- 按优先级逐步开发各模块\n- 每个迭代完成后进行验证\n\n你可以在任务图谱中查看详细的步骤依赖关系。需要我生成具体的任务计划吗？';
      }

      if (lowerPrompt.includes('创建') || lowerPrompt.includes('新建') || lowerPrompt.includes('初始化')) {
        return '明白了，你想要创建一个新的项目。\n\n请提供以下信息，我来帮你完成初始化：\n\n1. **项目名称** — 用于目录名和仓库标识\n2. **项目描述** — 简要说明项目的用途和目标\n3. **目标路径** — 项目创建的目录位置\n\n有了这些信息后，我会：\n- 在指定目录创建项目结构\n- 初始化 Git 仓库\n- 生成初始 README.md 文件\n\n请告诉我项目的详细信息吧！';
      }

      if (lowerPrompt.includes('问题') || lowerPrompt.includes('bug') || lowerPrompt.includes('错误')) {
        return '让我来帮你排查问题。\n\n首先，请确认以下几个关键点：\n\n1. **错误信息** — 是否有具体的报错日志？\n2. **复现步骤** — 问题是否可以稳定复现？\n3. **环境信息** — 运行环境（系统、版本）是什么？\n\n常见的排查思路：\n- 检查最近的代码变更\n- 验证输入数据是否符合预期\n- 查看相关日志和堆栈信息\n- 尝试最小化复现条件\n\n请提供更多细节，我会给出更精准的建议。';
      }

      // 默认回复
      return pickRandom(generalResponses);
    },

    /**
     * generateTaskPlan — 模拟生成任务步骤路线
     * 根据项目描述生成带依赖关系的任务列表
     *
     * @param {string} description - 项目描述
     * @returns {Promise<Object>} 任务计划，包含标题、摘要和任务步骤数组
     */
    async generateTaskPlan(description) {
      await sleep(randomDelay(1500, 2500));

      const desc = (description || '').toLowerCase();
      let tasks;

      if (desc.includes('web') || desc.includes('前端') || desc.includes('页面') || desc.includes('网站')) {
        tasks = taskPlanTemplates.web;
      } else {
        tasks = taskPlanTemplates.default;
      }

      // 深拷贝并添加时间戳
      const planTasks = tasks.map((t) => ({
        ...t,
        id: t.id + '-' + Date.now(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      }));

      return {
        title: '项目任务实施计划',
        summary: `基于「${description || '未命名项目'}」的需求描述，共拆解为 ${planTasks.length} 个任务步骤，请查看下方任务图谱了解依赖关系。`,
        tasks: planTasks,
      };
    },

    /**
     * generateREADME — 模拟生成 README 内容
     * 根据项目名称和描述生成 README.md 的内容
     *
     * @param {string} name - 项目名称
     * @param {string} description - 项目描述
     * @returns {Promise<string>} README 文件内容
     */
    async generateREADME(name, description) {
      await sleep(randomDelay(1500, 2500));

      const projectName = name || '未命名项目';
      const projectDesc = description || '暂无描述';
      const date = new Date().toLocaleDateString('zh-CN');

      return `# ${projectName}

> ${projectDesc}

## 项目简介

${projectName} 是一个致力于提升开发效率的工具项目。

${description ? `核心目标：${description}` : '通过智能化工具链，帮助开发者更高效地完成日常工作。'}

## 功能特性

- 🚀 **快速初始化** — 一键创建项目结构
- 🤖 **AI 辅助** — 智能生成代码和文档
- 📋 **任务管理** — 可视化任务图谱与依赖追踪
- 🔄 **自动集成** — Git Worktree 隔离与自动提交流程

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- Git >= 2.20.0

### 安装

\	\	\	bash
git clone <repository-url>
cd ${projectName.toLowerCase().replace(/\s+/g, '-')}
npm install
\	\	\	

### 使用

\	\	\	bash
npm start
\	\	\	

## 项目结构

\	\	\	
${projectName.toLowerCase().replace(/\s+/g, '-')}/
├── src/          # 源代码
├── docs/         # 项目文档
├── tests/        # 测试文件
├── package.json  # 项目配置
└── README.md     # 项目说明
\	\	\	

## 技术栈

- TypeScript
- Node.js
- Git Worktree

## 贡献指南

欢迎贡献！请阅读 [贡献指南](./CONTRIBUTING.md) 了解详情。

## 许可证

MIT License

---

*此文件由 AI 辅助生成 · ${date}*
`;
    },
  };
})();

// 支持模块化引入
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MockAI;
}
