import type { Task, TaskStatus } from '@/types/task';

interface Props {
  tasks: Task[];
}

const statusConfig: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: '待办', color: 'text-gray-600', bg: 'bg-gray-400' },
  IN_PROGRESS: { label: '进行中', color: 'text-sky-600', bg: 'bg-sky-500' },
  COMPLETED: { label: '已完成', color: 'text-green-600', bg: 'bg-green-500' },
  BLOCKED: { label: '已阻塞', color: 'text-red-600', bg: 'bg-red-500' },
};

export default function TaskStatusBar({ tasks }: Props) {
  const counts: Record<TaskStatus, number> = {
    PENDING: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    BLOCKED: 0,
  };
  for (const t of tasks) {
    counts[t.status]++;
  }

  const total = tasks.length;
  const completed = counts.COMPLETED;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="h-10 bg-white border-t border-gray-200 flex items-center px-4 gap-6 text-xs shrink-0">
      <span className="text-gray-500">共 {total} 个任务</span>
      <div className="flex items-center gap-3">
        {(Object.keys(statusConfig) as TaskStatus[]).map((status) => (
          <span key={status} className={`flex items-center gap-1 ${statusConfig[status].color}`}>
            <span className={`w-2 h-2 rounded-full ${statusConfig[status].bg}`} />
            {statusConfig[status].label} {counts[status]}
          </span>
        ))}
      </div>
      {total > 0 && (
        <div className="ml-auto flex items-center gap-2">
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-gray-500">{progress}%</span>
        </div>
      )}
    </div>
  );
}
