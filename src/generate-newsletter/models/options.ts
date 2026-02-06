export type ContentOptions = {
  /**
   * Output language for the newsletter. e.g., "English", "Spanish"
   * @example "English"
   */
  outputLanguage: string;

  /**
   * Target domain(s) for the newsletter (one or many)
   * @example ["AI", "Cloud"]
   */
  expertField: string | string[];

  /**
   * When true, removes the fixed date+field heading directive
   * and moves the brief introduction into the briefing section.
   */
  freeFormIntro?: boolean;

  /**
   * Context string to prioritize when generating the newsletter title.
   * When provided, the LLM will consider this value as the top priority
   * along with the generated newsletter content for title creation.
   */
  titleContext?: string;
};

export type LLMQueryOptions = {
  /**
   * Number of retries when LLM calls fail.
   * @default 5
   */
  maxRetries?: number;
};

export type ChainOptions = {
  /**
   * Maximum retry attempts when the chain fails while running.
   * @default 3
   */
  stopAfterAttempt?: number;
};

export type CommonProcessingOptions = {
  content: ContentOptions;
  llm: LLMQueryOptions;
  chain: ChainOptions;
};
