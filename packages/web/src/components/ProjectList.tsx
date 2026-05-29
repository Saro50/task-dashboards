import type { Project, ProjectStatus } from '@/types/project';
import ProjectCard from './ProjectCard';
import { log } from '@/utils/log';

interface Props {
  projects: Project[];
  loading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (project: Project) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onCardClick: (project: Project) => void;
}

export default function ProjectList({ projects, loading, error, onCreate, onEdit, onDelete, onStatusChange, onCardClick }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 text-sm mb-4">加载失败：{error}</p>
        <button
          onClick={() => { log.info('ProjectList', 'retry clicked'); window.location.reload(); }}
          className="text-sm text-sky-500 hover:text-sky-600 cursor-pointer"
        >
          重试
        </button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">暂无项目</h2>
        <p className="text-sm text-gray-600 mb-6 max-w-md">
          点击下方按钮创建你的第一个项目，开始使用 AICodeAgent 管理你的开发任务。
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          新建项目
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onEdit={onEdit}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
          onClick={onCardClick}
        />
      ))}
    </div>
  );
}
