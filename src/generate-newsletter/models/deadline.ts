import type { IsoDateString } from '~/models/common';

/** An action deadline grounded in the original article, not a generated issue. */
export type ArticleDeadline = {
  /** Name of the opportunity or application. */
  title: string;
  /** Distinguishes deadlines such as abstract submission and registration. */
  kind: string;
  /** YYYY-MM-DD, or null for an explicit cancellation without a known date. */
  date: IsoDateString | null;
  /** Source-local HH:mm or HH:mm:ss. Null when the source gives no time. */
  time: string | null;
  /** IANA time zone only when explicitly identifiable in the source. */
  timeZone: string | null;
  status: 'active' | 'cancelled';
  /** Verbatim source excerpt supporting the deadline or cancellation. */
  evidence: string;
};
