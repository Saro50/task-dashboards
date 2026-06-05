import { useCallback } from 'react';
import { log } from '@/utils/log';
import { useToast } from '@/components/Toast';
import ExecutionPanel from '@/components/ExecutionPanel';

export type EngineStatus = 'connected' | 'disconnected' | 'error';

interface Props {
  children: React.ReactNode;
  onOpenEngineConfig: () => void;
  engineStatus: EngineStatus;
  /**
   * 项目级最大并发主题数，由 App 顶层 useConcurrencySetting 提供。
   * 上下游影响：Layout 顶部菜单展示并修改；调用 executionApi.start 时透传给后端，
   * 限制同项目下可并行运行的任务链条数。
   */
  maxConcurrency: number;
  onMaxConcurrencyChange: (v: number) => void;
}

const statusDot: Record<EngineStatus, { color: string; title: string }> = {
  connected: { color: 'bg-green-400', title: '引擎已连接' },
  disconnected: { color: 'bg-gray-400', title: '引擎未配置' },
  error: { color: 'bg-red-400', title: '引擎连接失败' },
};

export default function Layout({ children, onOpenEngineConfig, engineStatus, maxConcurrency, onMaxConcurrencyChange }: Props) {
  const dot = statusDot[engineStatus];
  const { showToast } = useToast();

  const handleFeedback = useCallback(async () => {
    log.info('Layout', 'feedback clicked', { logCount: log.getHistory().length });
    const text = log.getHistoryText();
    if (!text) {
      showToast('暂无运行日志', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${log.getHistory().length} 条日志到剪贴板`, 'success');
    } catch {
      showToast('复制失败，请检查浏览器权限', 'error');
    }
  }, [showToast]);

  return (
    <div className="bg-white text-gray-800 min-h-screen">
      <nav className="bg-white sticky top-0 z-50 h-14 flex items-center px-4 sm:px-6 border-b border-gray-200">
        <div className="flex items-center gap-2 text-lg font-bold text-gray-800">
          <img src="/starboard.svg" alt="AICodeAgent" className="h-8" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ExecutionPanel maxConcurrency={maxConcurrency} />
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-500">最大并发</span>
            <select
              value={maxConcurrency}
              onChange={(e) => onMaxConcurrencyChange(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-md px-1.5 py-1 bg-white text-gray-700 outline-none focus:border-sky-400 cursor-pointer"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleFeedback}
            title="复制运行日志"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            <span className="hidden sm:inline">反馈</span>
          </button>
          <div className="flex items-center gap-1.5">
            <span title={dot.title} className={`inline-block w-2 h-2 rounded-full ${dot.color} shrink-0`} />
            <button
              onClick={onOpenEngineConfig}
              className="text-sm text-gray-600 hover:text-gray-800 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">引擎配置</span>
            </button>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
