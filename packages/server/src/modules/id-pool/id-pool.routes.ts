import Router from 'koa-router';
import * as IdPoolController from './id-pool.controller.js';

/**
 * ID 池路由 — 挂载在 /api/id-pool。
 *
 * 上下游影响：
 * - 上游：由 router.ts 统一挂载。
 * - 下游：AI agent 通过 GET /api/id-pool?count=N 获取预分配 ID。
 */
const router = new Router({ prefix: '/api/id-pool' });

router.get('/', IdPoolController.generate);

export default router;
