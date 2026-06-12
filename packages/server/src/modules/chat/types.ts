export interface CreateSessionBody {
  directory?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// 消息 Parts 类型：与 @opencode-ai/sdk 的 TextPartInput / FilePartInput 对齐
// ---------------------------------------------------------------------------

/**
 * 文本 part：对应 SDK 的 TextPartInput。
 * 上游（前端 / controller）构造，下游（opencode.ts）直接透传给 SDK。
 */
export interface TextPartInput {
  type: 'text';
  text: string;
}

/**
 * 文件 part：对应 SDK 的 FilePartInput。
 * url 为相对于项目工作目录的路径（如 .opencode/tmp/images/<uuid>.png），
 * opencode 引擎会在工作目录下解析该相对路径读取文件内容。
 */
export interface FilePartInput {
  type: 'file';
  /** 图片/文件 MIME 类型（如 image/png） */
  mime: string;
  /** 相对于工作目录的文件路径 */
  url: string;
  /** 原始文件名 */
  filename?: string;
}

/** 消息 parts 联合类型 */
export type MessagePartInput = TextPartInput | FilePartInput;

/**
 * POST /sessions/:id/send 请求体
 *
 * 支持两种调用方式（向后兼容）：
 * 1. 旧版：只传 text 字段 → controller 自动包装为 [{ type: 'text', text }]
 * 2. 新版：传 parts 数组 → 直接使用，支持文本 + 文件混合
 */
export interface SendMessageBody {
  /** @deprecated 使用 parts 代替。向后兼容：若 parts 未传则仍使用 text */
  text?: string;
  /** 消息 parts 数组，支持 text / file 类型混合 */
  parts?: MessagePartInput[];
  agent?: string;
}

export interface UpdateSessionBody {
  title?: string;
}

/**
 * POST /api/chat/upload-image 响应体
 *
 * 上游（controller）将此结构直接返回给前端；
 * 后续消息发送链路会通过 path 字段读取图片并构建 file part 发给 AI。
 */
export interface UploadImageResponse {
  /** 相对于项目工作目录的图片存储路径（.opencode/tmp/images/<uuid>.<ext>） */
  path: string;
  /** 图片 MIME 类型 */
  mime: string;
  /** 原始文件名 */
  filename: string;
  /** 压缩后文件大小（字节） */
  size: number;
}
