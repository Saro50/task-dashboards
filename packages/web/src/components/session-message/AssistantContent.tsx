import { Collapsible } from './Collapsible';
import { ToolContent } from './ToolContent';
import type { SessionMessageAssistant } from '@/types/session-message';

export function AssistantContent({ content }: { content: SessionMessageAssistant['content'] }) {
  return (
    <div className="space-y-1.5">
      {content.map((part, i) => {
        if (part.type === 'text' && part.text) {
          return <p key={i} className="text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{part.text}</p>;
        }
        if (part.type === 'reasoning' && part.text) {
          const preview = part.text.length > 60 ? part.text.slice(0, 60) + '...' : part.text;
          return (
            <Collapsible key={i} title={<span className="italic text-gray-400">思考: {preview}</span>}>
              <p className="text-xs text-gray-400 italic whitespace-pre-wrap break-words border-l-2 border-gray-200 pl-2 leading-relaxed">
                {part.text}
              </p>
            </Collapsible>
          );
        }
        if (part.type === 'tool') {
          return <ToolContent key={part.id} tool={part} />;
        }
        return null;
      })}
    </div>
  );
}
