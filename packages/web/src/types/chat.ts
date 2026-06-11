export interface ChatSession {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
    updated: number;
  };
}

export interface MessageTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ChatMessage {
  info: {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    time: { created: number; completed?: number };
    /**
     * SDK UserMessage 持久化了发送时的 system 字段（即前端传入的 pageContext）。
     * 调试面板通过此字段回溯每条用户消息实际携带的上下文。
     */
    system?: string;
    /**
     * SDK AssistantMessage 携带的 token 消耗统计（仅 assistant 消息有值）。
     * 用于 token 用量监控。
     */
    tokens?: MessageTokens;
    /** 消息费用（仅 assistant 消息有值） */
    cost?: number;
  };
  parts: ChatPart[];
}

export interface ChatPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  name?: string;
  reason?: string;
  messageID?: string;
  state?: {
    status: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 图片附件 & file part 类型
// ---------------------------------------------------------------------------

/**
 * 图片附件状态：用于 useChat hook 中管理待上传 / 已上传 / 出错的图片。
 *
 * 上游（AIChatWidget 图片选择器）创建此对象，useChat 负责驱动状态流转：
 * pending → uploading → done / error
 *
 * 下游（sendMessage）从 status=done 的附件中提取 remotePath / mime / filename
 * 构建 FilePartInput 发给后端。
 */
export interface ImageAttachment {
  /** 前端生成的唯一 ID（用于列表 key 和状态追踪） */
  id: string;
  /** 用户选择的原始 File 对象 */
  file: File;
  /** 本地预览 URL（URL.createObjectURL，组件卸载时需 revoke） */
  previewUrl: string;
  /** 上传状态 */
  status: 'pending' | 'uploading' | 'done' | 'error';
  /** 上传成功后后端返回的相对路径（status=done 时一定有值） */
  remotePath?: string;
  /** MIME 类型 */
  mime: string;
  /** 原始文件名 */
  filename: string;
  /** 文件大小（字节） */
  size: number;
  /** 上传失败时的错误信息（status=error 时可能有值） */
  error?: string;
}

/**
 * 消息中 file 类型 part 的前端类型。
 * 对齐后端 SendMessageBody 中的 FilePartInput。
 *
 * 消息渲染层通过 ChatPart.type === 'file' 识别此类型，
 * 从 url 字段获取图片路径并渲染缩略图。
 */
export interface FilePartInput {
  type: 'file';
  /** 图片/文件 MIME 类型 */
  mime: string;
  /** 相对于工作目录的文件路径 */
  url: string;
  /** 原始文件名 */
  filename?: string;
}

/**
 * 消息中 text 类型 part 的前端类型。
 * 对齐后端 SendMessageBody 中的 TextPartInput。
 */
export interface TextPartInput {
  type: 'text';
  text: string;
}

/** 消息 parts 联合类型 */
export type MessagePartInput = TextPartInput | FilePartInput;

/**
 * uploadImage API 响应体。
 * 与后端 UploadImageResponse 类型一一对应。
 */
export interface UploadImageResponse {
  path: string;
  mime: string;
  filename: string;
  size: number;
}

/**
 * AIChatWidget 多模式配置。
 * 每种模式对应不同的 pageContext，用于在同一页面的不同视角间切换
 * （如「任务视图」与「详情步骤视图」）。
 *
 * 上游：由页面组件（如 TaskGraphPage）构造并传入 AIChatWidget。
 * 下游：AIChatWidget 根据当前激活的 ChatMode 选取对应 context 注入会话。
 */
export interface ChatMode {
  key: string;          // 唯一标识，如 'step'、'task'
  label: string;        // 显示文本，如「任务」「详情步骤」
  description?: string; // 可选说明，如「查看项目所有任务」
  context: string;      // 该模式的 pageContext 文本
}

export interface SSEEventPayload {
  type: string;
  properties: {
    part?: ChatPart;
    delta?: string;
    messageID?: string;
    partID?: string;
    field?: string;
    info?: {
      id: string;
      sessionID: string;
      role: 'user' | 'assistant';
      [key: string]: unknown;
    };
    sessionID?: string;
    status?: { type: string };
    [key: string]: unknown;
  };
}
