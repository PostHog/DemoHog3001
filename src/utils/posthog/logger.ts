import { POSTHOG_KEY, POSTHOG_HOST } from '../../components/PostHogProvider/config';

// OTLP severity numbers per OpenTelemetry spec
const SeverityNumber = {
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
} as const;

type LogLevel = keyof typeof SeverityNumber;
type LogAttributes = Record<string, string | number | boolean>;

interface LogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
}

// Module state
let initialized = false;
let logQueue: LogRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BATCH_SIZE = 10;
const LOGS_ENDPOINT = `${POSTHOG_HOST}/i/v1/logs`;

const resourceAttributes = [
  { key: 'service.name', value: { stringValue: 'hogflix-web' } },
  { key: 'deployment.environment', value: { stringValue: 'production' } },
  { key: 'service.version', value: { stringValue: '1.0.0' } },
];

function toOtlpAttribute(key: string, val: string | number | boolean) {
  if (typeof val === 'boolean') return { key, value: { boolValue: val } };
  if (typeof val === 'number') return { key, value: { intValue: String(val) } };
  return { key, value: { stringValue: String(val) } };
}

function getCorrelationAttributes(): LogAttributes {
  try {
    const posthog = (window as any).posthog;
    if (!posthog) return {};
    const attrs: LogAttributes = {};
    const distinctId = posthog.get_distinct_id?.();
    if (distinctId) attrs['posthog_distinct_id'] = distinctId;
    const sessionId = posthog.get_session_id?.();
    if (sessionId) attrs['$session_id'] = sessionId;
    return attrs;
  } catch {
    return {};
  }
}

function buildLogRecord(level: LogLevel, message: string, attributes: LogAttributes): LogRecord {
  const correlation = getCorrelationAttributes();
  const allAttrs = { ...correlation, ...attributes };

  return {
    timeUnixNano: String(Date.now() * 1_000_000),
    severityNumber: SeverityNumber[level],
    severityText: level,
    body: { stringValue: message },
    attributes: Object.entries(allAttrs).map(([k, v]) => toOtlpAttribute(k, v)),
  };
}

function buildOtlpPayload(records: LogRecord[]) {
  return {
    resourceLogs: [{
      resource: { attributes: resourceAttributes },
      scopeLogs: [{
        scope: { name: 'hogflix-browser' },
        logRecords: records,
      }],
    }],
  };
}

function sendLogs(records: LogRecord[]) {
  if (records.length === 0) return;

  const payload = JSON.stringify(buildOtlpPayload(records));

  // Use sendBeacon if available and page is being unloaded, otherwise fetch
  if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(LOGS_ENDPOINT + `?token=${POSTHOG_KEY}`, blob);
  } else {
    fetch(LOGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${POSTHOG_KEY}`,
      },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Silently drop failed log sends — don't break the app
    });
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function flush() {
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  sendLogs(batch);
}

function enqueue(record: LogRecord) {
  logQueue.push(record);
  if (logQueue.length >= FLUSH_BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

function log(level: LogLevel, message: string, attributes: LogAttributes = {}) {
  if (!initialized) return;
  enqueue(buildLogRecord(level, message, attributes));
}

// Public API
export const logger = {
  info: (message: string, attributes?: LogAttributes) => log('INFO', message, attributes),
  warn: (message: string, attributes?: LogAttributes) => log('WARN', message, attributes),
  error: (message: string, attributes?: LogAttributes) => log('ERROR', message, attributes),
  debug: (message: string, attributes?: LogAttributes) => log('DEBUG', message, attributes),
  flush,
};

export function initLogger() {
  if (initialized) return;
  initialized = true;

  // Flush logs on page hide/unload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // Global error capture
  window.addEventListener('error', (event) => {
    logger.error('app.unhandled_error', {
      message: event.message,
      source: event.filename || 'unknown',
      line: event.lineno || 0,
      column: event.colno || 0,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logger.error('app.unhandled_promise_rejection', {
      message: reason?.message || String(reason),
    });
  });

  console.log('PostHog logger initialized (OTLP → ' + LOGS_ENDPOINT + ')');
}
