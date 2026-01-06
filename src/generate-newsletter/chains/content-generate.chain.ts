import type { ArticleForGenerateContent } from '../models/article';
import type { ContentGenerateProvider } from '../models/interfaces';
import type { RequiredHtmlTemplate } from '../models/template';

import { RunnablePassthrough } from '@langchain/core/runnables';
import { pick } from 'es-toolkit';
import juice from 'juice';

import { LoggingExecutor } from '~/logging/logging-executor';
import type { DateService } from '~/models/interfaces';
import type { Newsletter } from '~/models/newsletter';
import markdownToHtml from '~/utils/markdown-to-html';

import GenerateNewsletter from '../llm-queries/generate-newsletter.llm';
import { Chain, type ChainConfig } from './chain';

type CoreContent = Pick<Newsletter, 'title' | 'content'>;

type Config<TaskId> = ChainConfig<TaskId, ContentGenerateProvider> & {
  dateService: DateService;
};

export default class ContentGenerateChain<TaskId> extends Chain<
  TaskId,
  ContentGenerateProvider
> {
  private readonly dateService: DateService;
  private readonly minimumArticleCountForIssue: number;
  private readonly priorityArticleScoreThreshold: number;
  private readonly htmlTemplate: RequiredHtmlTemplate;

  constructor(config: Config<TaskId>) {
    super(config);

    this.dateService = config.dateService;
    this.minimumArticleCountForIssue =
      config.provider.publicationCriteria?.minimumArticleCountForIssue ?? 5;
    this.priorityArticleScoreThreshold =
      config.provider.publicationCriteria?.priorityArticleScoreThreshold ?? 8;
    this.htmlTemplate = {
      html: config.provider.htmlTemplate.html,
      markers: {
        title: config.provider.htmlTemplate.markers?.title ?? 'title',
        content: config.provider.htmlTemplate.markers?.content ?? 'content',
      },
    };
  }

  public get chain() {
    return RunnablePassthrough.assign({
      candidateArticles: () => this.fetchArticleCandidates(),
    })
      .pipe(
        RunnablePassthrough.assign({
          generatedCoreContent: ({ candidateArticles }) =>
            this.generateCoreContent(candidateArticles),
          candidateArticles: ({ candidateArticles }) => candidateArticles,
        }),
      )
      .pipe(
        RunnablePassthrough.assign({
          html: ({ generatedCoreContent }) =>
            this.renderHtml(generatedCoreContent),
          generatedCoreContent: ({ generatedCoreContent }) =>
            generatedCoreContent,
          candidateArticles: ({ candidateArticles }) => candidateArticles,
        }),
      )
      .pipe(
        RunnablePassthrough.assign({
          newsletterId: ({ html, generatedCoreContent, candidateArticles }) =>
            this.createNewsletter(
              html,
              generatedCoreContent,
              candidateArticles,
            ),
        }),
      )
      .withRetry({ stopAfterAttempt: this.options.chain.stopAfterAttempt });
  }

  private async fetchArticleCandidates(): Promise<ArticleForGenerateContent[]> {
    return this.executeWithLogging(
      {
        event: 'generate.content.articles.fetch',
        level: 'debug',
        doneFields: (items) => ({ count: items.length }),
      },
      async () => {
        return await this.provider.fetchArticleCandidates();
      },
    );
  }

  private async generateCoreContent(
    candidateArticles: ArticleForGenerateContent[],
  ): Promise<CoreContent | null> {
    return this.executeWithLogging(
      {
        event: 'generate.content.core.generate',
        level: 'info',
        startFields: { count: candidateArticles.length },
        doneFields: (result) => ({ title: result?.title }),
      },
      async () => {
        if (candidateArticles.length === 0) {
          this.logger.debug({
            event: 'generate.content.core.generate.noarticle',
            taskId: this.taskId,
          });

          return null;
        }

        const hasHighImportancePost = candidateArticles.some(
          ({ importanceScore }) =>
            importanceScore >= this.priorityArticleScoreThreshold,
        );

        if (
          candidateArticles.length <= this.minimumArticleCountForIssue &&
          !hasHighImportancePost
        ) {
          this.logger.debug({
            event: 'generate.content.core.generate.criteria',
            taskId: this.taskId,
            data: {
              count: candidateArticles.length,
              hasHighImportancePost,
            },
          });

          return null;
        }

        const generateNewsletter = new GenerateNewsletter({
          model: this.provider.model,
          maxOutputTokens: this.provider.maxOutputTokens,
          temperature: this.provider.temperature,
          topP: this.provider.topP,
          topK: this.provider.topK,
          presencePenalty: this.provider.presencePenalty,
          frequencyPenalty: this.provider.frequencyPenalty,
          logger: this.logger,
          taskId: this.taskId,
          targetArticles: candidateArticles,
          options: pick(this.options, ['content', 'llm']),
          loggingExecutor: new LoggingExecutor(
            this.logger,
            this.taskId as TaskId,
          ),
          subscribePageUrl: this.provider.subscribePageUrl,
          newsletterBrandName: this.provider.newsletterBrandName,
          dateService: this.dateService,
        });

        return await generateNewsletter.execute();
      },
    );
  }

  private async renderHtml(
    coreContent: CoreContent | null,
  ): Promise<string | null> {
    return this.executeWithLogging(
      {
        event: 'generate.content.html.render',
        level: 'debug',
        startFields: { coreContent },
        doneFields: (html) => ({ html }),
      },
      async () => {
        if (!coreContent) {
          return null;
        }

        return this.htmlTemplate.html
          .replaceAll(
            `{{${this.htmlTemplate.markers.title}}}`,
            coreContent.title,
          )
          .replaceAll(
            `{{${this.htmlTemplate.markers.content}}}`,
            markdownToHtml(coreContent.content),
          );
      },
    );
  }

  private async createNewsletter(
    html: string | null,
    coreContent: CoreContent | null,
    candidateArticles: ArticleForGenerateContent[],
  ): Promise<string | number | null> {
    return this.executeWithLogging(
      {
        event: 'generate.content.newsletter.create',
        level: 'debug',
        startFields: { html, count: candidateArticles.length },
        doneFields: (id) => ({ id }),
      },
      async () => {
        if (!html || !coreContent) {
          return null;
        }

        const { id } = await this.provider.saveNewsletter({
          newsletter: {
            ...coreContent,
            htmlBody: juice(html),
            issueOrder: this.provider.issueOrder,
            date: this.dateService.getCurrentISODateString(),
          },
          usedArticles: candidateArticles,
        });

        return id;
      },
    );
  }
}
