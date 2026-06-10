import { useState } from 'react';

/**
 * 全局"最大并发任务数"设置 hook。
 *
 * 上下游影响：
 *   - 上游：App.tsx 持有唯一实例，刷新页面后回到默认值（按需求暂不持久化）。
 *   - 下游：Layout 顶部菜单读取展示并修改；StepGraphPage 在调用 executeChain 时
 *     通过 useTaskExecution options 传入，最终经 executionApi.start 发送到后端，
 *     用于限制同项目下可并行运行的任务链条数。
 */
export function useConcurrencySetting() {
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  return { maxConcurrency, setMaxConcurrency };
}
