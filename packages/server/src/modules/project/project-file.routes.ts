import Router from 'koa-router';
import * as ProjectFileController from './project-file.controller.js';

/**
 * 文件搜索路由
 *
 * 路由前缀：/api/projects
 * 上游：由 router.ts 统一挂载，前端 @ 文件搜索功能调用
 * 下游：委托 project-file.controller 处理请求
 */
const router = new Router({ prefix: '/api/projects' });

router.get('/search-files', ProjectFileController.searchFilesHandler);

export default router;
