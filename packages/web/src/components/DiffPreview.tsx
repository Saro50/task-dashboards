import { useState, useEffect } from 'react';
import type { FileDiff } from '@/types/execution';
import { executionApi } from '@/api/execution';
import { log } from '@/utils/log';

const S = 'DiffPreview';

interface Props {
  executionId: string;
  completedTasks: number;
  totalTasks: number;
  onConfirm: () => void;
  onClose: () => void;
}

const statusLabel: Record<string, { text: string; color: string }> = {
  added: { text: 'A', color: 'text-green-600 bg-green-50' },
  deleted: { text: 'D', color: 'text-red-600 bg-red-50' },
  modified: { text: 'M', color: 'text-amber-600 bg-amber-50' },
};

export default function DiffPreview({ executionId, completedTasks, totalTasks, onConfirm, onClose }: Props) {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    executionApi
      .getDiff(executionId)
      .then((res) => {
        if (!cancelled) {
          setDiffs(res.diffs ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          log.error(S, 'getDiff error', err);
          setError(err.message ?? '获取变更失败');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  const totalAdditions = diffs.reduce((s, d) => s + (d.additions ?? 0), 0);
  const totalDeletions = diffs.reduce((s, d) => s + (d.deletions ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 shrink-0">
          <h3 className="text-lg font-semibold text-gray-800">变更预览</h3>
          <p className="text-sm text-gray-500 mt-1">
            任务链已执行完毕（{completedTasks}/{totalTasks}），共 {diffs.length} 个文件变更
            {diffs.length > 0 && (
              <span className="ml-2">
                <span className="text-green-600">+{totalAdditions}</span>
                {' / '}
                <span className="text-red-600">-{totalDeletions}</span>
              </span>
            )}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
              <span className="ml-3 text-sm text-gray-500">加载变更中...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-500 text-sm">{error}</p>
              <button
                onClick={onClose}
                className="mt-3 text-sm text-sky-500 hover:text-sky-600 cursor-pointer"
              >
                关闭
              </button>
            </div>
          )}

          {!loading && !error && diffs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm">暂无文件变更</p>
            </div>
          )}

          {!loading && !error && diffs.length > 0 && (
            <div className="space-y-1">
              {diffs.map((d) => {
                const st = statusLabel[d.status ?? 'modified'] ?? statusLabel.modified;
                const isExpanded = expandedFile === d.file;

                return (
                  <div key={d.file} className="rounded-lg border border-gray-100 overflow-hidden">
                    <button
                      onClick={() => setExpandedFile(isExpanded ? null : d.file)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${st.color}`}>
                        {st.text}
                      </span>
                      <span className="text-sm font-mono text-gray-700 flex-1 truncate">
                        {d.file}
                      </span>
                      <span className="text-xs tabular-nums">
                        <span className="text-green-600">+{d.additions ?? 0}</span>
                        <span className="text-gray-300 mx-0.5">/</span>
                        <span className="text-red-600">-{d.deletions ?? 0}</span>
                      </span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isExpanded && d.patch && (
                      <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 max-h-64 overflow-y-auto">
                        <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {d.patch.split('\n').map((line, i) => {
                            if (line.startsWith('+')) {
                              return (
                                <div key={i} className="bg-green-50 text-green-800">
                                  {line}
                                </div>
                              );
                            }
                            if (line.startsWith('-')) {
                              return (
                                <div key={i} className="bg-red-50 text-red-800">
                                  {line}
                                </div>
                              );
                            }
                            return (
                              <div key={i} className="text-gray-600">
                                {line}
                              </div>
                            );
                          })}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !!error}
            className="px-4 py-2 text-sm bg-sky-500 hover:bg-sky-600 text-white rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认合并
          </button>
        </div>
      </div>
    </div>
  );
}
