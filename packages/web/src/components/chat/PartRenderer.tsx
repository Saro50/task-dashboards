import type { ChatPart, ChatMessage } from '@/types/chat';
import type { StepPlan, Step } from '@/types/step';
import StepPlanPreview from '../StepPlanPreview';
import { Collapsible, ToolStatusLabel } from './Collapsible';

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

export function PartRenderer({ part, projectId, taskId, chatSessionId, importedPlanTasks, onPlanImported, existingSteps, currentTaskName }: {
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
}) {
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
    p.type === 'text' || p.type === 'reasoning' || p.type === 'tool' || p.type === 'agent'
  );
}
