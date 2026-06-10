import Router from 'koa-router';
import * as TaskController from './task.controller.js';

const router = new Router({ prefix: '/api/projects/:projectId/tasks' });

router.get('/', TaskController.list);
router.post('/', TaskController.create);

const taskRouter = new Router({ prefix: '/api/tasks' });
taskRouter.put('/:taskId', TaskController.update);
taskRouter.del('/:taskId', TaskController.remove);

export default [router, taskRouter];
