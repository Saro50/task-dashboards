import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes.js';
import engineRoutes from './modules/engine/engine.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';

const router = new Router();

router.use(projectRoutes.routes());
router.use(engineRoutes.routes());
router.use(chatRoutes.routes());

export default router;
