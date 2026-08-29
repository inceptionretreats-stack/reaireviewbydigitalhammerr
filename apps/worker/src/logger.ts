/**
 * Structured logging for the worker (14_DevOps_Deployment_Runbook.md, "Observability").
 *
 * One JSON object per line on stdout, which is what the container log driver ships and what
 * every log backend can query without a grok pattern. Written through `process.stdout.write`
 * rather than `console.*` on purpose: console applies util.inspect formatting to extra
 * arguments, which mangles structured fields, and the repository's eslint config restricts
 * console usage to warn/error anyway.
 *
 * Log values are deliberately narrow (`LogFieldValue`). The worker touches tenant data and
 * 13_Security_Privacy_Compliance.md forbids retaining raw identifiers where a reference will
 * do, so a field type that cannot accept an arbitrary object makes "just log the whole row"
 * inconvenient by construction.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFieldValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogFieldValue>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `error` is separate because a thrown value is `unknown` and needs safe serialisation. */
  error(message: string, cause?: unknown, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LogSink {
  write(line: string): void;
}

export const stdoutSink: LogSink = {
  write(line) {
    process.stdout.write(line);
  },
};

export function createLogger(level: LogLevel, sink: LogSink = stdoutSink, base: LogFields = {}) {
  return build(level, sink, { service: 'worker', ...base });
}

function build(level: LogLevel, sink: LogSink, base: LogFields): Logger {
  const threshold = LEVEL_RANK[level];

  const emit = (at: LogLevel, message: string, fields: LogFields): void => {
    if (LEVEL_RANK[at] < threshold) return;
    sink.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level: at, msg: message, ...base, ...fields })}\n`,
    );
  };

  return {
    debug: (message, fields = {}) => {
      emit('debug', message, fields);
    },
    info: (message, fields = {}) => {
      emit('info', message, fields);
    },
    warn: (message, fields = {}) => {
      emit('warn', message, fields);
    },
    error: (message, cause, fields = {}) => {
      emit('error', message, { ...fields, ...describeError(cause) });
    },
    child: (fields) => build(level, sink, { ...base, ...fields }),
  };
}

/**
 * Flattens a thrown value into log fields. Stacks are kept — these logs never reach a
 * customer, and 02_System_Architecture.md's "never expose raw provider errors" is a rule
 * about API responses, not about the operator's own telemetry.
 */
function describeError(cause: unknown): LogFields {
  if (cause === undefined) return {};
  if (cause instanceof Error) {
    return {
      errorName: cause.name,
      errorMessage: cause.message,
      errorStack: cause.stack ?? null,
      errorCause: cause.cause instanceof Error ? cause.cause.message : null,
    };
  }
  return { errorName: 'NonError', errorMessage: String(cause) };
}
