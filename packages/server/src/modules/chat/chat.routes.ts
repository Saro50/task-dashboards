import Router from 'koa-router';
import * as ChatController from './chat.controller.js';

const router = new Router({ prefix: '/api/chat' });

router.get('/sessions', ChatController.listSessions);
router.post('/sessions', ChatController.createSession);
router.patch('/sessions/:id', ChatController.updateSession);
router.delete('/sessions/:id', ChatController.deleteSession);
router.get('/sessions/:id/messages', ChatController.getMessages);
router.post('/sessions/:id/send', ChatController.sendMessage);
router.post('/sessions/:id/abort', ChatController.abortSession);
router.get('/events', ChatController.subscribeEvents);
router.post('/log', ChatController.clientLog);

export default router;
