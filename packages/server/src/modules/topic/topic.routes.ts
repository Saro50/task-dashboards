import Router from 'koa-router';
import * as TopicController from './topic.controller.js';

const router = new Router({ prefix: '/api/projects/:projectId/topics' });

router.get('/', TopicController.list);
router.post('/', TopicController.create);

const topicRouter = new Router({ prefix: '/api/topics' });
topicRouter.put('/:topicId', TopicController.update);
topicRouter.del('/:topicId', TopicController.remove);

export default [router, topicRouter];
