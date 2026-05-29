import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes.js';
import engineRoutes from './modules/engine/engine.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';
import taskRoutes from './modules/task/task.routes.js';
import topicRoutes from './modules/topic/topic.routes.js';

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

export default router;
