import Router from 'koa-router';
import * as ChatController from './chat.controller';

const router = new Router({ prefix: '/api/chat' });

router.get('/sessions', ChatController.listSessions);
router.post('/sessions', ChatController.createSession);
router.get('/sessions/:id/messages', ChatController.getMessages);
router.post('/sessions/:id/send', ChatController.sendMessage);
router.post('/sessions/:id/abort', ChatController.abortSession);
router.get('/events', ChatController.subscribeEvents);
router.post('/log', ChatController.clientLog);

export default router;
