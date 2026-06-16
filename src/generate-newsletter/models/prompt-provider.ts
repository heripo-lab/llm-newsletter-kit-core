import type { ArticleForGenerateContent } from './article';
import type { UnscoredArticle } from './article';
import type { MinimumImportanceScoreRule } from './interfaces';

import type { UrlString } from '~/models/common';
import type { DateService } from '~/models/interfaces';

/**
 * A pair of optional prompt builder functions.
 * The returned string **replaces** the built-in default prompt entirely.
 * If omitted, the default prompt is used.
 */
export type PromptBuilder<TContext> = {
  system?: (context: TContext) => string;
  user?: (context: TContext) => string;
};

// ─── Context types ───────────────────────────────────────────────

export type ClassifyTagsPromptContext = {
  expertFields: string[];
  outputLanguage: string;
  targetArticle: UnscoredArticle;
  existTags: string[];
};

export type AnalyzeImagesPromptContext = {
  expertFields: string[];
  outputLanguage: string;
  targetArticle: UnscoredArticle;
};

export type DetermineImportancePromptContext = {
  expertFields: string[];
  targetArticle: UnscoredArticle;
  dateService: DateService;
  minimumImportanceScoreRules: MinimumImportanceScoreRule[];
};

export type GenerateNewsletterPromptContext = {
  expertFields: string[];
  outputLanguage: string;
  dateService: DateService;
  targetArticles: ArticleForGenerateContent[];
  freeFormIntro?: boolean;
  titleContext?: string;
  subscribePageUrl?: UrlString;
  newsletterBrandName: string;
};

// ─── Main interface ──────────────────────────────────────────────

/**
 * Optional provider for customizing LLM prompts.
 * Grouped by pipeline stage. All fields are optional —
 * omitted prompts fall back to built-in defaults.
 *
 * **Dependency note:** Analysis prompts (❶❷❸) produce data that flows
 * into the content generation prompt (❹). Changing an analysis prompt
 * may indirectly affect the final newsletter output.
 */
export interface PromptProvider {
  /**
   * Analysis stage prompts (❶ classifyTags → ❷ analyzeImages → ❸ determineImportance).
   * Results feed into the content generation stage.
   */
  analysis?: {
    classifyTags?: PromptBuilder<ClassifyTagsPromptContext>;
    analyzeImages?: PromptBuilder<AnalyzeImagesPromptContext>;
    determineImportance?: PromptBuilder<DetermineImportancePromptContext>;
  };

  /**
   * Content generation stage prompt (❹ generateNewsletter).
   * Produces the final newsletter title and body.
   */
  contentGenerate?: {
    generateNewsletter?: PromptBuilder<GenerateNewsletterPromptContext>;
  };
}
