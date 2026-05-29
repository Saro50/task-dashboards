import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { Project } from '@/types/project';
import { projectApi, type DirCheckResult } from '@/api/project';

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
  const [dirInfo, setDirInfo] = useState<DirCheckResult | null>(null);
  const [checkingDir, setCheckingDir] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setDirInfo(null);
    }
  }, [open, project]);

  useEffect(() => {
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, []);

  if (!open) return null;

  const checkDirectory = (dirPath: string) => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    if (!dirPath.trim()) {
      setDirInfo(null);
      return;
    }
    checkTimerRef.current = setTimeout(async () => {
      setCheckingDir(true);
      try {
        const result = await projectApi.checkDirectory(dirPath.trim());
        setDirInfo(result);
      } catch {
        setDirInfo(null);
      } finally {
        setCheckingDir(false);
      }
    }, 500);
  };

  const handlePathChange = (value: string) => {
    setPath(value);
    checkDirectory(value);
  };

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
    if (path.trim() && dirInfo && !dirInfo.exists) {
      setError('目录不存在，请确认路径');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (path.trim() && dirInfo && dirInfo.exists && !dirInfo.isGitRepo) {
        await projectApi.ensureDirectory(path.trim());
      }
      await onSubmit({ name: name.trim(), description: description.trim(), path: path.trim() });
    } catch (err: any) {
      setError(err.message || '操作失败');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-[scaleIn_0.2s_ease_both]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            {isEdit ? (
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
              </svg>
            )}
            <span className="font-semibold text-gray-800">{isEdit ? '编辑项目' : '新建项目'}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              项目名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: my-awesome-app"
              className="w-full px-3 py-2.5 text-gray-800 bg-transparent border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400"
              disabled={submitting}
            />
            <p className="text-xs text-gray-400 mt-1.5">仅支持字母、数字、连字符和下划线</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              项目描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="简要描述项目的用途、核心功能和目标..."
              className="w-full px-3 py-2.5 text-gray-800 bg-transparent border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400 resize-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              目标路径
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="例如: ~/projects/my-app"
              className="w-full px-3 py-2.5 text-gray-800 bg-transparent border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400"
              disabled={submitting}
            />
            <p className="text-xs text-gray-400 mt-1.5">服务器本地路径，输入后自动检查目录状态</p>

            {checkingDir && (
              <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-sky-500 rounded-full animate-spin" />
                检查目录...
              </p>
            )}

            {dirInfo && !checkingDir && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                dirInfo.exists
                  ? dirInfo.isGitRepo
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-yellow-50 border border-yellow-200'
                  : 'bg-red-50 border border-red-200'
              }`}>
                {dirInfo.exists ? (
                  dirInfo.isGitRepo ? (
                    <>
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-green-600">目录已存在，Git 已初始化</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <span className="text-yellow-600">目录已存在，创建项目后将自动初始化 Git</span>
                    </>
                  )
                ) : (
                  <>
                    <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-red-600">目录不存在，请确认路径</span>
                  </>
                )}
              </div>
            )}

          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow cursor-pointer"
            >
              {submitting ? '提交中...' : isEdit ? '保存修改' : '创建项目'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg transition-colors text-sm cursor-pointer"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
