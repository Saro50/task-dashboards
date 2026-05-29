import { memo } from 'react';
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
  depCount: number;
  selected?: boolean;
  disabled?: boolean;
}

export default memo(function TaskNode({ data, selected }: NodeProps) {
  const d = data as unknown as TaskNodeData;
  const cfg = statusColors[d.status];
  const connectable = !d.disabled;

  return (
    <div
      className={`${cfg.bg} border ${cfg.border} rounded-lg shadow-sm w-60 overflow-hidden transition-shadow group ${selected ? 'shadow-md ring-2 ring-sky-400' : 'hover:shadow-md'}`}
    >
      <div className={`h-1 ${cfg.bar}`} />
      <Handle type="target" position={Position.Top} isConnectable={connectable} className="!w-2.5 !h-2.5 !bg-gray-400 !border-2 !border-white hover:!bg-sky-500 hover:!w-3.5 hover:!h-3.5 !transition-all !-top-1.5" />
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium text-gray-800 truncate flex-1 mr-2">{d.title}</h4>
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {statusLabels[d.status]}
          </span>
        </div>
        {d.description && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{d.description}</p>
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
