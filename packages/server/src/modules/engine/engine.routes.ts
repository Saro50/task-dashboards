import Router from 'koa-router';
import * as EngineController from './engine.controller.js';

const router = new Router({ prefix: '/api/engine' });

router.get('/health', EngineController.healthCheck);
router.get('/agents', EngineController.listAgents);
router.get('/providers', EngineController.listProviders);
router.get('/opencode-config', EngineController.getOpencodeConfig);

router.get('/config', EngineController.getConfig);
router.put('/config', EngineController.upsertConfig);
router.del('/config', EngineController.removeConfig);

export default router;
