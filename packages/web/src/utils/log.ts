const BATCH_INTERVAL = 2000;
const MAX_BATCH = 20;
const LOG_ENDPOINT = '/api/chat/log';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

let queue: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  timer = null;
  try {
    fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.length === 1 ? batch[0] : { batch }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function schedule() {
  if (!timer) {
    timer = setTimeout(flush, BATCH_INTERVAL);
  }
}

function push(level: LogLevel, scope: string, message: string, data?: unknown) {
  const entry: LogEntry = { level, scope, message, data };
  queue.push(entry);

  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${scope}]`, message, data ?? '');

  if (queue.length >= MAX_BATCH) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  } else {
    schedule();
  }
}

export const log = {
  info(scope: string, message: string, data?: unknown) {
    push('info', scope, message, data);
  },
  warn(scope: string, message: string, data?: unknown) {
    push('warn', scope, message, data);
  },
  error(scope: string, message: string, data?: unknown) {
    push('error', scope, message, data);
  },
};
