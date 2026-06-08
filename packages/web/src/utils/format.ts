/**
 * 通用格式化工具函数。
 *
 * 抽取自 AIChatWidget，供 TopicNode、AIChatWidget 等组件复用。
 */

/** 格式化 token 数量：>=1000 显示为 x.xk */
export function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
