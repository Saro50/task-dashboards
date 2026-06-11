import { log } from '@/utils/log';

export function unwrap<T>(raw: any, requestId?: string): { data: T; requestId?: string } {
  const id = requestId || (raw && typeof raw === 'object' && 'requestId' in raw ? raw.requestId : undefined);
  if (raw && typeof raw === 'object' && 'requestId' in raw) {
    if ('data' in raw && !('error' in raw) && Array.isArray(raw.data)) {
      return { data: raw.data as T, requestId: id };
    }
    const { requestId: _, ...rest } = raw;
    return { data: rest as T, requestId: id };
  }
  return { data: raw as T, requestId: id };
}

export async function apiRequest<T>(
  scope: string,
  url: string,
  options?: RequestInit,
): Promise<T> {
  const method = options?.method || 'GET';
  log.info(scope, `${method} ${url}`);

  // FormData 上传时不设置 Content-Type，让浏览器自动添加 multipart boundary
  const isFormData = options?.body instanceof FormData;
  const defaultHeaders: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  const reqId = res.headers.get('X-Request-Id') || undefined;

  if (!res.ok) {
    const raw = await res.json().catch(() => ({ error: res.statusText }));
    const { requestId } = unwrap(raw, reqId);
    log.error(scope, `${method} ${url} ${res.status}`, { requestId, error: raw.error || `HTTP ${res.status}` });
    const err = new Error(raw.error || raw.detail || `HTTP ${res.status}`);
    // 将 HTTP 状态码和完整响应体附加到错误对象，供调用方按需提取额外字段
    // （如合并冲突时的 conflictFiles 列表）
    (err as any).status = res.status;
    (err as any).data = raw;
    throw err;
  }

  if (res.status === 204) {
    log.info(scope, `${method} ${url} 204`, { requestId: reqId });
    return undefined as T;
  }

  const raw = await res.json();
  const { data, requestId } = unwrap<T>(raw, reqId);
  log.info(scope, `${method} ${url} ${res.status}`, { requestId });
  return data;
}
