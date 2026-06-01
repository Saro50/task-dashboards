import { useState, useCallback } from 'react';
import type { TaskPlan, TaskPlanItem } from '@/types/task';
import { taskApi } from '@/api/task';
import { unwrap } from '@/api/lib';
import { useToast } from './Toast';
import { log } from '@/utils/log';

const S = 'TaskPlanPreview';

interface Props {
  plan: TaskPlan;
}

export default function TaskPlanPreview({ plan }: Props) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const handleImport = useCallback(async () => {
    if (!selectedProject) {
      showToast('请先选择项目', 'error');
      return;
    }
    log.info(S, 'handleImport', { projectId: selectedProject, topic: plan.topic, taskCount: plan.tasks.length });
    setImporting(true);
    try {
      const result = await taskApi.importPlan(selectedProject, plan.topic, plan.summary, plan.tasks);
      log.info(S, 'handleImport response', result);
      showToast(`成功导入 ${result.imported} 个任务，${result.dependencies} 个依赖关系`, 'success');
      setImported(true);
    } catch (err: any) {
      log.error(S, 'handleImport error', err);
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  }, [selectedProject, plan, showToast]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const raw = await res.json();
        const { data, requestId } = unwrap<any[]>(raw, res.headers.get('X-Request-Id') || undefined);
        log.info(S, 'loadProjects', { requestId, count: Array.isArray(data) ? data.length : 0 });
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const handleOpenPicker = useCallback(() => {
    log.info(S, 'handleOpenPicker');
    loadProjects();
    setShowProjectPicker(true);
  }, [loadProjects]);

  const statusIcon = (deps: string[]) => {
    if (deps.length === 0) return null;
    return (
      <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
        {deps.length}
      </span>
    );
  };

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/50 overflow-hidden my-2">
      <div className="px-3 py-2 bg-sky-50 border-b border-sky-200">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className="text-sm font-medium text-sky-700">{plan.topic}</span>
        </div>
        {plan.summary && (
          <p className="text-xs text-sky-600 mt-1">{plan.summary}</p>
        )}
      </div>

      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
        {plan.tasks.map((task) => (
          <div key={task.ref} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
            <span className="text-xs text-gray-700 truncate flex-1">{task.title}</span>
            {statusIcon(task.dependencies || [])}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-sky-200">
        {imported ? (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            已导入
          </div>
        ) : showProjectPicker ? (
          <div className="space-y-2">
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-sky-300 rounded-lg focus:border-sky-500 outline-none"
            >
              <option value="">选择项目...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                disabled={importing || !selectedProject}
                className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-xs py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {importing ? '导入中...' : '确认导入'}
              </button>
              <button
                onClick={() => setShowProjectPicker(false)}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleOpenPicker}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white text-xs py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            导入到项目
          </button>
        )}
      </div>
    </div>
  );
}
