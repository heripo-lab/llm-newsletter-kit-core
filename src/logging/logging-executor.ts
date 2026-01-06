import type { AppLogger } from '~/models/interfaces';
import type { LogMessage } from '~/models/log';

export type ExecuteWithLoggingConfig<T> = {
  /** Base event key (prefix). e.g., "crawl.group" */
  event: string;
  /** Log level (default: debug) */
  level?: 'debug' | 'info';
  /** Additional data to include on start */
  startFields?: Record<string, unknown>;
  /** Data builder invoked on success with the result to enrich log */
  doneFields?: (result: T) => Record<string, unknown> | void;
};

/**
 * Executor that provides a standardized start/done/error logging pattern.
 * - Uses the injected logger and taskId to attach common fields to every log.
 * - Pass config.event as a prefix like "crawl.group";
 *   ".start"/".done"/".error" are appended automatically.
 */
export class LoggingExecutor<TaskId> {
  constructor(
    private readonly logger: AppLogger,
    private readonly taskId: TaskId,
  ) {}

  public async executeWithLogging<T>(
    config: ExecuteWithLoggingConfig<T>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const level = config.level ?? 'debug';
    const startedAt = Date.now();

    const startMsg: LogMessage = {
      event: `${config.event}.start`,
      level,
      taskId: this.taskId,
      data: config.startFields ?? {},
    };
    this.logger[level](startMsg);

    try {
      const result = await fn();
      const durationMs = Date.now() - startedAt;
      const doneExtra = config.doneFields
        ? (config.doneFields(result) ?? {})
        : {};

      const doneMsg: LogMessage = {
        event: `${config.event}.done`,
        level,
        taskId: this.taskId,
        durationMs,
        data: { ...(config.startFields ?? {}), ...doneExtra },
      };
      this.logger[level](doneMsg);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMsg: LogMessage = {
        event: `${config.event}.error`,
        level,
        taskId: this.taskId,
        durationMs,
        data: { ...(config.startFields ?? {}) },
      };
      this.logger[level](errorMsg);
      this.logger.error(err);
      throw err;
    }
  }
}
