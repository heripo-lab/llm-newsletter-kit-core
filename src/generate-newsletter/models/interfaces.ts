import type { LanguageModel } from 'ai';

import type {
  ArticleForGenerateContent,
  ArticleForUpdateByAnalysis,
  UnscoredArticle,
} from './article';
import type {
  CrawlingTarget,
  CrawlingTargetGroup,
  ParsedTarget,
} from './crawling';
import type { ChainOptions, ContentOptions, LLMQueryOptions } from './options';
import type { HtmlTemplate } from './template';

import type { UrlString } from '~/models/common';
import type { EmailMessage } from '~/models/email';
import type { AppLogger, DateService, EmailService } from '~/models/interfaces';
import type { Newsletter } from '~/models/newsletter';

/**
 * Task module managed by the client for newsletter generation.
 * e.g., can ensure single execution (prevent duplicates) like "run once a day".
 */
export interface TaskService<TaskId> {
  /**
   * Start a task. May return an error if a task is already running.
   * @returns taskId
   */
  start: () => Promise<TaskId>;

  /**
   * End a task.
   * @returns void
   */
  end: () => Promise<void>;
}

/**
 * Values and methods required for crawling.
 */
export interface CrawlingProvider {
  /**
   * Maximum number of concurrent jobs.
   * Used to control parallelism for resource management and to prevent overload.
   * @default 5
   */
  maxConcurrency?: number;

  /**
   * Optional custom fetch function (e.g., proxy-based fetch).
   * When provided, this function is used instead of the global `fetch` for HTTP requests.
   */
  customFetch?: typeof fetch;

  /**
   * Crawling target groups.
   */
  crawlingTargetGroups: CrawlingTargetGroup[];

  /**
   * Look up existing stored articles for the given URLs to compare with newly collected ones.
   * @param articleUrls Original article URLs to query
   * @returns Previously stored (parsed) articles
   */
  fetchExistingArticlesByUrls: (
    articleUrls: UrlString[],
  ) => Promise<ParsedTarget[]>;

  /**
   * Persist structured results collected for a specific crawling group (batch-save recommended).
   * @param articles Parsed articles
   * @param context Crawling execution context
   * @returns Number of saved articles
   */
  saveCrawledArticles: <TaskId>(
    articles: ParsedTarget[],
    context: {
      taskId: TaskId;
      targetGroup: Omit<CrawlingTargetGroup, 'targets'>;
      target: CrawlingTarget;
    },
  ) => Promise<number>;
}

/**
 * Minimum importance score policy for a specific crawling target.
 */
export type MinimumImportanceScoreRule = {
  /**
   * Target URL the minimum score applies to. Same as CrawlingTarget.url.
   */
  targetUrl: UrlString;

  /**
   * Minimum importance score to apply.
   * @example 5
   */
  minScore: number;
};

/**
 * Values and methods required for LLM analysis.
 */
export interface AnalysisProvider {
  /**
   * Options for classification and tag generation.
   */
  classifyTagOptions: {
    /**
     * Model to use. A relatively light model is acceptable.
     */
    model: LanguageModel;
  };

  /**
   * Options for image analysis.
   */
  analyzeImagesOptions: {
    /**
     * Model to use. Must be a multimodal model.
     */
    model: LanguageModel;
  };

  /**
   * Options for importance score generation.
   */
  determineScoreOptions: {
    /**
     * Model to use. A relatively light model is acceptable.
     */
    model: LanguageModel;

    /**
     * Minimum score policies per crawling target.
     * @example
     * ```ts
     * minimumImportanceScoreRules: [
     *   { targetUrl: 'https://example.com/board/notice', minScore: 5 }
     * ]
     * ```
     */
    minimumImportanceScoreRules?: MinimumImportanceScoreRule[];
  };

  /**
   * Fetch articles without an importance score from the DB.
   * @returns List of unscored articles
   */
  fetchUnscoredArticles: () => Promise<UnscoredArticle[]>;

  /**
   * Fetch existing tag list to classify collected articles before newsletter generation.
   * @returns Array of tag strings
   */
  fetchTags: () => Promise<string[]>;

  /**
   * Update analysis results and importance scores after all work is done.
   * @param article Article data to update
   */
  update: (article: ArticleForUpdateByAnalysis) => Promise<void>;
}

/**
 * Values and methods required to generate a newsletter.
 */
export interface ContentGenerateProvider {
  /**
   * Language model to use. A high‑performance model is recommended.
   */
  model: LanguageModel;

  /**
   * Maximum tokens allowed for generation.
   * Used to prevent excessively long outputs and control token usage.
   */
  maxOutputTokens?: number;

  /**
   * Temperature controlling randomness (0.0–1.0).
   * Higher values can be more creative but less consistent.
   * @default 0.3
   */
  temperature?: number;

  /**
   * Controls nucleus sampling (top‑p, 0.0–1.0).
   * Sample from tokens whose cumulative probability exceeds the threshold.
   * @default 0.95
   */
  topP?: number;

  /**
   * Restrict sampling to top‑K tokens.
   * Helps balance diversity and quality.
   */
  topK?: number;

  /**
   * Controls penalty for repeating tokens (−2.0–2.0).
   * Higher values discourage repetition.
   */
  presencePenalty?: number;

  /**
   * Controls penalty based on token frequency (−2.0–2.0).
   * Higher values discourage frequent tokens.
   */
  frequencyPenalty?: number;

  /**
   * Issue number of the newsletter.
   */
  issueOrder: number;

  /**
   * Publication criteria for issuing a newsletter.
   * @example
   * ```ts
   * publicationCriteria: {
   *   minimumArticleCountForIssue: 5,
   *   priorityArticleScoreThreshold: 8,
   * }
   * ```
   */
  publicationCriteria?: {
    /**
     * Minimum number of articles required to issue a newsletter
     * @default 5
     */
    minimumArticleCountForIssue: number;
    /**
     * If there exists an article with importance ≥ this score, issue regardless of count
     * @default 8
     */
    priorityArticleScoreThreshold: number;
  };

  /**
   * Subscription page URL. Can be inserted as a CTA link in the newsletter.
   */
  subscribePageUrl?: UrlString;

  /**
   * Brand name of the newsletter.
   * @example "Dev Insight"
   */
  newsletterBrandName: string;

  /**
   * Fetch candidate articles from the DB for newsletter generation.
   */
  fetchArticleCandidates: () => Promise<ArticleForGenerateContent[]>;

  /**
   * HTML template for the newsletter.
   * Generated content is applied to this template to produce the final HTML.
   */
  htmlTemplate: HtmlTemplate;

  /**
   * Persist the newsletter (recommend saving relationships together).
   * - Receives `usedArticles` so relations can be handled transactionally.
   */
  saveNewsletter: (input: {
    newsletter: Newsletter;
    usedArticles: ArticleForGenerateContent[];
  }) => Promise<{ id: string | number }>;
}

/**
 * Options for newsletter generation.
 * - Controls LLM retry counts, logger injection, etc.
 */
export type GenerateNewsletterOptions = {
  /**
   * Logger implementation. If not provided, a no‑op logger is used.
   */
  logger?: AppLogger;

  /**
   * LLM behavior configuration.
   */
  llm?: LLMQueryOptions;

  /**
   * Internal chain behavior configuration.
   */
  chain?: ChainOptions;

  /**
   * Preview newsletter delivery configuration.
   * When present, a preview email is sent to reviewers.
   */
  previewNewsletter?: {
    /**
     * Fetch a newsletter entity to use for preview.
     */
    fetchNewsletterForPreview: () => Promise<Newsletter>;

    /**
     * Email delivery service implementation.
     */
    emailService: EmailService;

    /**
     * Base configuration for the preview email.
     * subject/html/text are generated automatically and omitted here.
     */
    emailMessage: Omit<EmailMessage, 'subject' | 'html' | 'text'>;
  };
};

/**
 * Configuration object passed to the GenerateNewsletter constructor.
 */
export type GenerateNewsletterConfig<TaskId> = {
  /**
   * Content generation settings.
   * Defines the output language and target domains.
   */
  contentOptions: ContentOptions;

  /**
   * Service that supplies date values.
   * Manages publication date and display strings.
   */
  dateService: DateService;

  /**
   * Task service used to ensure single execution and avoid duplicates.
   */
  taskService: TaskService<TaskId>;

  /**
   * Provider for crawling (targets, persistence, queries, etc.).
   */
  crawlingProvider: CrawlingProvider;

  /**
   * Provider for analysis (image analysis, tagging, scoring, etc.).
   */
  analysisProvider: AnalysisProvider;

  /**
   * Provider for content generation (LLM, template, save/publish, etc.).
   */
  contentGenerateProvider: ContentGenerateProvider;

  /**
   * Optional behavior/settings.
   */
  options?: GenerateNewsletterOptions;
};
