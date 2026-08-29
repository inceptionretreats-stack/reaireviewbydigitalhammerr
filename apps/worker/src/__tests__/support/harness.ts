import { createLogger, type LogSink, type Logger } from '../../logger';
import type { JobContext } from '../../jobs/types';

/** Captures log lines so tests can assert on what the worker reported, not just what it did. */
export class RecordingSink implements LogSink {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  messages(level: string): string[] {
    return this.lines
      .map((line) => JSON.parse(line) as { level: string; msg: string })
      .filter((entry) => entry.level === level)
      .map((entry) => entry.msg);
  }

  entries(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

export interface TestHarness {
  context: JobContext;
  sink: RecordingSink;
  logger: Logger;
  abort: () => void;
}

export function harness(now: string, options: { aborted?: boolean } = {}): TestHarness {
  const sink = new RecordingSink();
  const logger = createLogger('debug', sink);
  const controller = new AbortController();
  if (options.aborted) controller.abort();

  return {
    sink,
    logger,
    abort: () => {
      controller.abort();
    },
    context: {
      logger,
      now: new Date(now),
      signal: controller.signal,
      attempt: 1,
    },
  };
}
