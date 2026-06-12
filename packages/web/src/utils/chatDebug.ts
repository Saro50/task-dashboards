/**
 * chatDebug — AI 聊天调试信息输出工具
 *
 * 仅在开发环境 (import.meta.env.DEV) 下生效。
 * 所有输出直接写入浏览器 DevTools Console，使用 console.group + %c 彩色样式，
 * 方便开发者在 Console 面板中查看用户输入、系统提示词、Token 用量等信息。
 *
 * 上下游影响：
 * - 上游：由 useChat（sendMessage / SSE 事件）和 AIChatWidget（handleSubmit）调用。
 * - 下游：纯 console 输出，不产生任何副作用、不修改任何状态。
 */
import type { ChatMessage, ChatMode } from '@/types/chat';

/* ── 样式常量 ───────────────────────────────────── */

const STYLE = {
  /** 分组标题：蓝底白字 */
  title: 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:3px;font-weight:bold;font-size:12px;',
  /** 子标题：浅灰底 */
  subtitle: 'color:#6b7280;font-size:11px;',
  /** 字段名 */
  key: 'color:#9333ea;font-weight:bold;',
  /** 值（普通） */
  value: 'color:#1f2937;',
  /** 值（成功/有值） */
  success: 'color:#16a34a;font-weight:bold;',
  /** 值（警告/无值） */
  warn: 'color:#ea580c;font-weight:bold;',
  /** 值（强调） */
  accent: 'color:#2563eb;font-weight:bold;',
  /** 分隔线 */
  divider: 'color:#d1d5db;',
} as const;

/* ── 工具函数 ───────────────────────────────────── */

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 粗略估算 token 数：中英混合约 3.5 字符/token */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function formatLength(text?: string | null): string {
  if (!text) return '0';
  return text.length.toLocaleString();
}

/* ── DEV 环境实现 ───────────────────────────────── */

const impl = {
  /**
   * 输出一次完整的请求信息（用户消息 + Agent + Context 注入状态）。
   * 在 useChat.sendMessage 中调用。
   */
  request(params: {
    text: string;
    agent: string;
    directory?: string;
    sessionId: string;
  }) {
    const { text, agent, directory, sessionId } = params;
    const time = now();

    console.group(`%c 📤 Chat Request  ${time} `, STYLE.title);
    console.log(`%c用户消息%c  %c${text}`, STYLE.key, '', STYLE.value);
    console.log(`%cAgent%c     %c${agent}`, STYLE.key, '', STYLE.accent);
    console.log(`%cSession%c   %c${sessionId}`, STYLE.key, '', STYLE.value);
    if (directory) {
      console.log(`%cDirectory%c %c${directory}`, STYLE.key, '', STYLE.value);
    }

    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },

  /**
   * 输出当前生效的系统提示词信息。
   * 在 AIChatWidget.handleSubmit 中调用。
   */
  systemPrompt(params: {
    pageContext?: string;
    activeMode: ChatMode | null;
    contextToSend?: string;
    reason?: string;
  }) {
    const { pageContext, activeMode, contextToSend, reason } = params;

    console.group(`%c 💬 System Prompt `, STYLE.title);

    if (activeMode) {
      console.log(
        `%c来源%c     %cChatMode: ${activeMode.label} (${activeMode.key})${activeMode.description ? ` — ${activeMode.description}` : ''}`,
        STYLE.key, '', STYLE.accent,
      );
    } else if (pageContext) {
      console.log(`%c来源%c     %cpageContext prop`, STYLE.key, '', STYLE.accent);
    } else {
      console.log(`%c来源%c     %c无`, STYLE.key, '', STYLE.warn);
    }

    console.log(
      `%cpageContext%c  %c${pageContext ? `${formatLength(pageContext)} 字符 / ~${estimateTokens(pageContext)} tokens` : '（空）'}`,
      STYLE.key, '', pageContext ? STYLE.value : STYLE.warn,
    );
    console.log(
      `%c本次注入%c    %c${contextToSend ? `✅ 是 (reason: ${reason ?? 'unknown'})` : '⏭ 跳过（内容未变化）'}`,
      STYLE.key, '', contextToSend ? STYLE.success : STYLE.warn,
    );

    if (pageContext) {
      console.groupCollapsed(`%cpageContext 完整内容`, STYLE.subtitle);
      console.log(pageContext);
      console.groupEnd();
    }

    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },

  /**
   * 输出历史消息中所有携带 system 字段的 user 消息。
   * 在消息加载完成后调用。
   */
  history(messages: ChatMessage[]) {
    const userMsgs = messages.filter((m) => m.info.role === 'user');
    if (userMsgs.length === 0) return;

    console.group(`%c 📜 Message History (%d 条 user 消息) `, STYLE.title, userMsgs.length);

    for (const msg of userMsgs) {
      const textPart = msg.parts.find((p) => p.type === 'text');
      const preview = (textPart?.text ?? '').slice(0, 60);
      const hasSystem = !!msg.info.system;
      const time = new Date(msg.info.time.created * 1000).toLocaleTimeString('zh-CN');

      console.groupCollapsed(
        `%c[${time}] %c${preview}${preview.length >= 60 ? '...' : ''}  %c${hasSystem ? `📄 system: ${formatLength(msg.info.system)} 字符` : '— 无 system'}`,
        STYLE.subtitle, '', hasSystem ? STYLE.success : STYLE.warn,
      );

      if (textPart?.text) {
        console.log(`%c用户文本:%c`, STYLE.key, '');
        console.log(textPart.text);
      }
      if (msg.info.system) {
        console.log(`%csystem 字段:%c`, STYLE.key, '');
        console.log(msg.info.system);
      }
      console.groupEnd();
    }

    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },

  /**
   * 输出当前会话状态概要。
   */
  session(params: {
    sessionId: string | null;
    sessionTitle?: string;
    agent: string;
    directory?: string;
    connected: boolean;
    loading: boolean;
    compacted: boolean;
    messageCount: number;
  }) {
    const { sessionId, sessionTitle, agent, directory, connected, loading, compacted, messageCount } = params;

    console.group(`%c ⚙️ Session State `, STYLE.title);
    console.log(`%cSession%c    %c${sessionId ?? '(无)'}`, STYLE.key, '', STYLE.value);
    if (sessionTitle) console.log(`%cTitle%c      %c${sessionTitle}`, STYLE.key, '', STYLE.value);
    console.log(`%cAgent%c      %c${agent}`, STYLE.key, '', STYLE.accent);
    if (directory) console.log(`%cDirectory%c  %c${directory}`, STYLE.key, '', STYLE.value);
    console.log(`%cSSE%c        %c${connected ? '🟢 已连接' : '🔴 已断开'}`, STYLE.key, '', connected ? STYLE.success : STYLE.warn);
    console.log(`%cLoading%c    %c${loading ? '⏳ 是' : '✅ 否'}`, STYLE.key, '', loading ? STYLE.warn : STYLE.success);
    console.log(`%cCompacted%c  %c${compacted ? '⚠️ 已压缩' : '—'}`, STYLE.key, '', compacted ? STYLE.warn : STYLE.value);
    console.log(`%cMessages%c   %c${messageCount}`, STYLE.key, '', STYLE.value);
    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },

  /**
   * 输出所有 assistant 消息的 Token 用量统计 + 汇总。
   */
  tokens(messages: ChatMessage[]) {
    const assistantMsgs = messages.filter(
      (m) => m.info.role === 'assistant' && m.info.tokens,
    );
    if (assistantMsgs.length === 0) return;

    console.group(`%c 📊 Token Usage `, STYLE.title);

    let totalInput = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let totalCost = 0;

    for (const msg of assistantMsgs) {
      const t = msg.info.tokens!;
      const time = new Date(msg.info.time.created * 1000).toLocaleTimeString('zh-CN');
      const costStr = msg.info.cost != null ? `¥${msg.info.cost.toFixed(4)}` : '—';
      const textPart = msg.parts.find((p) => p.type === 'text');
      const preview = (textPart?.text ?? '').slice(0, 40);

      console.log(
        `%c[${time}]%c ${preview}${preview.length >= 40 ? '...' : ''}  %cin:${t.input} out:${t.output} reason:${t.reasoning} cache(r:${t.cache.read}/w:${t.cache.write}) cost:${costStr}`,
        STYLE.subtitle, '', STYLE.value,
      );

      totalInput += t.input;
      totalOutput += t.output;
      totalReasoning += t.reasoning;
      totalCost += msg.info.cost ?? 0;
    }

    console.log(
      `%c合计%c  input: ${totalInput.toLocaleString()}  output: ${totalOutput.toLocaleString()}  reasoning: ${totalReasoning.toLocaleString()}  cost: ¥${totalCost.toFixed(4)}`,
      STYLE.key, STYLE.accent,
    );
    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },

  /**
   * 输出 SSE 事件流中的关键事件。
   */
  sseEvent(eventType: string, detail?: Record<string, unknown>) {
    const time = now();
    const style = eventType === 'session.idle'
      ? 'background:#16a34a;color:#fff;padding:1px 6px;border-radius:2px;font-size:10px;'
      : eventType === 'session.compacted'
        ? 'background:#ea580c;color:#fff;padding:1px 6px;border-radius:2px;font-size:10px;'
        : 'background:#6b7280;color:#fff;padding:1px 6px;border-radius:2px;font-size:10px;';

    if (detail) {
      console.log(`%c SSE %c ${eventType} %c ${time} `, style, '', STYLE.subtitle, detail);
    } else {
      console.log(`%c SSE %c ${eventType} %c ${time} `, style, '', STYLE.subtitle);
    }
  },

  /**
   * 输出完整的一轮对话汇总（请求 + Token + 历史）。
   * 在 SSE idle（回复完成）时调用。
   */
  roundSummary(messages: ChatMessage[]) {
    console.group(`%c 🔄 Round Summary `, STYLE.title);
    impl.tokens(messages);

    const lastAssistant = [...messages].reverse().find((m) => m.info.role === 'assistant');
    if (lastAssistant) {
      const textParts = lastAssistant.parts.filter((p) => p.type === 'text' && p.text);
      if (textParts.length > 0) {
        console.groupCollapsed(`%c最近 assistant 回复`, STYLE.subtitle);
        for (const p of textParts) {
          console.log((p as { text: string }).text);
        }
        console.groupEnd();
      }
    }

    console.log(`%c${'─'.repeat(50)}`, STYLE.divider);
    console.groupEnd();
  },
};

/* ── 生产环境空实现 ─────────────────────────────── */

function noop(..._args: unknown[]) {}

const emptyImpl = {
  request: noop as typeof impl.request,
  systemPrompt: noop as typeof impl.systemPrompt,
  history: noop as typeof impl.history,
  session: noop as typeof impl.session,
  tokens: noop as typeof impl.tokens,
  sseEvent: noop as typeof impl.sseEvent,
  roundSummary: noop as typeof impl.roundSummary,
};

/* ── 导出 ───────────────────────────────────────── */

export const chatDebug = import.meta.env.DEV ? impl : emptyImpl;
