import { log } from '@/utils/log';
import { apiRequest } from '@/api/lib';
import type { ChatSession, ChatMessage, SSEEventPayload, UploadImageResponse, FilePartInput } from '@/types/chat';

const S = 'chatApi';
const BASE = '/api/chat';

export const chatApi = {
  listSessions(directory?: string): Promise<ChatSession[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<ChatSession[]>(S, `${BASE}/sessions${query}`);
  },

  createSession(directory?: string, title?: string): Promise<ChatSession> {
    return apiRequest<ChatSession>(S, `${BASE}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ directory, title }),
    });
  },

  getMessages(sessionId: string, directory?: string): Promise<ChatMessage[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<ChatMessage[]>(S, `${BASE}/sessions/${sessionId}/messages${query}`);
  },

  /**
   * 发送消息到会话。
   *
   * 支持两种调用方式（向后兼容）：
   * 1. 纯文本：只传 text，后端自动包装为 [{ type: 'text', text }]
   * 2. 带附件：额外传 attachments 数组，前端将 text + attachments 合并为 parts 数组
   */
  sendMessage(
    sessionId: string,
    text: string,
    directory?: string,
    agent?: string,
    context?: string,
    attachments?: FilePartInput[],
  ): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';

    // 构建 parts：至少包含一个 text part，加上可选的 file parts
    const parts: Array<{ type: string; text?: string; mime?: string; url?: string; filename?: string }> = [];
    if (text.trim()) {
      parts.push({ type: 'text', text });
    }
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        parts.push({ type: 'file', mime: att.mime, url: att.url, filename: att.filename });
      }
    }

    return apiRequest<void>(S, `${BASE}/sessions/${sessionId}/send${query}`, {
      method: 'POST',
      body: JSON.stringify({ parts, agent, context }),
    });
  },

  /**
   * 上传图片到后端，返回压缩后的文件元信息。
   *
   * 使用 FormData 发送 multipart/form-data，
   * 后端执行无损压缩后保存到 .opencode/tmp/images/ 临时目录。
   *
   * @param file     用户选择的图片文件
   * @param directory 项目工作目录（可选）
   * @returns        上传结果（path / mime / filename / size）
   */
  uploadImage(file: File, directory?: string): Promise<UploadImageResponse> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const formData = new FormData();
    formData.append('image', file);

    // apiRequest 检测到 FormData 时自动跳过 Content-Type 头，
    // 让浏览器设置正确的 multipart/form-data boundary
    return apiRequest<UploadImageResponse>(S, `${BASE}/upload-image${query}`, {
      method: 'POST',
      body: formData,
    });
  },

  abortSession(sessionId: string, directory?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<void>(S, `${BASE}/sessions/${sessionId}/abort${query}`, {
      method: 'POST',
    });
  },

  deleteSession(sessionId: string, directory?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<void>(S, `${BASE}/sessions/${sessionId}${query}`, {
      method: 'DELETE',
    });
  },

  updateSessionTitle(sessionId: string, title: string, directory?: string): Promise<ChatSession> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<ChatSession>(S, `${BASE}/sessions/${sessionId}${query}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  subscribeEvents(
    onEvent: (payload: SSEEventPayload) => void,
    onError?: (err: unknown) => void,
    directory?: string,
  ): EventSource {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const url = `${BASE}/events${query}`;
    log.info(S, `SSE connecting to ${url}`);
    const es = new EventSource(url);

    es.onopen = () => {
      log.info(S, 'SSE connection opened');
    };

    es.addEventListener('message.part.updated', (e) => {
      try {
        onEvent({ type: 'message.part.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.part.updated', err);
      }
    });

    es.addEventListener('message.part.delta', (e) => {
      try {
        onEvent({ type: 'message.part.delta', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.part.delta', err);
      }
    });

    es.addEventListener('message.updated', (e) => {
      try {
        onEvent({ type: 'message.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.updated', err);
      }
    });

    es.addEventListener('session.status', (e) => {
      try {
        onEvent({ type: 'session.status', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.status', err);
      }
    });

    es.addEventListener('session.created', (e) => {
      try {
        onEvent({ type: 'session.created', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.created', err);
      }
    });

    es.addEventListener('session.updated', (e) => {
      try {
        onEvent({ type: 'session.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.updated', err);
      }
    });

    es.addEventListener('session.idle', (e) => {
      try {
        onEvent({ type: 'session.idle', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.idle', err);
      }
    });

    es.addEventListener('session.compacted', (e) => {
      try {
        onEvent({ type: 'session.compacted', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.compacted', err);
      }
    });

    es.onerror = (err) => {
      log.error(S, `SSE error readyState=${es.readyState}`, err);
      if (onError) onError(err);
    };

    return es;
  },
};
