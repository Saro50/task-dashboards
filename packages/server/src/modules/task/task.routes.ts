import Router from 'koa-router';
import * as TaskController from './task.controller.js';

const projectRouter = new Router({ prefix: '/api/projects/:projectId/tasks' });
const taskRouter = new Router({ prefix: '/api/tasks' });
const topicTaskRouter = new Router({ prefix: '/api/topics/:topicId/tasks' });

projectRouter.get('/', TaskController.list);
projectRouter.post('/import', TaskController.importTaskPlan);
projectRouter.post('/', TaskController.createTask);

topicTaskRouter.get('/', TaskController.listByTopic);

taskRouter.put('/:taskId', TaskController.updateTask);
taskRouter.del('/:taskId', TaskController.deleteTask);
taskRouter.post('/:taskId/dependencies', TaskController.addDependency);
taskRouter.del('/:taskId/dependencies/:depId', TaskController.removeDependency);

export default [projectRouter, taskRouter, topicTaskRouter];
