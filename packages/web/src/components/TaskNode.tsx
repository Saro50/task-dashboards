import { useState, memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { TaskStatus } from '@/types/task';

const statusColors: Record<TaskStatus, { bg: string; border: string; bar: string; text: string; dot: string }> = {
  PENDING: { bg: 'bg-white', border: 'border-gray-200', bar: 'bg-gray-300', text: 'text-gray-600', dot: 'bg-gray-400' },
  IN_PROGRESS: { bg: 'bg-white', border: 'border-sky-300', bar: 'bg-sky-500', text: 'text-sky-600', dot: 'bg-sky-400' },
  COMPLETED: { bg: 'bg-white', border: 'border-green-300', bar: 'bg-green-500', text: 'text-green-600', dot: 'bg-green-400' },
  BLOCKED: { bg: 'bg-white', border: 'border-red-300', bar: 'bg-red-500', text: 'text-red-600', dot: 'bg-red-400' },
};

const statusLabels: Record<TaskStatus, string> = {
  PENDING: '待办',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  BLOCKED: '已阻塞',
};

interface TaskNodeData {
  title: string;
  status: TaskStatus;
  description: string;
  blockedReason?: string | null;
  depCount: number;
  selected?: boolean;
  disabled?: boolean;
  onDelete?: (taskId: string) => void;
}

export default memo(function TaskNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as TaskNodeData;
  const cfg = statusColors[d.status];
  const connectable = !d.disabled;
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={`${cfg.bg} border ${cfg.border} rounded-lg shadow-sm w-60 overflow-hidden transition-shadow group ${selected ? 'shadow-md ring-2 ring-sky-400' : 'hover:shadow-md'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={`h-1 ${cfg.bar}`} />
      <Handle type="target" position={Position.Top} isConnectable={connectable} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white hover:!bg-sky-500 hover:!w-3.5 hover:!h-3.5 !transition-all !-top-1.5" />
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium text-gray-800 truncate flex-1 mr-2">{d.title}</h4>
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {statusLabels[d.status]}
            </span>
            {showActions && !d.disabled && d.onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); d.onDelete?.(id); }}
                className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 cursor-pointer"
                title="删除"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {d.description && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{d.description}</p>
        )}
        {d.status === 'BLOCKED' && d.blockedReason && (
          <p className="mt-1 text-[10px] text-red-500 line-clamp-1 leading-relaxed">{d.blockedReason}</p>
        )}
        {d.depCount > 0 && (
          <div className="mt-1.5 text-[10px] text-gray-400">
            {d.depCount} 个依赖
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={connectable} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white hover:!bg-sky-500 hover:!w-3.5 hover:!h-3.5 !transition-all !-bottom-1.5" />
    </div>
  );
});
