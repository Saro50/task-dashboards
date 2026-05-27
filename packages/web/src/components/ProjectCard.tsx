import type { Project, ProjectStatus } from '@/types/project';

const statusConfig: Record<ProjectStatus, { label: string; bg: string; text: string }> = {
  ACTIVE: { label: '活跃', bg: 'bg-blue-500/15', text: 'text-blue-400' },
  ARCHIVED: { label: '已归档', bg: 'bg-gray-500/15', text: 'text-gray-400' },
};

function relativeTime(date: string): string {
  const now = Date.now();
  const target = new Date(date).getTime();
  const diff = now - target;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  return new Date(date).toLocaleDateString('zh-CN');
}

function truncate(str: string, max = 80): string {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max) + '…';
}

interface Props {
  project: Project;
  onEdit: (project: Project) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
}

export default function ProjectCard({ project, onEdit, onDelete, onStatusChange }: Props) {
  const cfg = statusConfig[project.status];

  return (
    <div className="bg-dark-200 border border-gray-700 rounded-2xl p-5 hover:border-primary-500/50 transition-all group flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">📂</span>
          <h3 className="font-bold text-white text-sm truncate">{project.name}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed mb-4 flex-1">
        {truncate(project.description || '暂无描述')}
      </p>

      <div className="flex items-center justify-between pt-3 border-t border-gray-700/50">
        <span className="text-xs text-gray-600">{relativeTime(project.createdAt)}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onEdit(project)}
            className="text-xs text-gray-400 hover:text-primary-300 bg-gray-700/50 hover:bg-gray-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            编辑
          </button>
          {project.status === 'ACTIVE' ? (
            <button
              onClick={() => onStatusChange(project.id, 'ARCHIVED')}
              className="text-xs text-gray-400 hover:text-gray-300 bg-gray-700/50 hover:bg-gray-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
            >
              归档
            </button>
          ) : (
            <button
              onClick={() => onStatusChange(project.id, 'ACTIVE')}
              className="text-xs text-gray-400 hover:text-blue-300 bg-gray-700/50 hover:bg-gray-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
            >
              恢复
            </button>
          )}
          <button
            onClick={() => onDelete(project.id)}
            className="p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="删除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
