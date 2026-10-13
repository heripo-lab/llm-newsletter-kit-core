/** Comparison ignores invisible markers, punctuation, symbols, case and spacing. */
export function normalizeNewsletterTitle(title: string): string {
  return (
    title
      // Strip invisible markers first so they cannot interrupt Unicode composition.
      .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')
  );
}

/** A title-only repair failed; repeating the content chain must not reset its cap. */
export class NewsletterTitleValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NewsletterTitleValidationError';
  }
}
