import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes';
import engineRoutes from './modules/engine/engine.routes';
import chatRoutes from './modules/chat/chat.routes';

const router = new Router();

router.use(projectRoutes.routes());
router.use(engineRoutes.routes());
router.use(chatRoutes.routes());

export default router;
