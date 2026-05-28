import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'log');

let _stream: fs.WriteStream | null = null;
let _dateStr = '';

function getLogDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getStream(): fs.WriteStream {
  const dateStr = getLogDate();
  if (_stream && _dateStr === dateStr) return _stream;

  if (_stream) {
    _stream.end();
  }

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  _dateStr = dateStr;
  _stream = fs.createWriteStream(path.join(LOG_DIR, `${dateStr}.log`), { flags: 'a' });
  return _stream;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function write(level: string, scope: string, args: unknown[]) {
  const line = `${timestamp()} [${level}] [${scope}] ${formatArgs(args)}\n`;
  try {
    getStream().write(line);
  } catch {}
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(line.trimEnd());
}

export const logger = {
  info(scope: string, ...args: unknown[]) {
    write('INFO', scope, args);
  },
  warn(scope: string, ...args: unknown[]) {
    write('WARN', scope, args);
  },
  error(scope: string, ...args: unknown[]) {
    write('ERROR', scope, args);
  },
};
