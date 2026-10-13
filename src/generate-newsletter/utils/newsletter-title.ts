/** Comparison ignores presentation-only punctuation, symbols, case and spacing. */
export function normalizeNewsletterTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')
    .replace(/\u200D|\uFE0F/gu, '');
}

/** A title-only repair failed; repeating the content chain must not reset its cap. */
export class NewsletterTitleValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NewsletterTitleValidationError';
  }
}
