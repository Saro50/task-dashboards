import { useState, useEffect, type FormEvent } from 'react';
import type { Project } from '@/types/project';

interface Props {
  open: boolean;
  project?: Project | null;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; path: string }) => Promise<void>;
}

export default function ProjectModal({ open, project, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [path, setPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!project;

  useEffect(() => {
    if (open) {
      if (project) {
        setName(project.name);
        setDescription(project.description);
        setPath(project.path);
      } else {
        setName('');
        setDescription('');
        setPath('');
      }
      setError('');
      setSubmitting(false);
    }
  }, [open, project]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
      setError('项目名称仅支持字母、数字、连字符和下划线');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), path: path.trim() });
    } catch (err: any) {
      setError(err.message || '操作失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-dark-300 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-[scaleIn_0.2s_ease_both]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{isEdit ? '✏️' : '🚀'}</span>
            <span className="font-bold text-white">{isEdit ? '编辑项目' : '新建项目'}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 overflow-y-auto">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              📂 项目名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: my-awesome-app"
              className="w-full bg-dark-50 border border-gray-600 rounded-xl text-white text-sm px-4 py-3 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all placeholder-gray-500"
              disabled={submitting}
            />
            <p className="text-xs text-gray-500 mt-1.5">仅支持字母、数字、连字符和下划线</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              📝 项目描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="简要描述项目的用途、核心功能和目标..."
              className="w-full bg-dark-50 border border-gray-600 rounded-xl text-white text-sm px-4 py-3 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all placeholder-gray-500 resize-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              📁 目标路径
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/user/projects/"
              className="w-full bg-dark-50 border border-gray-600 rounded-xl text-white text-sm px-4 py-3 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all placeholder-gray-500"
              disabled={submitting}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-6 rounded-xl transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? '提交中...' : isEdit ? '保存修改' : '创建项目'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold rounded-xl transition-colors text-sm cursor-pointer"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
