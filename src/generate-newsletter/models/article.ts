import type { IsoDateString, MarkdownString, UrlString } from '~/models/common';

/**
 * Structure of an article that has not yet been processed (no importance score, image analysis, or tagging).
 */
export type UnscoredArticle = {
  /**
   * Identifier. Supports both string and number to accommodate various DB schemas.
   */
  id: string | number;

  /**
   * Article title.
   * @example "Weekly Tech Newsletter"
   */
  title: string;

  /**
   * Article body in Markdown format.
   * @example "### Highlights\n- New framework announced"
   */
  detailContent: MarkdownString;

  /**
   * Whether the article has an attached image.
   * @example true
   */
  hasAttachedImage: boolean;

  /**
   * Image analysis result. Null if no LLM analysis result exists.
   */
  imageContextByLlm: string | null;

  /**
   * First classification tag.
   * @example "News"
   */
  tag1: string | null;

  /**
   * Second classification tag.
   * @example "Jobs"
   */
  tag2: string | null;

  /**
   * Third classification tag.
   * @example "Announcement"
   */
  tag3: string | null;

  /**
   * URL for board collection. Not the original article detail URL. Typically matches CrawlingTarget.url.
   * @example "https://example.com/board/notice"
   */
  targetUrl: UrlString;

  /**
   * (Optional) Original posting/publication date of the article in ISO format (YYYY-MM-DD).
   * When provided, this is used by LLM queries to judge temporal validity — for example,
   * whether deadlines or event dates have passed relative to the newsletter publication date.
   * Implementations that cannot reliably extract this value may omit it.
   * @example "2024-10-12"
   */
  publishedDate?: IsoDateString;
};

/**
 * Article type used after the analysis phase (image/tagging/score) for updates.
 */
export type ArticleForUpdateByAnalysis = UnscoredArticle & {
  /**
   * Importance score. Range 1–10.
   * @example 8
   */
  importanceScore: number;
};

/**
 * Article type used in the newsletter content generation phase.
 */
export type ArticleForGenerateContent = ArticleForUpdateByAnalysis & {
  /**
   * Content type of the article. Typically a group name from CrawlingTargetGroup or similar grouping.
   * @example "News"
   */
  contentType: string;

  /**
   * Original detail page URL of the article.
   * @example "https://example.com/news/123"
   */
  url: UrlString;
};
