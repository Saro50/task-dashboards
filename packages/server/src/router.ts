import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes.js';
import engineRoutes from './modules/engine/engine.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';
import taskRoutes from './modules/task/task.routes.js';
import topicRoutes from './modules/topic/topic.routes.js';
// 注册任务链执行路由：提供 POST /topics/:id/executions（启动）、POST /executions/:id/stop（中止）、
// POST /executions/:id/merge（合并）等端点，前端通过这些接口控制 worktree 隔离环境中的任务链执行
import executionRoutes from './modules/execution/execution.routes.js';

const router = new Router();

router.use(projectRoutes.routes());
router.use(engineRoutes.routes());
router.use(chatRoutes.routes());
for (const r of taskRoutes) {
  router.use(r.routes());
}
for (const r of topicRoutes) {
  router.use(r.routes());
}
for (const r of executionRoutes) {
  router.use(r.routes());
}

export default router;
