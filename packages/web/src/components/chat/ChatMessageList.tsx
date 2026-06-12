import type { ChatMessage } from '@/types/chat';
import type { Step } from '@/types/step';
import { PartRenderer, hasVisibleParts, resolveImageUrl } from './PartRenderer';
import ImageLightbox from './ImageLightbox';
import { useState, useCallback } from 'react';

const S = 'ChatMessageList';

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  loadingTimedOut: boolean;
  sessionBroken: boolean;
  compacted: boolean;
  projectId?: string;
  taskId?: string;
  currentSessionId?: string;
  importedPlanTasks: Set<string>;
  onPlanImported: (name: string) => void;
  existingSteps?: Step[];
  currentTaskName?: string;
  effectivePageContext?: string;
  onRetryInNewSession: () => void;
  onDismissSessionBroken: () => void;
  onResetLoading: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /**
   * 项目工作目录，用于构建图片 serve-image URL。
   * 上游：由 AIChatWidget 传入。
   * 下游：传递给 PartRenderer 和用户消息气泡中的图片缩略图。
   */
  directory?: string;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 从文本中解析 [附图] 标记，提取图片信息。
 * 格式：[附图]\n- filename: .opencode/tmp/images/xxx.png
 *
 * 返回 { displayText, images }：
 * - displayText: 去掉 [附图] 段落后的纯文本
 * - images: { url, filename } 数组，用于渲染缩略图
 */
function parseImageRefs(text: string): { displayText: string; images: Array<{ url: string; filename: string }> } {
  const marker = '[附图]';
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) return { displayText: text, images: [] };

  const displayText = text.slice(0, markerIdx).trimEnd();
  const refBlock = text.slice(markerIdx + marker.length);
  const images: Array<{ url: string; filename: string }> = [];

  for (const line of refBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    const content = trimmed.slice(2); // 去掉 "- "
    const colonIdx = content.indexOf(': ');
    if (colonIdx === -1) continue;
    const filename = content.slice(0, colonIdx).trim();
    const url = content.slice(colonIdx + 2).trim();
    if (url) images.push({ url, filename });
  }

  return { displayText, images };
}

/**
 * 解析用户消息中的 <env-context>...</env-context> 标签。
 * 返回 { meta, displayText }：
 * - meta: 标签内的环境上下文文本（若无标签则为 null）
 * - displayText: 剥离标签后的用户实际输入文本
 */
function parseEnvContext(text: string): { meta: string | null; displayText: string } {
  const openTag = '<env-context>';
  const closeTag = '</env-context>';
  const startIdx = text.indexOf(openTag);
  if (startIdx === -1) return { meta: null, displayText: text };

  const contentStart = startIdx + openTag.length;
  const closeIdx = text.indexOf(closeTag, contentStart);
  if (closeIdx === -1) return { meta: null, displayText: text };

  const meta = text.slice(contentStart, closeIdx).trim();
  // 剥离标签及其后紧跟的空白
  const afterTag = text.slice(closeIdx + closeTag.length).replace(/^\n+/, '');
  return { meta, displayText: afterTag.trim() };
}

/**
 * 用户消息气泡 — 包含文本、图片缩略图、env-context 折叠面板。
 * env-context 以叹号图标展示，点击展开完整上下文信息。
 */
function UserMessageBubble({
  msgId,
  displayText,
  allImages,
  envMeta,
  createdAt,
  directory,
  openLightbox,
}: {
  msgId: string;
  displayText: string;
  allImages: Array<{ url: string; filename: string }>;
  envMeta: string | null;
  createdAt: number;
  directory?: string;
  openLightbox: (src: string, alt?: string) => void;
}) {
  const [showMeta, setShowMeta] = useState(false);

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] flex flex-col items-end gap-1">
        <div className="rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed bg-sky-500 text-white">
          {displayText && <p className="whitespace-pre-wrap break-words">{displayText}</p>}
          {/* 用户消息中的图片缩略图列表 */}
          {allImages.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${displayText ? 'mt-2' : ''}`}>
              {allImages.map((img, idx) => {
                const resolvedUrl = resolveImageUrl(img.url, directory);
                return (
                  <button
                    key={`img-${idx}-${img.url}`}
                    type="button"
                    onClick={() => openLightbox(resolvedUrl, img.filename)}
                    className="block max-w-[120px] max-h-[90px] rounded-lg overflow-hidden border border-white/30 hover:border-white/60 transition-colors cursor-pointer"
                    title="点击查看大图"
                  >
                    <img
                      src={resolvedUrl}
                      alt={img.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部行：时间 + env-context 折叠图标 */}
        <div className="flex items-center gap-1.5 px-1">
          <p className="text-[10px] text-gray-400">{formatTime(createdAt)}</p>
          {envMeta && (
            <button
              type="button"
              onClick={() => setShowMeta((prev) => !prev)}
              className="inline-flex items-center gap-0.5 text-[10px] text-sky-400 hover:text-sky-500 transition-colors cursor-pointer"
              title="查看环境上下文"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span className="text-[9px]">上下文</span>
            </button>
          )}
        </div>

        {/* env-context 展开面板 */}
        {envMeta && showMeta && (
          <div className="w-full max-h-[200px] overflow-y-auto rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500 font-mono whitespace-pre-wrap break-words leading-relaxed">
            {envMeta}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatMessageList({
  messages,
  streamingText,
  isLoading,
  loadingTimedOut,
  sessionBroken,
  compacted,
  projectId,
  taskId,
  currentSessionId,
  importedPlanTasks,
  onPlanImported,
  existingSteps,
  currentTaskName,
  effectivePageContext,
  onRetryInNewSession,
  onDismissSessionBroken,
  onResetLoading,
  messagesEndRef,
  directory,
}: Props) {
  // ─── Lightbox 状态：用户消息气泡中图片缩略图点击打开全屏预览 ───
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState('图片预览');

  const openLightbox = useCallback((src: string, alt?: string) => {
    setLightboxSrc(src);
    setLightboxAlt(alt || '图片预览');
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxSrc(null);
  }, []);
  return (
    <>
      {/* 功能三：引擎自动压缩提示 */}
      {compacted && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-600 shrink-0">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>上下文已自动压缩，较早的历史消息已被摘要以节省 token</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streamingText && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p>发送消息开始对话</p>
            <p className="text-xs mt-1 text-gray-400">AI 助手将帮助你完成任务</p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.info.role === 'user';
          if (!hasVisibleParts(msg)) return null;

          if (isUser) {
            const textParts = msg.parts.filter((p) => p.type === 'text');
            const fileParts = msg.parts.filter((p) => p.type === 'file');
            const rawText = textParts
              .map((p) => ('text' in p ? p.text : ''))
              .join('\n');
            // 先剥离 <env-context> 标签，再解析 [附图] 标记
            const { meta: envMeta, displayText: textAfterEnv } = parseEnvContext(rawText);
            const { displayText, images: textImageRefs } = parseImageRefs(textAfterEnv);
            // 合并：file parts（乐观 UI 阶段） + 文本中解析出的图片引用（服务端刷新后）
            const allImages = [
              ...fileParts
                .filter((fp) => (fp.mime as string | undefined)?.startsWith('image/') && fp.url)
                .map((fp) => ({ url: fp.url as string, filename: (fp.filename as string) || '图片' })),
              ...textImageRefs,
            ];
            // 用户消息至少需要文本或图片才渲染
            if (!displayText && allImages.length === 0) return null;
            return (
              <UserMessageBubble
                key={msg.info.id}
                msgId={msg.info.id}
                displayText={displayText}
                allImages={allImages}
                envMeta={envMeta}
                createdAt={msg.info.time.created}
                directory={directory}
                openLightbox={openLightbox}
              />
            );
          }

          return (
            <div key={msg.info.id} className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-gray-50 border border-gray-200 text-gray-700 space-y-2">
                {msg.parts.map((part) => (
                  <PartRenderer
                    key={part.id}
                    part={part}
                    projectId={projectId}
                    taskId={taskId}
                    chatSessionId={currentSessionId}
                    importedPlanTasks={importedPlanTasks}
                    onPlanImported={onPlanImported}
                    existingSteps={existingSteps}
                    currentTaskName={currentTaskName}
                    directory={directory}
                  />
                ))}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-gray-400">{formatTime(msg.info.time.created)}</p>
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && streamingText && (() => {
          const PLAN_TAG = '<task-plan>';
          const planStart = streamingText.indexOf(PLAN_TAG);

          let visibleText = streamingText;
          let showPlanPlaceholder = false;

          if (planStart !== -1) {
            visibleText = streamingText.slice(0, planStart);
            showPlanPlaceholder = true;
          } else {
            const lastLt = streamingText.lastIndexOf('<');
            if (lastLt !== -1) {
              const tail = streamingText.slice(lastLt);
              if (PLAN_TAG.startsWith(tail)) {
                visibleText = streamingText.slice(0, lastLt);
                showPlanPlaceholder = true;
              }
            }
          }

          return (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-gray-50 border border-gray-200 text-gray-700">
                {visibleText && <p className="whitespace-pre-wrap break-words">{visibleText}</p>}
                {showPlanPlaceholder && (
                  <div className="flex items-center gap-2 py-1.5 px-3 bg-sky-50 border border-sky-100 rounded-lg">
                    <svg className="w-3.5 h-3.5 text-sky-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-sky-600">计划生成中...</span>
                  </div>
                )}
                {!showPlanPlaceholder && (
                  <span className="inline-block w-1.5 h-4 bg-sky-400 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </div>
          );
        })()}

        {isLoading && !streamingText && !loadingTimedOut && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-50 border border-gray-200 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {loadingTimedOut && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-red-50 border border-red-200 text-red-600">
              <p>响应超时，AI 助手未能回复。请检查引擎状态或稍后重试。</p>
              <button
                type="button"
                onClick={onResetLoading}
                className="mt-1.5 text-xs text-red-500 underline hover:text-red-700 cursor-pointer"
              >
                关闭提示
              </button>
            </div>
          </div>
        )}

        {sessionBroken && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-amber-50 border border-amber-200 text-amber-700">
              <p>当前会话模型配置异常，AI 无法回复。</p>
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => onRetryInNewSession()}
                  className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded hover:bg-amber-600 cursor-pointer"
                >
                  新建会话并重试
                </button>
                <button
                  type="button"
                  onClick={onDismissSessionBroken}
                  className="text-xs text-amber-500 underline hover:text-amber-700 cursor-pointer"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── 全局 Lightbox：用户消息气泡中缩略图点击后打开 ─── */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} alt={lightboxAlt} onClose={closeLightbox} />
      )}
    </>
  );
}
