import Router from 'koa-router';
import * as ProjectController from './project.controller';

const router = new Router({ prefix: '/api/projects' });

router.get('/', ProjectController.list);
router.get('/:id', ProjectController.getById);
router.post('/', ProjectController.create);
router.put('/:id', ProjectController.update);
router.del('/:id', ProjectController.remove);
router.patch('/:id/status', ProjectController.updateStatus);

export default router;
