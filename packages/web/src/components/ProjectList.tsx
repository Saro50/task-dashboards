import type { Project, ProjectStatus } from '@/types/project';
import ProjectCard from './ProjectCard';

interface Props {
  projects: Project[];
  loading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (project: Project) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
}

export default function ProjectList({ projects, loading, error, onCreate, onEdit, onDelete, onStatusChange }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-gray-700 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-sm mb-4">加载失败：{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-primary-400 hover:text-primary-300 cursor-pointer"
        >
          重试
        </button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-6xl mb-4 opacity-40">📂</div>
        <h2 className="text-lg font-semibold text-gray-300 mb-2">暂无项目</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md">
          点击下方按钮创建你的第一个项目，开始使用 AICodeAgent 管理你的开发任务。
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-primary-500/20 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          新建项目
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onEdit={onEdit}
          onDelete={onDelete}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}
