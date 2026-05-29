import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { AggregatedStatus } from '@/types/topic';

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

interface TopicNodeData {
  name: string;
  summary: string;
  taskCount: number;
  completedCount: number;
  aggregatedStatus: AggregatedStatus;
}

export default function TopicNode({ data, selected }: NodeProps) {
  const d = data as unknown as TopicNodeData;
  const cfg = statusConfig[d.aggregatedStatus];
  const progress = d.taskCount > 0 ? Math.round((d.completedCount / d.taskCount) * 100) : 0;

  return (
    <div
      className={`bg-white border ${cfg.border} rounded-lg shadow-sm w-72 overflow-hidden transition-shadow ${selected ? 'shadow-md ring-2 ring-sky-400' : 'hover:shadow-md'}`}
    >
      <div className={`h-1.5 ${cfg.bar}`} />
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-400 !border-0" />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-sm font-semibold text-gray-800 truncate flex-1 mr-2">{d.name}</h4>
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${cfg.text} border ${cfg.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {statusLabels[d.aggregatedStatus]}
          </span>
        </div>
        {d.summary && (
          <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-2">{d.summary}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] text-gray-400 shrink-0">{d.completedCount}/{d.taskCount}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-400 !border-0" />
    </div>
  );
}
