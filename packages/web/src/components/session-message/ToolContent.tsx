import { Collapsible } from './Collapsible';
import { ToolStatusLabel } from './ToolStatusLabel';
import type { AssistantTool } from '@/types/session-message';

export function ToolContent({ tool }: { tool: AssistantTool }) {
  const state = tool.state;
  const title = tool.name;
  const output = 'content' in state
    ? state.content.map((c: any) => c.text || '').filter(Boolean).join('\n')
    : '';

  return (
    <Collapsible
      title={
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-gray-700">{title}</span>
          <ToolStatusLabel status={state.status} />
        </span>
      }
    >
      <div className="space-y-1">
        {'input' in state && state.input && (
          <div className="rounded bg-gray-100 px-2 py-1">
            <p className="text-[10px] text-gray-400 mb-0.5">输入</p>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
              {typeof state.input === 'string'
                ? state.input
                : JSON.stringify(state.input, null, 2)}
            </pre>
          </div>
        )}
        {output && (
          <div className="rounded bg-gray-100 px-2 py-1">
            <p className="text-[10px] text-gray-400 mb-0.5">输出</p>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
              {output}
            </pre>
          </div>
        )}
        {'error' in state && state.error && (
          <div className="rounded bg-red-50 px-2 py-1">
            <p className="text-xs text-red-600">{state.error.message}</p>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
