/**
 * 任务链执行路由定义。
 *
 * 拆分为四个路由器：
 * - router:         挂载在 /api/tasks/:taskId/executions 下，包含启动、查询状态、列出执行
 * - executionRouter: 挂载在 /api/executions/:executionId 下，包含停止和合并操作
 * - stepRouter:     挂载在 /api/steps/:stepId 下，包含单个步骤的 diff 和 messages
 *
 * 导出为数组，在 router.ts 中遍历注册。
 */
import Router from 'koa-router';
import * as Controller from './execution.controller.js';

const router = new Router({ prefix: '/api/tasks/:taskId/executions' });

router.post('/', Controller.start);
router.get('/latest', Controller.status);
router.get('/', Controller.list);

const executionRouter = new Router({ prefix: '/api/executions/:executionId' });

executionRouter.post('/stop', Controller.stop);
executionRouter.post('/merge', Controller.merge);
executionRouter.get('/branches', Controller.branches);
executionRouter.get('/diff', Controller.diff);
executionRouter.get('/messages', Controller.messages);

const projectRouter = new Router({ prefix: '/api/projects/:projectId/executions' });

projectRouter.get('/active', Controller.activeByProject);

const stepRouter = new Router({ prefix: '/api/steps/:stepId' });

stepRouter.get('/diff', Controller.stepDiff);
stepRouter.get('/messages', Controller.stepMessages);

export default [router, executionRouter, projectRouter, stepRouter];
