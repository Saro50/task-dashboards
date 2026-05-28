import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes';
import engineRoutes from './modules/engine/engine.routes';

const router = new Router();

router.use(projectRoutes.routes());
router.use(engineRoutes.routes());

export default router;
