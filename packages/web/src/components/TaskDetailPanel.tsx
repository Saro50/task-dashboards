import { useState, useCallback, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Task, TaskStatus, UpdateTaskInput } from '@/types/task';
import type { FileDiff } from '@/types/execution';
import type { SessionMessage, SessionMessageUser, SessionMessageAssistant } from '@/types/session-message';
import { taskApi } from '@/api/task';
import { executionApi } from '@/api/execution';
import { log } from '@/utils/log';
import { Collapsible } from '@/components/session-message/Collapsible';
import { AssistantContent } from '@/components/session-message/AssistantContent';

const S = 'TaskDetailPanel';

const statusConfig: Record<TaskStatus, { label: string; iconBg: string; iconColor: string; ring: string }> = {
  PENDING: { label: '待办', iconBg: 'bg-gray-100', iconColor: 'text-gray-500', ring: 'ring-gray-300' },
  IN_PROGRESS: { label: '进行中', iconBg: 'bg-sky-100', iconColor: 'text-sky-600', ring: 'ring-sky-300' },
  COMPLETED: { label: '已完成', iconBg: 'bg-green-100', iconColor: 'text-green-600', ring: 'ring-green-300' },
  BLOCKED: { label: '已阻塞', iconBg: 'bg-red-100', iconColor: 'text-red-600', ring: 'ring-red-300' },
};

const statusDotColor: Record<TaskStatus, string> = {
  PENDING: 'bg-gray-400',
  IN_PROGRESS: 'bg-sky-500',
  COMPLETED: 'bg-green-500',
  BLOCKED: 'bg-red-500',
};

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: 'PENDING', label: '待办' },
  { value: 'IN_PROGRESS', label: '进行中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'BLOCKED', label: '已阻塞' },
];

function diffStatusLabel(status: string): { text: string; color: string } {
  if (status === 'added') return { text: 'A', color: 'text-green-600 bg-green-50' };
  if (status === 'deleted') return { text: 'D', color: 'text-red-600 bg-red-50' };
  return { text: 'M', color: 'text-amber-600 bg-amber-50' };
}

interface Props {
  task: Task;
  allTasks: Task[];
  executionId?: string;
  onClose: () => void;
  onUpdated: () => void;
  onHoverDep?: (depId: string | null, type: 'dep' | 'dependent') => void;
  disabled?: boolean;
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-96 p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function StatusIcon({ status, onClick, disabled }: { status: TaskStatus; onClick: () => void; disabled?: boolean }) {
  const cfg = statusConfig[status];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${cfg.iconBg} ${cfg.iconColor} ring-1 ${cfg.ring} transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
      title={disabled ? '执行中不可修改状态' : `状态: ${cfg.label}（点击修改）`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor[status]}`} />
      {cfg.label}
    </button>
  );
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const lang = className?.replace('language-', '') || '';
  const code = String(children).replace(/\n$/, '');
  const title = lang ? (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-gray-700">{lang}</span>
      <span className="text-gray-400 text-[10px]">代码</span>
    </span>
  ) : (
    <span className="text-gray-500">代码块</span>
  );
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Collapsible title={title}>
        <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all font-mono bg-gray-100 rounded p-2 max-h-60 overflow-y-auto">
          <code>{code}</code>
        </pre>
      </Collapsible>
    </div>
  );
}

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
  if (children && typeof children === 'object' && 'props' in (children as any)) {
    return extractTextFromChildren(((children as any).props as any).children);
  }
  return '';
}

function DescriptionRenderer({ description }: { description: string }) {
  return (
    <div className="prose prose-sm max-w-none text-gray-700 prose-headings:text-gray-800 prose-code:text-sky-700 prose-code:bg-sky-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-transparent prose-pre:p-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            const codeEl = children as React.ReactElement | null;
            const className = (codeEl?.props as any)?.className as string || '';
            const text = codeEl ? extractTextFromChildren(codeEl) : '';
            return <CodeBlock className={className}>{text}</CodeBlock>;
          },
          code({ children, ...props }) {
            return <code {...props}>{children}</code>;
          },
        }}
      >
        {description}
      </Markdown>
    </div>
  );
}

export default function TaskDetailPanel({ task, allTasks, executionId, onClose, onUpdated, onHoverDep, disabled }: Props) {
  const locked = !!executionId;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [showDepModal, setShowDepModal] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);
  const [saving, setSaving] = useState(false);
  const [addingDepId, setAddingDepId] = useState<string | null>(null);
  const [taskDiffs, setTaskDiffs] = useState<FileDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [expandedDiffFile, setExpandedDiffFile] = useState<string | null>(null);
  const [taskMessages, setTaskMessages] = useState<SessionMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgUnavailable, setMsgUnavailable] = useState(false);

  const deps = allTasks.filter((t) => task.dependencies.includes(t.id));
  const dependents = allTasks.filter((t) => t.dependencies.includes(task.id));

  // 将任务消息按类型拆分：user → AI 输入（提示词），assistant → AI 输出（回复）
  const userMsgs = useMemo(
    () => taskMessages.filter((m): m is SessionMessageUser => m.type === 'user'),
    [taskMessages],
  );
  const assistantMsgs = useMemo(
    () => taskMessages.filter((m): m is SessionMessageAssistant => m.type === 'assistant'),
    [taskMessages],
  );

  // 获取任务变更 diff
  useEffect(() => {
    if (!executionId || task.status !== 'COMPLETED') {
      setTaskDiffs([]);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError('');
    executionApi
      .getTaskDiff(task.id, executionId)
      .then((res) => {
        if (!cancelled) {
          setTaskDiffs(res.diffs ?? []);
          setDiffLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          log.error(S, 'getTaskDiff error', err);
          setDiffError(err.message ?? '获取变更失败');
          setDiffLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [task.id, executionId, task.status]);

  // 获取任务 AI 输出消息
  useEffect(() => {
    if (!executionId || !['IN_PROGRESS', 'COMPLETED', 'BLOCKED'].includes(task.status)) {
      setTaskMessages([]);
      setMsgUnavailable(false);
      return;
    }
    let cancelled = false;
    setMsgLoading(true);
    setMsgUnavailable(false);
    executionApi
      .getTaskMessages(task.id, executionId)
      .then((res) => {
        if (!cancelled) {
          setTaskMessages(res.messages ?? []);
          setMsgUnavailable(!!res.unavailable);
          setMsgLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          log.error(S, 'getTaskMessages error', err);
          setTaskMessages([]);
          setMsgLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [task.id, executionId, task.status]);

  const saveField = useCallback(async (input: UpdateTaskInput) => {
    if (Object.keys(input).length === 0) return;
    setSaving(true);
    try {
      const resp = await taskApi.update(task.id, input);
      log.info(S, 'saveField response', resp);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'saveField error', err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }, [task.id, onUpdated]);

  const handleSaveTitle = useCallback(() => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === task.title) {
      setTitleDraft(task.title);
      setEditingTitle(false);
      return;
    }
    saveField({ title: trimmed }).then(() => setEditingTitle(false));
  }, [titleDraft, task.title, saveField]);

  const handleStatusChange = useCallback((status: TaskStatus) => {
    if (status === task.status) {
      setEditingStatus(false);
      return;
    }
    saveField({ status }).then(() => setEditingStatus(false));
  }, [task.status, saveField]);

  const handleDescSave = useCallback(() => {
    if (descDraft === task.description) {
      setEditingDesc(false);
      return;
    }
    saveField({ description: descDraft }).then(() => setEditingDesc(false));
  }, [descDraft, task.description, saveField]);

  const handleDelete = useCallback(async () => {
    if (!confirm('确定删除此任务？')) return;
    log.info(S, 'handleDelete', { taskId: task.id });
    try {
      await taskApi.remove(task.id);
      onUpdated();
      onClose();
    } catch (err: any) {
      log.error(S, 'handleDelete error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated, onClose]);

  const handleAddDep = useCallback(async (depId: string) => {
    if (addingDepId) return;
    setAddingDepId(depId);
    try {
      await taskApi.addDependency(task.id, depId);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleAddDep error', err);
      if (!err.message?.includes('409')) alert(err.message);
    } finally {
      setAddingDepId(null);
    }
  }, [task.id, onUpdated, addingDepId]);

  const handleRemoveDep = useCallback(async (depId: string) => {
    try {
      await taskApi.removeDependency(task.id, depId);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleRemoveDep error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated]);

  const handleRemoveDependent = useCallback(async (dependentId: string) => {
    try {
      await taskApi.removeDependency(dependentId, task.id);
      onUpdated();
    } catch (err: any) {
      log.error(S, 'handleRemoveDependent error', err);
      alert(err.message);
    }
  }, [task.id, onUpdated]);

  const availableToAdd = allTasks.filter(
    (t) => t.id !== task.id && !task.dependencies.includes(t.id)
  );

  return (
    <div className="fixed right-0 top-14 bottom-0 w-[420px] bg-white border-l border-gray-200 shadow-lg z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h2
            className={`text-base font-semibold text-gray-800 truncate transition-colors ${locked ? 'cursor-default' : 'cursor-pointer hover:text-sky-600'}`}
            onClick={() => { if (!locked) { setTitleDraft(task.title); setEditingTitle(true); } }}
            title={locked ? '执行后不可修改标题' : '点击编辑标题'}
          >
            {task.title}
          </h2>
          {!locked && (
            <button
              onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
              className="shrink-0 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              title="编辑标题"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
          )}
          <StatusIcon status={task.status} onClick={() => { if (!locked) setEditingStatus(true); }} disabled={locked} />
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={handleDelete}
            disabled={saving || locked}
            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
            title={locked ? '执行后不可删除任务' : '删除任务'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">描述</span>
            {!locked && (
              <button
                onClick={() => { setDescDraft(task.description); setEditingDesc(true); }}
                className="text-xs text-sky-500 hover:text-sky-600 transition-colors cursor-pointer"
              >
                编辑
              </button>
            )}
          </div>
          {task.description ? (
            <div
              className={`min-h-[60px] rounded-lg p-2 -m-2 transition-colors ${locked ? '' : 'cursor-pointer hover:bg-gray-50'}`}
              onClick={() => { if (!locked) { setDescDraft(task.description); setEditingDesc(true); } }}
            >
              <DescriptionRenderer description={task.description} />
            </div>
          ) : (
            <div
              className={`min-h-[60px] flex items-center justify-center text-sm text-gray-400 rounded-lg -m-2 p-2 transition-colors ${locked ? '' : 'cursor-pointer hover:bg-gray-50'}`}
            >
              {locked ? '暂无描述' : '点击添加描述...'}
            </div>
          )}
        </div>

        {/* Blocked reason */}
        {task.status === 'BLOCKED' && task.blockedReason && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-1.5 mb-1">
              <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-xs font-medium text-red-700">阻塞原因</span>
            </div>
            <p className="text-xs text-red-600 leading-relaxed">{task.blockedReason}</p>
          </div>
        )}

        {/* Task changes (diff) — 仅在有 executionId 且任务已完成时显示 */}
        {executionId && task.status === 'COMPLETED' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">变更</span>
              {taskDiffs.length > 0 && (
                <span className="text-xs tabular-nums">
                  <span className="text-green-600">+{taskDiffs.reduce((s, d) => s + (d.additions ?? 0), 0)}</span>
                  <span className="text-gray-300 mx-0.5">/</span>
                  <span className="text-red-600">-{taskDiffs.reduce((s, d) => s + (d.deletions ?? 0), 0)}</span>
                </span>
              )}
            </div>
            {diffLoading && (
              <div className="flex items-center py-3 text-xs text-gray-400">
                <div className="w-3.5 h-3.5 border border-gray-200 border-t-sky-500 rounded-full animate-spin mr-2" />
                加载变更中...
              </div>
            )}
            {diffError && (
              <div className="text-xs text-red-500 py-2">{diffError}</div>
            )}
            {!diffLoading && !diffError && taskDiffs.length === 0 && (
              <div className="text-xs text-gray-400 py-2">该任务未产生文件修改</div>
            )}
            {!diffLoading && !diffError && taskDiffs.length > 0 && (
              <div className="space-y-1">
                {taskDiffs.map((d) => {
                  const st = diffStatusLabel(d.status ?? 'modified');
                  const isExpanded = expandedDiffFile === d.file;
                  return (
                    <div key={d.file} className="rounded-lg border border-gray-100 overflow-hidden">
                      <button
                        onClick={() => setExpandedDiffFile(isExpanded ? null : d.file)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${st.color}`}>
                          {st.text}
                        </span>
                        <span className="text-xs font-mono text-gray-700 flex-1 truncate">{d.file}</span>
                        <span className="text-[11px] tabular-nums shrink-0">
                          <span className="text-green-600">+{d.additions ?? 0}</span>
                          <span className="text-gray-300 mx-0.5">/</span>
                          <span className="text-red-600">-{d.deletions ?? 0}</span>
                        </span>
                        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && d.patch && (
                        <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 max-h-48 overflow-y-auto">
                          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                            {d.patch.split('\n').map((line, i) => {
                              if (line.startsWith('+')) return <div key={i} className="bg-green-50 text-green-800">{line}</div>;
                              if (line.startsWith('-')) return <div key={i} className="bg-red-50 text-red-800">{line}</div>;
                              return <div key={i} className="text-gray-600">{line}</div>;
                            })}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* AI 输入 / AI 输出 — 仅在有 executionId 且任务已处理时显示 */}
        {executionId && ['IN_PROGRESS', 'COMPLETED', 'BLOCKED'].includes(task.status) && (
          <>
            {/* AI 输入（用户提示词） */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">AI 输入</span>
              </div>
              {msgLoading && (
                <div className="flex items-center py-3 text-xs text-gray-400">
                  <div className="w-3.5 h-3.5 border border-gray-200 border-t-sky-500 rounded-full animate-spin mr-2" />
                  加载 AI 输入中...
                </div>
              )}
              {!msgLoading && msgUnavailable && (
                <div className="text-xs text-gray-400 py-2">执行环境已清理，无法获取 AI 输入</div>
              )}
              {!msgLoading && !msgUnavailable && userMsgs.length === 0 && (
                <div className="text-xs text-gray-400 py-2">暂无 AI 输入</div>
              )}
              {!msgLoading && !msgUnavailable && userMsgs.length > 0 && (
                <div className="space-y-2">
                  {userMsgs.map((msg) => (
                    <div key={msg.id} className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
                      <p className="text-xs text-sky-800 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
                        {msg.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI 输出（assistant 回复） */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">AI 输出</span>
              </div>
              {/* loading / unavailable 已在 AI 输入板块展示，此处不重复 */}
              {!msgLoading && !msgUnavailable && assistantMsgs.length === 0 && (
                <div className="text-xs text-gray-400 py-2">
                  {task.status === 'BLOCKED' ? 'AI 未生成回复' : '暂无 AI 输出'}
                </div>
              )}
              {!msgLoading && !msgUnavailable && assistantMsgs.length > 0 && (
                <div className="space-y-2">
                  {assistantMsgs.map((assistantMsg) => (
                    <div key={assistantMsg.id} className="space-y-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-gray-400 font-mono">{assistantMsg.agent}</span>
                        {assistantMsg.error && <span className="text-[10px] text-red-500">错误: {assistantMsg.error.message}</span>}
                        {!assistantMsg.finish && !assistantMsg.error && (
                          <svg className="w-3 h-3 animate-pulse text-sky-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                      </div>
                      <AssistantContent content={assistantMsg.content} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Dependency summary */}
        <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
          <span className="text-xs text-gray-600">
            {deps.length > 0 && <span className="font-medium text-gray-700">{deps.length}</span>}
            {deps.length > 0 ? ' 个依赖' : ''}
            {deps.length > 0 && dependents.length > 0 && <span className="text-gray-400"> · </span>}
            {dependents.length > 0 && <><span className="font-medium text-gray-700">{dependents.length}</span> 个被依赖</>}
            {deps.length === 0 && dependents.length === 0 && <span className="text-gray-400">暂无依赖关系</span>}
          </span>
          <button
            onClick={() => { if (!locked) setShowDepModal(true); }}
            disabled={locked}
            className="text-xs text-sky-500 hover:text-sky-600 font-medium transition-colors cursor-pointer disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:text-gray-300"
          >
            管理
          </button>
        </div>
      </div>

      {/* Edit Title Modal */}
      <Modal open={editingTitle} onClose={() => setEditingTitle(false)}>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">编辑标题</h3>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none mb-4"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditingTitle(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 cursor-pointer">取消</button>
          <button onClick={handleSaveTitle} disabled={saving} className="px-3 py-1.5 text-xs bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white rounded-lg cursor-pointer disabled:cursor-not-allowed">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </Modal>

      {/* Edit Description Modal */}
      {editingDesc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={() => setEditingDesc(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-800">编辑描述</h3>
              <button
                onClick={() => setEditingDesc(false)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-5 overflow-y-auto">
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
                rows={16}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none resize-y font-mono leading-relaxed"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end px-5 py-3 border-t border-gray-200">
              <button onClick={() => setEditingDesc(false)} className="px-4 py-1.5 text-xs text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 cursor-pointer">取消</button>
              <button onClick={handleDescSave} disabled={saving} className="px-4 py-1.5 text-xs bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white rounded-lg cursor-pointer disabled:cursor-not-allowed">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Status Modal */}
      <Modal open={editingStatus} onClose={() => setEditingStatus(false)}>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">修改状态</h3>
        <div className="space-y-1.5">
          {statusOptions.map((opt) => {
            const cfg = statusConfig[opt.value];
            const isActive = opt.value === task.status;
            return (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={saving}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  isActive ? `${cfg.iconBg} ring-1 ${cfg.ring}` : 'hover:bg-gray-50'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${statusDotColor[opt.value]}`} />
                <span className={isActive ? 'font-medium text-gray-800' : 'text-gray-600'}>{opt.label}</span>
                {isActive && (
                  <svg className="w-4 h-4 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Dependency Management Modal */}
      <Modal open={showDepModal} onClose={() => setShowDepModal(false)}>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">依赖管理</h3>
        <div className="max-h-80 overflow-y-auto">
          {/* Dependencies */}
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">依赖任务（{deps.length}）</h4>
            {deps.length === 0 && <p className="text-xs text-gray-400 py-1">无依赖</p>}
            {deps.map((dep) => (
              <div
                key={dep.id}
                className="group flex items-center gap-2 py-1.5 text-xs text-gray-700 hover:bg-sky-50 rounded px-2 -mx-1 transition-colors"
                onMouseEnter={() => onHoverDep?.(dep.id, 'dep')}
                onMouseLeave={() => onHoverDep?.(null, 'dep')}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor[dep.status]}`} />
                <span className="truncate flex-1">{dep.title}</span>
                {!locked && (
                  <button
                    onClick={() => { handleRemoveDep(dep.id); onHoverDep?.(null, 'dep'); }}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {!locked && availableToAdd.length > 0 && (
              <div className="mt-2">
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) handleAddDep(e.target.value); }}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:border-sky-500 outline-none bg-white cursor-pointer text-gray-500"
                >
                  <option value="">+ 添加依赖...</option>
                  {availableToAdd.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Dependents */}
          {dependents.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">被依赖（{dependents.length}）</h4>
              {dependents.map((dep) => (
                <div
                  key={dep.id}
                  className="group flex items-center gap-2 py-1.5 text-xs text-gray-700 hover:bg-sky-50 rounded px-2 -mx-1 transition-colors"
                  onMouseEnter={() => onHoverDep?.(dep.id, 'dependent')}
                  onMouseLeave={() => onHoverDep?.(null, 'dependent')}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor[dep.status]}`} />
                  <span className="truncate flex-1">{dep.title}</span>
                  {!locked && (
                    <button
                      onClick={() => { handleRemoveDependent(dep.id); onHoverDep?.(null, 'dependent'); }}
                      className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
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
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => setShowDepModal(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 cursor-pointer">关闭</button>
        </div>
      </Modal>
    </div>
  );
}
