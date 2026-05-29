import { useNavigate } from 'react-router';
import type { Project, ProjectStatus } from '@/types/project';

const statusConfig: Record<ProjectStatus, { label: string; bg: string; text: string }> = {
  ACTIVE: { label: '活跃', bg: 'bg-sky-50', text: 'text-sky-600' },
  ARCHIVED: { label: '已归档', bg: 'bg-gray-100', text: 'text-gray-500' },
  ERROR: { label: '异常', bg: 'bg-red-50', text: 'text-red-500' },
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
  onClick: (project: Project) => void;
}

export default function ProjectCard({ project, onEdit, onDelete, onStatusChange, onClick }: Props) {
  const navigate = useNavigate();
  const cfg = statusConfig[project.status];
  const isError = project.status === 'ERROR';

  return (
    <div
      onClick={() => { onClick(project); navigate(`/project/${project.id}`); }}
      className={`bg-white border rounded-xl p-5 transition-all group flex flex-col cursor-pointer shadow-sm ${
        isError
          ? 'border-red-300 hover:border-red-400'
          : 'border-gray-200 hover:border-sky-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">
            {isError ? (
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            )}
          </span>
          <h3 className={`font-semibold text-sm truncate ${isError ? 'text-red-500' : 'text-gray-800'}`}>{project.name}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
        </div>
      </div>

      <p className={`text-xs leading-relaxed mb-4 flex-1 ${isError ? 'text-red-400' : 'text-gray-600'}`}>
        {isError ? '项目目录不存在，请检查路径或删除项目' : truncate(project.description || '暂无描述')}
      </p>

      <div className="flex items-center justify-between pt-3 border-t border-gray-200">
        <span className="text-xs text-gray-400">{relativeTime(project.createdAt)}</span>
        <div className="flex items-center gap-1.5">
          {!isError && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(project); }}
                className="text-xs text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                编辑
              </button>
              {project.status === 'ACTIVE' ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onStatusChange(project.id, 'ARCHIVED'); }}
                  className="text-xs text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  归档
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onStatusChange(project.id, 'ACTIVE'); }}
                  className="text-xs text-gray-600 hover:text-sky-600 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  恢复
                </button>
              )}
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
            title="删除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
