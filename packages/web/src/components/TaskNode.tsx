import { useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { AggregatedStatus } from '@/types/task';
import { formatTokenCount } from '@/utils/format';

const statusConfig: Record<AggregatedStatus, { bar: string; border: string; text: string; dot: string }> = {
  PENDING: { bar: 'bg-gray-300', border: 'border-gray-200', text: 'text-gray-600', dot: 'bg-gray-400' },
  IN_PROGRESS: { bar: 'bg-sky-500', border: 'border-sky-300', text: 'text-sky-600', dot: 'bg-sky-400' },
  COMPLETED: { bar: 'bg-green-500', border: 'border-green-300', text: 'text-green-600', dot: 'bg-green-400' },
  BLOCKED: { bar: 'bg-red-500', border: 'border-red-300', text: 'text-red-600', dot: 'bg-red-400' },
};

const statusLabels: Record<AggregatedStatus, string> = {
  PENDING: '待办',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  BLOCKED: '已阻塞',
};

interface TaskNodeData {
  name: string;
  summary: string;
  stepCount: number;
  completedStepCount: number;
  aggregatedStatus: AggregatedStatus;
  /** 任务下所有步骤的 input token 累计 */
  tokenInput?: number;
  /** 任务下所有步骤的 output token 累计 */
  tokenOutput?: number;
  /** 任务下所有步骤的缓存命中 token 累计 */
  cacheRead?: number;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  editing?: boolean;
  editingName?: string;
  onEditingNameChange?: (name: string) => void;
  onEditingConfirm?: () => void;
  onEditingCancel?: () => void;
}

export default function TaskNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as TaskNodeData;
  const cfg = statusConfig[d.aggregatedStatus];
  const progress = d.stepCount > 0 ? Math.round((d.completedStepCount / d.stepCount) * 100) : 0;
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (d.editing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [d.editing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      d.onEditingConfirm?.();
    } else if (e.key === 'Escape') {
      d.onEditingCancel?.();
    }
  }, [d]);

  return (
    <div
      className={`bg-white border ${cfg.border} rounded-lg shadow-sm w-72 overflow-hidden transition-shadow ${selected ? 'shadow-md ring-2 ring-sky-400' : 'hover:shadow-md'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={`h-1.5 ${cfg.bar}`} />
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-400 !border-0" />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          {d.editing ? (
            <input
              ref={inputRef}
              value={d.editingName ?? d.name}
              onChange={(e) => d.onEditingNameChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => d.onEditingConfirm?.()}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-semibold text-gray-800 flex-1 mr-2 px-1 py-0 border border-sky-300 rounded outline-none focus:border-sky-500 bg-white"
            />
          ) : (
            <h4 className="text-sm font-semibold text-gray-800 truncate flex-1 mr-2">{d.name}</h4>
          )}
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${cfg.text} border ${cfg.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {statusLabels[d.aggregatedStatus]}
            </span>
            {!d.editing && showActions && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); d.onEdit?.(id); }}
                  className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
                  title="编辑"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); d.onDelete?.(id); }}
                  className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 cursor-pointer"
                  title="删除"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
        {d.summary && !d.editing && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">{d.summary}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">{d.completedStepCount}/{d.stepCount}</span>
        </div>
        {/* Token 消耗统计：仅当有实际消耗时显示 */}
        {(d.tokenInput ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-gray-400">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <span>
              <span className="text-gray-500">↑{formatTokenCount(d.tokenInput!)}</span>
              <span className="mx-0.5">·</span>
              <span className="text-gray-500">↓{formatTokenCount(d.tokenOutput!)}</span>
              {(d.cacheRead ?? 0) > 0 && (
                <>
                  <span className="mx-0.5">·</span>
                  <span className="text-amber-500">缓存:{formatTokenCount(d.cacheRead!)}</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-400 !border-0" />
    </div>
  );
}
