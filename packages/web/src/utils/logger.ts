/**
 * 日志 SDK 初始化模块。
 *
 * 在 main.tsx 中 import 本模块即可触发初始化（副作用导入）。
 * 初始化后 Logger 自动捕获异常、请求、路由、点击等事件，
 * 并通过 /api/logs 批量上报到 log-server（localhost:3101）。
 *
 * 使用方式：
 * ```ts
 * import { logger } from '@/utils/logger';
 * logger.track('task_created', { taskId: 'xxx' });
 * logger.error('请求失败', { status: 500 });
 * ```
 */
import { Logger } from '@myby/log-sdk';

Logger.init({
  endpoint: '/api/logs',
  appName: 'task-dashboards',
  environment: import.meta.env.MODE,
  appToken: 'task_token_12345',
  autoCapture: {
    error: true,
    promise: true,
    request: true,
    route: true,
    performance: false,
    click: true,
  },
  sampleRate: 1,
});

// 默认用户标识，后续可替换为实际登录用户
Logger.setUserId('task-dashboards-user');

export { Logger as logger };
