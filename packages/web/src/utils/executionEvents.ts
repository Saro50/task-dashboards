/**
 * 执行状态事件总线 — 跨 hook 同步执行状态变更。
 *
 * 为什么需要：
 *   useActiveExecutions（ExecutionPanel 用）与 useTaskExecution（TaskGraphPage 用）
 *   是两个独立 hook，各自维护状态、各自轮询。在一个 hook 内发起的 stop/start/merge
 *   另一个 hook 无法实时感知，只能等自己的轮询周期（3s/5s）追上；
 *   更糟糕的是 useTaskExecution 在 STOPPED 后会停止轮询，外部再启动时永远感知不到。
 *
 * 解决方式：
 *   任意 hook 在用户动作（stop/start/merge）成功后 emit 事件；
 *   所有相关 hook 通过 onExecutionEvent 订阅，收到事件后立即触发自身的状态刷新。
 *   事件载荷 { type, executionId, taskId }，订阅方按 taskId 过滤。
 *
 * 不发什么：
 *   轮询被动检测到的状态变化不发事件——这些由各 hook 自己的轮询覆盖，
 *   发了反而会因为循环订阅导致重复刷新。
 */

export type ExecutionEventType = 'started' | 'stopped' | 'merged';

export interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  taskId: string;
}

const listeners = new Set<(e: ExecutionEvent) => void>();

export function emitExecutionEvent(event: ExecutionEvent): void {
  // 拷贝一份遍历，避免回调中取消订阅导致 Set 迭代异常
  Array.from(listeners).forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      // 订阅方异常不应阻断其他订阅者；调试时通过控制台观察
      // eslint-disable-next-line no-console
      console.error('[executionEvents] listener error', err);
    }
  });
}

export function onExecutionEvent(fn: (e: ExecutionEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
