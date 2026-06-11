import type { FormEvent } from 'react';

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isLoading: boolean;
  engineDisabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onAbort: () => void;
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
}: Props) {
  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t border-gray-200 p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={engineDisabled ? '请先配置引擎...' : '输入消息...'}
          disabled={isLoading || engineDisabled}
          rows={1}
          className="flex-1 px-3 py-2 text-gray-800 bg-white border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400 resize-none min-h-[36px] max-h-[120px] disabled:opacity-50"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = Math.min(target.scrollHeight, 120) + 'px';
          }}
        />
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
            disabled={!input.trim() || engineDisabled}
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
