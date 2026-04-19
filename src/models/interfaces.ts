import type { IsoDateString } from './common';
import type { EmailMessage } from './email';
import type { LogMessage } from './log';

/**
 * Logger interface used across the application.
 * - Accepts structured LogMessage, implement to integrate with systems like Logstash, CloudWatch, Datadog, etc.
 * - Typically, info is for operational events, debug for detailed tracing, and error for exceptions/critical failures.
 * - error accepts either a structured LogMessage or an arbitrary error object (Error, unknown).
 *
 * Usage examples:
 * logger.info({ event: 'task.start', taskId })
 * logger.debug({ event: 'crawl.list.fetch.start', data: { url } })
 * logger.error({ event: 'fetch.failed', data: { url, attempt, error: err.message } })
 */
export interface AppLogger {
  /** Info-level logs for operational events/state. */
  info: (message: LogMessage) => void;
  /** Debug-level logs for detailed debugging/tracing. */
  debug: (message: LogMessage) => void;
  /** Error-level logs. Accepts structured messages or arbitrary errors (Error/unknown). */
  error: (message: LogMessage | unknown) => void;
}

/**
 * Email sending service interface.
 */
export interface EmailService {
  /**
   * Send an email.
   * @param message Email message to send
   * @throws May throw on delivery failures
   */
  send: (message: EmailMessage) => Promise<void>;
}

/**
 * Service that provides dates for internal use or insertion into the newsletter.
 *
 * Semantics: every method on this interface represents the **newsletter publication
 * date** — i.e. the date the issue is (or will be) published. This may not be
 * "today" in wall-clock terms: if a caller builds an issue the night before its
 * scheduled release, they should inject tomorrow's date here.
 *
 * Clients are responsible for locale/language/timezone handling in their
 * implementation.
 */
export interface DateService {
  /**
   * Return the newsletter publication date in ISO format (YYYY-MM-DD).
   * @returns ISO date string
   * @example "2024-10-15"
   */
  getPublicationISODateString: () => IsoDateString;

  /**
   * Return a localized display string of the newsletter publication date
   * for use in newsletter content.
   * @example "10월 15일"
   */
  getPublicationDisplayDateString: () => string;
}
