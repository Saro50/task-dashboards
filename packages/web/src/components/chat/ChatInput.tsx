import React, { type FormEvent, type ClipboardEvent } from 'react';
import type { ImageAttachment } from '@/types/chat';
import type { FocusedItem } from '@/components/AIChatWidget';

interface Props {
  input: string;
  onInputChange: (value: string, cursorPos?: number) => void;
  onSubmit: (e: FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isLoading: boolean;
  engineDisabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onAbort: () => void;
  /** @mention 下拉菜单是否激活 */
  atActive?: boolean;
  /** @mention 搜索结果列表 */
  atResults?: string[];
  /** @mention 当前高亮索引 */
  atSelectedIndex?: number;
  /** @mention 搜索加载中 */
  atLoading?: boolean;
  /** @mention 当前搜索关键词，用于高亮匹配文本 */
  atQuery?: string;
  /** @mention 选中回调 */
  onAtSelect?: (filePath: string) => void;
  /** @mention 鼠标悬停回调，更新高亮索引 */
  onAtHover?: (index: number) => void;
  /** 当前图片附件列表 */
  attachments?: ImageAttachment[];
  /** 添加图片附件回调 */
  onAddAttachments?: (files: File[]) => void;
  /** 删除图片附件回调 */
  onRemoveAttachment?: (id: string) => void;
  /** 粘贴图片回调 */
  onPasteImage?: (files: File[]) => void;
  /** 是否有附件正在上传中 */
  hasUploadingAttachments?: boolean;
  /** 当前聚焦的卡片（任务或步骤） */
  focusedItem?: FocusedItem;
  /** 取消聚焦回调 */
  onClearFocus?: () => void;
}

/**
 * 根据文件扩展名返回对应的 SVG 图标。
 * 上游：由 AtFileDropdown 渥染时调用
 * 下游：返回 JSX 图标元素
 */
function FileIcon({ filePath }: { filePath: string }) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  // TypeScript / JavaScript
  if (ext === 'ts' || ext === 'tsx') {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h18v18H3V3zm10.71 14.29c.18.18.43.29.71.29s.53-.11.71-.29l2-2a1.003 1.003 0 00-1.42-1.42L14.5 15.09V10a1 1 0 10-2 0v5.09l-1.21-1.21a1.003 1.003 0 00-1.42 1.42l2 2z" />
      </svg>
    );
  }
  if (ext === 'js' || ext === 'jsx') {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-yellow-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h18v18H3V3zm10.71 14.29c.18.18.43.29.71.29s.53-.11.71-.29l2-2a1.003 1.003 0 00-1.42-1.42L14.5 15.09V10a1 1 0 10-2 0v5.09l-1.21-1.21a1.003 1.003 0 00-1.42 1.42l2 2z" />
      </svg>
    );
  }

  // CSS / SCSS
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
      </svg>
    );
  }

  // JSON / YAML / TOML / ENV
  if (['json', 'yaml', 'yml', 'toml', 'env', 'ini'].includes(ext) || filePath.endsWith('.env')) {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Markdown / text
  if (['md', 'mdx', 'txt'].includes(ext)) {
    return (
      <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Default file icon
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 将文件路径拆分为目录部分和文件名部分，
 * 并对匹配 query 的文本片段进行高亮渲染。
 *
 * 上游：由 AtFileDropdown 列表项调用
 * 下游：返回带高亮的 JSX 片段
 */
function HighlightedPath({
  filePath,
  query,
}: {
  filePath: string;
  query: string;
}) {
  const lastSlash = filePath.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : '';
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

  if (!query) {
    return (
      <>
        {dirPart && <span className="text-gray-400 truncate">{dirPart}</span>}
        <span className="text-gray-800 font-medium truncate">{fileName}</span>
      </>
    );
  }

  // 高亮匹配：在整个路径中做 case-insensitive 匹配
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIdx = lowerPath.indexOf(lowerQuery);

  if (matchIdx === -1) {
    // 未匹配到（理论上不应出现，因为后端已过滤），原样显示
    return (
      <>
        {dirPart && <span className="text-gray-400 truncate">{dirPart}</span>}
        <span className="text-gray-800 font-medium truncate">{fileName}</span>
      </>
    );
  }

  const before = filePath.slice(0, matchIdx);
  const matched = filePath.slice(matchIdx, matchIdx + query.length);
  const after = filePath.slice(matchIdx + query.length);

  return (
    <span className="truncate">
      <span className="text-gray-400">{before}</span>
      <span className="text-sky-600 font-semibold">{matched}</span>
      <span className="text-gray-400">{after}</span>
    </span>
  );
}

export default function ChatInput({
  input,
  onInputChange,
  onSubmit,
  onKeyDown,
  isLoading,
  engineDisabled,
  inputRef,
  onAbort,
  atActive,
  atResults,
  atSelectedIndex,
  atLoading,
  atQuery,
  onAtSelect,
  onAtHover,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onPasteImage,
  hasUploadingAttachments,
  focusedItem,
  onClearFocus,
}: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && onAddAttachments) {
      onAddAttachments(Array.from(files));
    }
    // 清空 input value 以便同一文件可重复选择
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      if (onPasteImage) {
        // 阻止默认粘贴行为，避免图片以文本形式插入 textarea
        e.preventDefault();
        onPasteImage(imageFiles);
      }
    }
  };

  const hasAttachments = attachments && attachments.length > 0;
  // 发送按钮禁用：无文本且无附件、引擎禁用、正在上传附件
  const submitDisabled = engineDisabled || hasUploadingAttachments || (!input.trim() && !hasAttachments);

  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t border-gray-200 p-3">
      {/* ─── 聚焦卡片提示横条 ─── */}
      {focusedItem && (
        <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-sky-50 border border-sky-200 rounded-lg">
          <svg className="w-3.5 h-3.5 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs text-sky-700 flex-1 min-w-0">
            <span className="text-sky-500 font-medium">{focusedItem.type === 'task' ? '任务' : '步骤'}</span>
            <span className="mx-1 text-sky-300">·</span>
            <span className="truncate">{focusedItem.name}</span>
            <span className="text-sky-400 ml-1.5">({focusedItem.status})</span>
          </span>
          <button
            type="button"
            onClick={() => onClearFocus?.()}
            className="shrink-0 p-0.5 rounded hover:bg-sky-100 text-sky-400 hover:text-sky-600 transition-colors cursor-pointer"
            title="取消聚焦"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ─── 附件预览区域 ─── */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="relative group w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 shrink-0"
            >
              <img
                src={att.previewUrl}
                alt={att.filename}
                className="w-full h-full object-cover"
              />
              {/* 上传中遮罩 */}
              {att.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
              {/* 上传失败遮罩 */}
              {att.status === 'error' && (
                <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              )}
              {/* 删除按钮 */}
              {att.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(att.id)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="relative flex items-center gap-2">
        {/* ─── 图片选择按钮 ─── */}
        <button
          type="button"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          disabled={isLoading || engineDisabled}
          title="添加图片"
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors text-gray-400 hover:text-sky-500 hover:bg-sky-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21ZM10.5 3v18" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? undefined)}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            placeholder={engineDisabled ? '请先配置引擎...' : '输入消息...（@ 引用文件，可粘贴图片）'}
            disabled={isLoading || engineDisabled}
            rows={1}
            className="w-full px-3 py-2 text-gray-800 bg-white border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400 resize-none max-h-[120px] disabled:opacity-50"
            style={{ height: '36px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = '36px';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />

          {/* ─── @mention 文件搜索下拉菜单 ─── */}
          {atActive && (
            <div
              data-at-dropdown
              className="absolute bottom-full left-0 right-0 mb-1.5 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50"
            >
              {/* 标题栏 */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 bg-gray-50/80">
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] font-medium text-gray-500">文件搜索</span>
              </div>

              {/* 列表内容 */}
              <div className="max-h-[200px] overflow-y-auto">
                {/* 加载中状态 */}
                {atLoading && (
                  <div className="flex items-center justify-center gap-2 py-4 text-gray-400">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs">搜索中...</span>
                  </div>
                )}

                {/* 非加载状态：有结果 */}
                {!atLoading && atResults && atResults.length > 0 && (
                  atResults.map((file, idx) => (
                    <button
                      key={file}
                      type="button"
                      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                        idx === atSelectedIndex
                          ? 'bg-sky-50 text-sky-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      onClick={() => onAtSelect?.(file)}
                      onMouseDown={(e) => e.preventDefault()} // 阻止 textarea 失焦
                      onMouseEnter={() => onAtHover?.(idx)}
                    >
                      <FileIcon filePath={file} />
                      <HighlightedPath filePath={file} query={atQuery ?? ''} />
                    </button>
                  ))
                )}

                {/* 非加载状态：无结果 */}
                {!atLoading && atResults && atResults.length === 0 && (
                  <div className="py-4 text-center text-xs text-gray-400">
                    未找到匹配文件
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <button
            type="button"
            onClick={onAbort}
            title="停止生成"
            className="shrink-0 w-9 h-9 bg-red-500 hover:bg-red-600 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={submitDisabled}
            title="发送"
            className="shrink-0 w-9 h-9 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:opacity-50 rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
           <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
