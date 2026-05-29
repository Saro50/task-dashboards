import { useState, useCallback, useEffect } from 'react';
import type { EngineStatus } from '@/components/Layout';
import ProjectList from '@/components/ProjectList';
import ProjectModal from '@/components/ProjectModal';
import EngineConfigModal from '@/components/EngineConfigModal';
import AIChatWidget from '@/components/AIChatWidget';
import { useToast } from '@/components/Toast';
import { useProjects } from '@/hooks/useProjects';
import { projectApi } from '@/api/project';
import { engineApi } from '@/api/engine';
import type { Project, ProjectStatus } from '@/types/project';

interface Props {
  onOpenEngineConfig: () => void;
  engineStatus: EngineStatus;
  onEngineStatusChange: (status: EngineStatus) => void;
}

export default function ProjectListPage({ onOpenEngineConfig, engineStatus, onEngineStatusChange }: Props) {
  const { projects, loading, error, refetch } = useProjects();
  const { showToast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const handleCreate = useCallback(() => {
    setEditingProject(null);
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((project: Project) => {
    setEditingProject(project);
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除此项目？删除后不可恢复。')) return;
    try {
      await projectApi.remove(id);
      showToast('项目已删除', 'success');
      refetch();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [showToast, refetch]);

  const handleStatusChange = useCallback(async (id: string, status: ProjectStatus) => {
    try {
      await projectApi.updateStatus(id, status);
      const statusLabels: Record<ProjectStatus, string> = {
        ACTIVE: '活跃',
        ARCHIVED: '已归档',
        ERROR: '异常',
      };
      showToast(`项目状态已更新为「${statusLabels[status]}」`, 'success');
      refetch();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [showToast, refetch]);

  const handleCardClick = useCallback(async (project: Project) => {
    try {
      const updated = await projectApi.healthCheck(project.id);
      if (updated.status === 'ERROR') {
        showToast('项目目录不存在，已标记为异常', 'error');
        refetch();
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [showToast, refetch]);

  const handleModalSubmit = useCallback(async (data: { name: string; description: string; path: string }) => {
    if (editingProject) {
      await projectApi.update(editingProject.id, data);
      showToast('项目已更新', 'success');
    } else {
      await projectApi.create(data);
      showToast('项目创建成功', 'success');
    }
    setModalOpen(false);
    setEditingProject(null);
    refetch();
  }, [editingProject, showToast, refetch]);

  return (
    <>
      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-gray-800 mb-2">
              项目管理
            </h1>
            <p className="text-gray-600 text-sm leading-relaxed">
              管理你的所有项目，创建新项目或查看进展。
            </p>
          </div>
          {projects.length > 0 && (
            <button
              onClick={handleCreate}
              className="shrink-0 flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              新建项目
            </button>
          )}
        </div>

        <ProjectList
          projects={projects}
          loading={loading}
          error={error}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
          onCardClick={handleCardClick}
        />
      </main>

      <ProjectModal
        open={modalOpen}
        project={editingProject}
        onClose={() => { setModalOpen(false); setEditingProject(null); }}
        onSubmit={handleModalSubmit}
      />

      <AIChatWidget engineStatus={engineStatus} />
    </>
  );
}
