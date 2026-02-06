import type { LanguageModel } from 'ai';

import type { LLMQueryConfig } from '../llm-queries/llm-query';
import type {
  ArticleForUpdateByAnalysis,
  UnscoredArticle,
} from '../models/article';

import { RunnablePassthrough } from '@langchain/core/runnables';
import { pick } from 'es-toolkit';

import type { AnalysisProvider } from '~/generate-newsletter/models/interfaces';
import { LoggingExecutor } from '~/logging/logging-executor';
import type { DateService } from '~/models/interfaces';

import AnalyzeImages from '../llm-queries/analyze-images.llm';
import ClassifyTags from '../llm-queries/classify-tags.llm';
import DetermineArticleImportance from '../llm-queries/determine-article-importance.llm';
import { type ChainConfig, PrivateChain } from './chain';

type TagWithArticleId = Pick<UnscoredArticle, 'id' | 'tag1' | 'tag2' | 'tag3'>;
type ImageContextWithArticleId = Pick<
  UnscoredArticle,
  'id' | 'imageContextByLlm'
>;

export type ArticleInsights = {
  unscoredArticles: UnscoredArticle[];
  tags: string[];
} & Pick<
  AnalysisProvider,
  'classifyTagOptions' | 'analyzeImagesOptions' | 'determineScoreOptions'
>;

type Config<TaskId> = ChainConfig<TaskId, ArticleInsights> & {
  dateService: DateService;
};

export default class ArticleInsightsChain<TaskId> extends PrivateChain<
  TaskId,
  ArticleInsights
> {
  private readonly dateService: DateService;

  constructor(config: Config<TaskId>) {
    super(config);

    this.dateService = config.dateService;
  }

  /* istanbul ignore next - pipeline arrow functions are exercised via higher-level tests */
  protected get chain() {
    return RunnablePassthrough.assign({
      generatedTags: () => this.classifyArticles(),
      generatedImageContextList: () => this.extractImageContext(),
    })
      .pipe({
        mergedArticles: ({ generatedTags, generatedImageContextList }) =>
          this.mergeTagsAndImageContext(
            generatedTags,
            generatedImageContextList,
          ),
      })
      .pipe({
        determinedArticles: ({ mergedArticles }) =>
          this.determineImportance(mergedArticles),
      });
  }

  public async generateInsights(): Promise<ArticleForUpdateByAnalysis[]> {
    const { determinedArticles: initial } = await this.chain.invoke({});

    const maxIterations = 5; // Maximum number of iterations to prevent infinite loop

    const reprocess = async (
      current: ArticleForUpdateByAnalysis[],
      iteration: number,
    ): Promise<ArticleForUpdateByAnalysis[]> => {
      if (iteration >= maxIterations) {
        this.logger.debug({
          event: 'insights.warning.maxIterationsReached',
          taskId: this.taskId,
          data: {
            iterationCount: iteration,
            maxIterationCount: maxIterations,
          },
        });

        return current;
      }

      // Filter incomplete posts (where any of tag1, tag2, tag3, or importance_score is null)
      const incompleteArticles = current.filter(
        (article) =>
          !article.tag1 ||
          !article.tag2 ||
          !article.tag3 ||
          !article.importanceScore,
      );

      if (incompleteArticles.length === 0) {
        this.logger.debug({
          event: 'insights.complete',
          taskId: this.taskId,
        });

        return current; // Exit when all posts have been fully processed
      }

      this.logger.debug({
        event: 'insights.incomplete.restart',
        taskId: this.taskId,
        data: {
          incompleteArticleCount: incompleteArticles.length,
          iterationCount: iteration,
        },
      });
      // Reprocess incomplete posts only by reusing an insight object
      const { determinedArticles: reprocessedArticles } =
        await this.chain.invoke({});

      // Update original determinedPosts with reprocessed articles
      const updated = current.map((article) => {
        const reprocessedArticle = reprocessedArticles.find(
          (reArticle) => reArticle.id === article.id,
        );

        return reprocessedArticle || article;
      });

      this.logger.debug({
        event: 'insights.incomplete.restart.done',
        taskId: this.taskId,
        data: {
          iterationCount: iteration,
        },
      });

      return reprocess(updated, iteration + 1);
    };

    return reprocess(initial, 0);
  }

  private async classifyArticles(): Promise<TagWithArticleId[]> {
    return this.executeWithLogging(
      {
        event: 'insights.articles.classify',
        level: 'debug',
        doneFields: (articles) => ({ count: articles }),
      },
      async () => {
        const pushTag = (tag: string | null) => {
          if (tag && !this.provider.tags.includes(tag)) {
            this.provider.tags.push(tag);
          }
        };

        const articlesWithTags: TagWithArticleId[] = [];

        for (const [i, article] of this.provider.unscoredArticles.entries()) {
          const existTags = this.provider.tags;

          if (article.tag1 && article.tag2 && article.tag3) {
            continue;
          }

          this.logger.debug({
            event: 'insights.articles.classify.start',
            taskId: this.taskId,
            data: {
              count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
              articleId: article.id,
              title: article.title?.substring(0, 50) + '...',
              existingTags: existTags.length,
            },
          });

          try {
            const classifyTags = new ClassifyTags(
              this.getLlmQueryConfig(
                this.provider.classifyTagOptions.model,
                article,
              ),
            );

            const { result: generatedTags } = await classifyTags.execute({
              existTags,
            });

            pushTag(generatedTags.tag1);
            pushTag(generatedTags.tag2);
            pushTag(generatedTags.tag3);

            this.logger.debug({
              event: 'insights.articles.classify.end',
              taskId: this.taskId,
              data: {
                count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
                articleId: article.id,
                result: `tag1: ${generatedTags.tag1}, tag2: ${generatedTags.tag2}, tag3: ${generatedTags.tag3}`,
              },
            });

            articlesWithTags.push({
              id: article.id,
              ...generatedTags,
            });
          } catch (error) {
            this.logger.debug({
              event: 'insights.articles.classify.end.error',
              taskId: this.taskId,
              data: {
                count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
                articleId: article.id,
                error: error instanceof Error ? error.message : String(error),
                title: article.title?.substring(0, 50) + '...',
              },
            });

            // NOTE: Despite the error, it does not significantly hinder newsletter generation, so we proceed. Tagging helps produce a better newsletter, but it is not strictly required.
          }
        }

        return articlesWithTags;
      },
    );
  }

  private async extractImageContext(): Promise<ImageContextWithArticleId[]> {
    return this.executeWithLogging(
      {
        event: 'insights.images.extract',
        level: 'debug',
        doneFields: (articles) => ({ articles }),
      },
      async () => {
        const articlesWithImageContext: ImageContextWithArticleId[] = [];

        for (const [i, article] of this.provider.unscoredArticles.entries()) {
          if (!article.hasAttachedImage) {
            this.logger.debug({
              event: 'insights.images.extract.pass.noimage',
              taskId: this.taskId,
              data: {
                articleId: article.id,
              },
            });

            continue;
          }

          if (article.imageContextByLlm) {
            this.logger.debug({
              event: 'insights.images.extract.pass.exist',
              taskId: this.taskId,
              data: {
                articleId: article.id,
              },
            });

            continue;
          }

          this.logger.debug({
            event: 'insights.images.extract.start',
            taskId: this.taskId,
            data: {
              count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
              articleId: article.id,
            },
          });

          try {
            const analyzeImages = new AnalyzeImages(
              this.getLlmQueryConfig(
                this.provider.analyzeImagesOptions.model,
                article,
              ),
            );

            const { result: imageContextByLlm } = await analyzeImages.execute();

            if (imageContextByLlm) {
              articlesWithImageContext.push({
                id: article.id,
                imageContextByLlm,
              });

              this.logger.debug({
                event: 'insights.images.extract.end',
                taskId: this.taskId,
                data: {
                  count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
                  articleId: article.id,
                },
              });
            } else {
              this.logger.debug({
                event: 'insights.images.extract.end.noimage',
                taskId: this.taskId,
                data: {
                  count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
                  articleId: article.id,
                },
              });
            }
          } catch (error) {
            this.logger.debug({
              event: 'insights.images.extract.end.error',
              taskId: this.taskId,
              data: {
                count: `${i + 1} / ${this.provider.unscoredArticles.length}`,
                articleId: article.id,
                error: error instanceof Error ? error.message : String(error),
              },
            });

            // NOTE: Image analysis failure should not interrupt the overall process
          }
        }

        return articlesWithImageContext;
      },
    );
  }

  private async mergeTagsAndImageContext(
    generatedTags: TagWithArticleId[],
    generatedImageContextList: ImageContextWithArticleId[],
  ): Promise<UnscoredArticle[]> {
    return this.executeWithLogging(
      {
        event: 'insights.context.merge',
        level: 'debug',
        startFields: {
          generatedTags,
          generatedImageContextList,
        },
        doneFields: (count) => ({ count }),
      },
      async () => {
        return this.provider.unscoredArticles.map((article) => {
          const articleWithTags = generatedTags.find(
            ({ id }) => id === article.id,
          );
          const articleWithImageContext = generatedImageContextList.find(
            ({ id }) => id === article.id,
          );

          if (articleWithTags) {
            article = {
              ...article,
              tag1: articleWithTags.tag1,
              tag2: articleWithTags.tag2,
              tag3: articleWithTags.tag3,
            };
          }

          if (articleWithImageContext) {
            article = {
              ...article,
              imageContextByLlm: articleWithImageContext.imageContextByLlm,
            };
          }

          return article;
        });
      },
    );
  }

  private async determineImportance(
    mergedArticles: UnscoredArticle[],
  ): Promise<ArticleForUpdateByAnalysis[]> {
    return this.executeWithLogging(
      {
        event: 'insights.importance.determine',
        level: 'debug',
        startFields: {
          mergedArticles,
        },
        doneFields: (articles) => ({ articles }),
      },
      async () => {
        const determinedArticles: ArticleForUpdateByAnalysis[] = [];

        for (const [i, article] of mergedArticles.entries()) {
          this.logger.debug({
            event: 'insights.importance.determine.start',
            taskId: this.taskId,
            data: {
              count: `${i + 1} / ${mergedArticles.length}`,
              articleId: article.id,
              title: article.title?.substring(0, 50) + '...',
            },
          });

          try {
            const determineArticleImportance = new DetermineArticleImportance({
              ...this.getLlmQueryConfig(
                this.provider.determineScoreOptions.model,
                article,
              ),
              minimumImportanceScoreRules:
                this.provider.determineScoreOptions.minimumImportanceScoreRules,
              dateService: this.dateService,
            });

            const { result: importanceScore } =
              await determineArticleImportance.execute();

            const processedArticle = {
              ...article,
              importanceScore,
            };

            // Push result first to avoid losing it if logging fails
            determinedArticles.push(processedArticle);

            // Best-effort logging that won't affect the result
            try {
              this.logger.debug({
                event: 'insights.importance.determine.end',
                taskId: this.taskId,
                data: {
                  count: `${i + 1} / ${mergedArticles.length}`,
                  articleId: article.id,
                  importanceScore: importanceScore,
                },
              });
            } catch {
              // ignore logging errors
            }
          } catch (error) {
            // Log error but ensure we still return a fallback score
            try {
              this.logger.debug({
                event: 'insights.importance.determine.end.error',
                taskId: this.taskId,
                data: {
                  count: `${i + 1} / ${mergedArticles.length}`,
                  articleId: article.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            } catch {
              // ignore logging errors
            }

            // NOTE: Importance analysis failure should not stop the pipeline; use a fallback score instead
            determinedArticles.push({
              ...article,
              importanceScore: 1, // Set to minimum importance as a sane default
            });
          }
        }

        return determinedArticles;
      },
    );
  }

  private getLlmQueryConfig(
    model: LanguageModel,
    targetArticle: UnscoredArticle,
  ): LLMQueryConfig<TaskId, UnscoredArticle> {
    return {
      model,
      logger: this.logger,
      taskId: this.taskId,
      targetArticle: targetArticle,
      options: pick(this.options, ['content', 'llm']),
      loggingExecutor: new LoggingExecutor(this.logger, this.taskId as TaskId),
    };
  }
}
