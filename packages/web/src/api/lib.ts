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

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const reqId = res.headers.get('X-Request-Id') || undefined;

  if (!res.ok) {
    const raw = await res.json().catch(() => ({ error: res.statusText }));
    const { requestId } = unwrap(raw, reqId);
    log.error(scope, `${method} ${url} ${res.status}`, { requestId, error: raw.error || `HTTP ${res.status}` });
    throw new Error(raw.error || raw.detail || `HTTP ${res.status}`);
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
