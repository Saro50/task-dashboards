import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes.js';
// 文件搜索路由：提供 GET /api/projects/search-files，前端 @ 文件引用功能使用
import projectFileRoutes from './modules/project/project-file.routes.js';
import engineRoutes from './modules/engine/engine.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';
import taskRoutes from './modules/task/task.routes.js';
import stepRoutes from './modules/step/step.routes.js';
import idPoolRoutes from './modules/id-pool/id-pool.routes.js';
// 注册任务链执行路由：提供 POST /tasks/:id/executions（启动）、POST /executions/:id/stop（中止）、
// POST /executions/:id/merge（合并）等端点，前端通过这些接口控制 worktree 隔离环境中的任务链执行
import executionRoutes from './modules/execution/execution.routes.js';

const router = new Router();

router.use(projectRoutes.routes());
// 文件搜索路由需注册在 projectRoutes 之后、参数路由（如 /:id）之前，
// 以确保 /search-files 不被当作 :id 参数匹配
router.use(projectFileRoutes.routes());
router.use(engineRoutes.routes());
router.use(chatRoutes.routes());
/** ID 池接口：AI agent 调用获取预分配的 cuid 格式 ID，用于 step-plan 中的 ref */
router.use(idPoolRoutes.routes());
for (const r of taskRoutes) {
  router.use(r.routes());
}
for (const r of stepRoutes) {
  router.use(r.routes());
}
for (const r of executionRoutes) {
  router.use(r.routes());
}

export default router;
