import { useState, useCallback } from 'react';
import type { Task, TaskStatus, UpdateTaskInput } from '@/types/task';
import { taskApi } from '@/api/task';
import { log } from '@/utils/log';

const S = 'TaskDetailPanel';

const statusOptions: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'PENDING', label: '待办', color: 'bg-gray-400' },
  { value: 'IN_PROGRESS', label: '进行中', color: 'bg-sky-500' },
  { value: 'COMPLETED', label: '已完成', color: 'bg-green-500' },
  { value: 'BLOCKED', label: '已阻塞', color: 'bg-red-500' },
];

interface Props {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdated: () => void;
  onHoverDep?: (depId: string | null, type: 'dep' | 'dependent') => void;
  disabled?: boolean;
}

export default function TaskDetailPanel({ task, allTasks, onClose, onUpdated, onHoverDep, disabled }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saving, setSaving] = useState(false);

  const deps = allTasks.filter((t) => task.dependencies.includes(t.id));
  const dependents = allTasks.filter((t) => t.dependencies.includes(task.id));
  const availableDeps = allTasks.filter((t) => t.id !== task.id && !task.dependencies.includes(t.id));

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const input: UpdateTaskInput = {};
      if (title !== task.title) input.title = title;
      if (description !== task.description) input.description = description;
      if (status !== task.status) input.status = status;
      log.info(S, 'handleSave', { taskId: task.id, input });
      if (Object.keys(input).length > 0) {
        const resp = await taskApi.update(task.id, input);
        log.info(S, 'handleSave response', resp);
      }
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleSave error', err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }, [title, description, status, task, onUpdated]);

  const handleDelete = useCallback(async () => {
    if (!confirm('确定删除此任务？')) return;
    log.info(S, 'handleDelete', { taskId: task.id, title: task.title });
    try {
      await taskApi.remove(task.id);
      onUpdated();
      onClose();
    } catch (err: any) {
      log.error(S, 'handleDelete error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated, onClose]);

  const [addingDepId, setAddingDepId] = useState<string | null>(null);

  const handleAddDep = useCallback(async (depId: string) => {
    if (addingDepId) return;
    log.info(S, 'handleAddDep', { taskId: task.id, depId });
    setAddingDepId(depId);
    try {
      const resp = await taskApi.addDependency(task.id, depId);
      log.info(S, 'handleAddDep response', resp);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleAddDep error', err);
      if (!err.message?.includes('409')) {
        alert(err.message);
      }
    } finally {
      setAddingDepId(null);
    }
  }, [task.id, onUpdated, addingDepId]);

  const handleRemoveDep = useCallback(async (depId: string) => {
    log.info(S, 'handleRemoveDep', { taskId: task.id, depId });
    try {
      await taskApi.removeDependency(task.id, depId);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleRemoveDep error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated]);

  const handleRemoveDependent = useCallback(async (dependentId: string) => {
    log.info(S, 'handleRemoveDependent', { dependentId, taskId: task.id });
    try {
      await taskApi.removeDependency(dependentId, task.id);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleRemoveDependent error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated]);

  return (
    <div className="fixed right-0 top-14 bottom-0 w-80 bg-white border-l border-gray-200 shadow-lg z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800 text-sm">任务详情</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">状态</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">依赖任务</label>
          {deps.length === 0 && (
            <p className="text-xs text-gray-400">无依赖</p>
          )}
          {deps.map((dep) => (
            <div
              key={dep.id}
              className="group flex items-center gap-2 py-1 text-xs text-gray-700 hover:bg-sky-50 rounded px-1 -mx-1 transition-colors"
              onMouseEnter={() => onHoverDep?.(dep.id, 'dep')}
              onMouseLeave={() => onHoverDep?.(null, 'dep')}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                dep.status === 'PENDING' ? 'bg-gray-400' :
                dep.status === 'IN_PROGRESS' ? 'bg-sky-500' :
                dep.status === 'COMPLETED' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="truncate flex-1">{dep.title}</span>
              {!disabled && (
                <button
                  onClick={() => { handleRemoveDep(dep.id); onHoverDep?.(null, 'dep'); }}
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        {dependents.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">被依赖</label>
            {dependents.map((dep) => (
              <div
                key={dep.id}
                className="group flex items-center gap-2 py-1 text-xs text-gray-700 hover:bg-sky-50 rounded px-1 -mx-1 transition-colors"
                onMouseEnter={() => onHoverDep?.(dep.id, 'dependent')}
                onMouseLeave={() => onHoverDep?.(null, 'dependent')}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  dep.status === 'PENDING' ? 'bg-gray-400' :
                  dep.status === 'IN_PROGRESS' ? 'bg-sky-500' :
                  dep.status === 'COMPLETED' ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="truncate flex-1">{dep.title}</span>
                {!disabled && (
                  <button
                    onClick={() => { handleRemoveDependent(dep.id); onHoverDep?.(null, 'dependent'); }}
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!disabled && availableDeps.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">添加依赖</label>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleAddDep(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none"
              defaultValue=""
            >
              <option value="" disabled>选择任务...</option>
              {availableDeps.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-sm font-medium py-2 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          onClick={handleDelete}
          className="px-3 py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
        >
          删除
        </button>
      </div>
    </div>
  );
}
