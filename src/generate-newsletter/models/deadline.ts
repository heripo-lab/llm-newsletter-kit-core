import type { IsoDateString } from '~/models/common';

/** A deadline or event schedule grounded in the original article. */
export type ArticleDeadline = {
  /** Missing in legacy caches; hosts must interpret an omitted type as deadline. */
  type?: 'deadline' | 'event';
  /** Name of the opportunity, application, or event. */
  title: string;
  /** Distinguishes actions such as submission, registration, and event attendance. */
  kind: string;
  /** Closing date for deadlines, start date for events; null for undated cancellations. */
  date: IsoDateString | null;
  /** Source-local HH:mm or HH:mm:ss. Null when the source gives no time. */
  time: string | null;
  /** Optional last date of an event, including single-day events with an end time. */
  endDate?: IsoDateString | null;
  /** Source-local event end time. Requires an explicit endDate. */
  endTime?: string | null;
  /** IANA time zone only when explicitly identifiable in the source. */
  timeZone: string | null;
  status: 'active' | 'cancelled';
  /** Verbatim source excerpt supporting the deadline, event period, or cancellation. */
  evidence: string;
};
