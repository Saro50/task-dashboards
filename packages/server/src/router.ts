import Router from 'koa-router';
import projectRoutes from './modules/project/project.routes';

const router = new Router();

router.use(projectRoutes.routes());

export default router;
