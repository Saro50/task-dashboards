import Router from 'koa-router';
import * as StepController from './step.controller.js';

const projectRouter = new Router({ prefix: '/api/projects/:projectId/steps' });
const stepRouter = new Router({ prefix: '/api/steps' });
const taskStepRouter = new Router({ prefix: '/api/tasks/:taskId/steps' });
const chatSessionRouter = new Router({ prefix: '/api/chat-sessions' });

projectRouter.get('/', StepController.list);
projectRouter.post('/import', StepController.importStepPlan);
projectRouter.post('/', StepController.createStep);

taskStepRouter.get('/', StepController.listByTask);

stepRouter.put('/:stepId', StepController.updateStep);
stepRouter.del('/:stepId', StepController.deleteStep);
stepRouter.post('/:stepId/dependencies', StepController.addDependency);
stepRouter.del('/:stepId/dependencies/:depId', StepController.removeDependency);

chatSessionRouter.get('/:sessionId/imported-plans', StepController.listImportedPlans);

export default [projectRouter, stepRouter, taskStepRouter, chatSessionRouter];
