import { useState, useCallback } from 'react';
import type { ChatPart, ChatMessage } from '@/types/chat';
import type { StepPlan, Step } from '@/types/step';
import StepPlanPreview from '../StepPlanPreview';
import { Collapsible, ToolStatusLabel } from './Collapsible';
import ImageLightbox from './ImageLightbox';

/**
 * 将 file part 的 url 解析为可访问的图片 URL。
 *
 * 处理三种情况：
 * 1. data URL（如 data:image/png;base64,...）— 直接返回
 * 2. 绝对 URL（如 https://...）— 直接返回
 * 3. 相对路径（如 .opencode/tmp/images/xxx.png）— 拼接后端 serve-image 端点
 *
 * 上游：PartRenderer 中 file part 渲染时调用。
 * 下游：返回浏览器可加载的完整 URL 字符串。
 */
export function resolveImageUrl(url: string, directory?: string): string {
  // data URL、blob URL 或 http(s) URL 直接返回
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // 相对路径 → 后端 serve-image 代理端点
  const params = new URLSearchParams({ path: url });
  if (directory) params.set('directory', directory);
  return `/api/chat/serve-image?${params.toString()}`;
}

/**
 * 判断 file part 的 MIME 是否为图片类型。
 */
function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith('image/');
}

export function repairJson(str: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
    } else {
      if (ch === '\\') {
        result += ch + (str[i + 1] || '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        const rest = str.slice(i + 1).trimStart();
        if (rest.length === 0 || /^[,}\]):]/.test(rest)) {
          result += ch;
          inString = false;
        } else {
          result += '\\"';
        }
      } else {
        result += ch;
      }
    }
    i++;
  }
  return result;
}

export function PartRenderer({ part, projectId, taskId, chatSessionId, importedPlanTasks, onPlanImported, existingSteps, currentTaskName, directory }: {
  part: ChatPart;
  projectId?: string;
  taskId?: string;
  chatSessionId?: string;
  importedPlanTasks: Set<string>;
  onPlanImported: (taskName: string) => void;
  /** 当前任务已有步骤，用于 diff 比对 */
  existingSteps?: Step[];
  /** 当前任务名称，用于判断计划是否属于当前任务 */
  currentTaskName?: string;
  /**
   * 项目工作目录，用于构建 serve-image URL。
   * 上游：由 ChatMessageList 从 AIChatWidget 传入。
   */
  directory?: string;
}) {
  // ─── Lightbox 状态：点击缩略图打开全屏预览 ───
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const openLightbox = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxSrc(null);
  }, []);

  // ─── file 类型 part：图片缩略图 / 文件下载链接 ───
  if (part.type === 'file') {
    const url = part.url as string | undefined;
    const mime = part.mime as string | undefined;
    const filename = (part.filename as string | undefined) || '文件';

    if (!url) return null;

    // 图片类型：渲染缩略图
    if (isImageMime(mime)) {
      const resolvedUrl = resolveImageUrl(url, directory);
      return (
        <>
          <button
            type="button"
            onClick={() => openLightbox(resolvedUrl)}
            className="block max-w-[200px] max-h-[150px] rounded-lg border border-gray-200 overflow-hidden hover:border-sky-300 hover:shadow-sm transition-all cursor-pointer"
            title="点击查看大图"
          >
            <img
              src={resolvedUrl}
              alt={filename}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </button>
          {lightboxSrc && (
            <ImageLightbox src={lightboxSrc} alt={filename} onClose={closeLightbox} />
          )}
        </>
      );
    }

    // 非图片文件：显示文件名 + 下载链接
    const resolvedUrl = resolveImageUrl(url, directory);
    return (
      <a
        href={resolvedUrl}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors text-xs text-gray-600 max-w-[280px]"
      >
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="truncate">{filename}</span>
      </a>
    );
  }

  if (part.type === 'text' && part.text) {
    const text = part.text;
    const taskPlanRegex = /<task-plan>\n?([\s\S]*?)\n?<\/task-plan>/g;
    const segments: Array<{ type: 'text' | 'plan'; content: string | StepPlan }> = [];
    let lastIndex = 0;
    let match;

    while ((match = taskPlanRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      try {
        let jsonStr = match[1].trim();
        jsonStr = jsonStr.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'');
        let plan: StepPlan;
        try {
          plan = JSON.parse(jsonStr);
        } catch {
          plan = JSON.parse(repairJson(jsonStr));
        }
        // 兼容 AI 旧格式输出：AI 可能输出 tasks 字段而非 steps
        if (!plan.steps && (plan as any).tasks) {
          plan.steps = (plan as any).tasks;
        }
        // 兼容 AI 旧格式输出：AI 可能输出 topic 字段而非 task
        if (!plan.task && (plan as any).topic) {
          plan.task = (plan as any).topic;
        }
        segments.push({ type: 'plan', content: plan });
      } catch {
        segments.push({ type: 'text', content: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    if (segments.length === 0 || (segments.length === 1 && segments[0].type === 'text')) {
      return <p className="whitespace-pre-wrap break-words">{text}</p>;
    }

    return (
      <>
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <p key={i} className="whitespace-pre-wrap break-words">{seg.content as string}</p>
          ) : (
            <StepPlanPreview
              key={i}
              plan={seg.content as StepPlan}
              projectId={projectId}
              taskId={taskId}
              chatSessionId={chatSessionId}
              imported={importedPlanTasks.has((seg.content as StepPlan).task)}
              onPlanImported={onPlanImported}
              existingSteps={existingSteps}
              currentTaskName={currentTaskName}
            />
          )
        )}
      </>
    );
  }

  if (part.type === 'reasoning' && part.text) {
    const t = part.text;
    const preview = t.length > 60 ? t.slice(0, 60) + '...' : t;
    return (
      <Collapsible
        title={<span className="italic text-gray-400">思考: {preview}</span>}
        icon={
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.414-2.379a5.515 5.515 0 00-1.414-2.379V12c0-1.576.758-3.016 2.024-3.887a4.5 4.5 0 00-1.414-2.379C14.578 4.914 13.81 4.5 13 4.5H11c-.81 0-1.578.414-2.024 1.086A4.5 4.5 0 007.562 8.1 4.5 4.5 0 006 12v.354c0 .983-.658 1.823-1.414 2.379A5.515 5.515 0 006 16.879V18" />
          </svg>
        }
      >
        <p className="text-xs text-gray-400 italic whitespace-pre-wrap break-words border-l-2 border-gray-200 pl-2 leading-relaxed">
          {part.text}
        </p>
      </Collapsible>
    );
  }

  if (part.type === 'tool') {
    const toolName = part.tool || 'tool';
    const state = part.state;
    const title = state?.title || toolName;
    const preview = state?.output
      ? (state.output.length > 80 ? state.output.slice(0, 80) + '...' : state.output)
      : null;

    return (
      <Collapsible
        title={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-gray-700">{title}</span>
            <ToolStatusLabel status={state?.status || 'pending'} />
            {preview && <span className="text-gray-400 truncate hidden sm:inline">{preview}</span>}
          </span>
        }
        icon={
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17l-5.1-3.26a1.5 1.5 0 010-2.56l5.1-3.26a1.5 1.5 0 012.16.96l.78 4.42a1.5 1.5 0 01-2.16.96l-5.1-3.26m5.1 3.26l5.1 3.26a1.5 1.5 0 002.16-.96l.78-4.42a1.5 1.5 0 00-2.16-.96l-5.1 3.26" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      >
        <div className="space-y-1">
          {state?.input && (
            <div className="rounded bg-gray-100 px-2 py-1">
              <p className="text-[10px] text-gray-400 mb-0.5">输入</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono">
                {JSON.stringify(state.input, null, 2).slice(0, 500)}
              </pre>
            </div>
          )}
          {state?.output && (
            <div className="rounded bg-gray-100 px-2 py-1">
              <p className="text-[10px] text-gray-400 mb-0.5">输出</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                {state.output.slice(0, 1000)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible>
    );
  }

  if (part.type === 'agent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 border border-gray-200">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        {part.name}
      </span>
    );
  }

  return null;
}

export function hasVisibleParts(msg: ChatMessage): boolean {
  return msg.parts.some((p) =>
    p.type === 'text' || p.type === 'reasoning' || p.type === 'tool' || p.type === 'agent' || p.type === 'file'
  );
}
