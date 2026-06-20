import { RunnableSequence } from '@langchain/core/runnables';

import AnalysisChain from '~/generate-newsletter/chains/analysis.chain';
import ContentGenerateChain from '~/generate-newsletter/chains/content-generate.chain';
import CrawlingChain from '~/generate-newsletter/chains/crawling.chain';
import type {
  AnalysisProvider,
  ContentGenerateProvider,
  CrawlingProvider,
  GenerateNewsletterConfig,
  GenerateNewsletterOptions,
  TaskService,
} from '~/generate-newsletter/models/interfaces';
import type { CommonProcessingOptions } from '~/generate-newsletter/models/options';
import type { PromptProvider } from '~/generate-newsletter/models/prompt-provider';
import { LoggingExecutor } from '~/logging/logging-executor';
import type { AppLogger, DateService } from '~/models/interfaces';

/**
 * Core class that orchestrates LLM-based newsletter generation.
 * - Responsible for the flow: Crawling → Analysis → Content Generation → Save; external dependencies are injected via DI.
 */
export default class GenerateNewsletter<TaskId> {
  /** Internal fields provided via dependency injection */
  private readonly dateService: DateService;
  private readonly taskService: TaskService<TaskId>;
  private readonly crawlingProvider: CrawlingProvider;
  private readonly analysisProvider: AnalysisProvider;
  private readonly contentGenerateProvider: ContentGenerateProvider;
  private readonly logger: AppLogger;
  private readonly options: CommonProcessingOptions;
  private readonly promptProvider?: PromptProvider;
  private readonly previewNewsletterOptions?: GenerateNewsletterOptions['previewNewsletter'];

  /** Independent internal field **/
  private taskId: TaskId | null = null;

  /**
   * Constructor
   *
   * @param config
   * @example
   * const generator = new GenerateNewsletter({
   *   outputLanguage: 'English',
   *   expertField: ['AI', 'Cloud'],
   *   dateService,
   *   taskService,
   *   tagProvider,
   *   crawlingProvider,
   *   analysisProvider,
   *   contentGenerateProvider,
   *   options: { llm: { maxRetries: 5 } },
   * });
   */
  public constructor(config: GenerateNewsletterConfig<TaskId>) {
    const defaultOptions: CommonProcessingOptions = {
      content: config.contentOptions,
      llm: { maxRetries: 5 },
      chain: { stopAfterAttempt: 3 },
    };

    this.dateService = config.dateService;
    this.taskService = config.taskService;
    this.crawlingProvider = config.crawlingProvider;
    this.analysisProvider = config.analysisProvider;
    this.contentGenerateProvider = config.contentGenerateProvider;
    this.options = {
      ...defaultOptions,
      ...config.options,
      llm: {
        ...defaultOptions.llm,
        ...config.options?.llm,
      },
      chain: {
        ...defaultOptions.chain,
        ...config.options?.chain,
      },
    };

    this.promptProvider = config.promptProvider;

    // Default logger (no-op)
    this.logger = config.options?.logger ?? {
      info: (_msg) => {},
      debug: (_msg) => {},
      error: (_msg) => {},
    };

    // Store preview newsletter options
    this.previewNewsletterOptions = config.options?.previewNewsletter;
  }

  /**
   * Execute the full newsletter generation pipeline.
   */
  public async generate() {
    const { newsletterId } = await this.executeWithTaskManagement(async () => {
      const loggingExecutor = new LoggingExecutor(
        this.logger,
        this.taskId as TaskId,
      );

      const crawlingChain = new CrawlingChain({
        logger: this.logger,
        taskId: this.taskId as TaskId,
        provider: this.crawlingProvider,
        options: this.options,
        loggingExecutor,
      });

      const analysisChain = new AnalysisChain({
        logger: this.logger,
        taskId: this.taskId as TaskId,
        provider: this.analysisProvider,
        options: this.options,
        loggingExecutor,
        dateService: this.dateService,
        promptProvider: this.promptProvider?.analysis,
      });

      const contentGenerateChain = new ContentGenerateChain({
        logger: this.logger,
        taskId: this.taskId as TaskId,
        provider: this.contentGenerateProvider,
        options: this.options,
        loggingExecutor,
        dateService: this.dateService,
        promptProvider: this.promptProvider?.contentGenerate,
      });

      const taskChain = RunnableSequence.from([
        crawlingChain.chain,
        analysisChain.chain,
        contentGenerateChain.chain,
      ]);

      return await taskChain.invoke({});
    });

    this.logNewsletterResult(newsletterId);
    await this.sendPreviewNewsletterIfConfigured(newsletterId);

    return newsletterId;
  }

  /**
   * Run the pipeline while managing the task lifecycle.
   */
  private async executeWithTaskManagement<T>(pipeline: () => Promise<T>) {
    await this.startTask();
    const executor = new LoggingExecutor(this.logger, this.taskId as TaskId);
    try {
      return await executor.executeWithLogging<T>(
        {
          event: 'task',
          level: 'info',
        },
        async () => {
          return await pipeline();
        },
      );
    } finally {
      await this.endTask();
    }
  }

  private logNewsletterResult(newsletterId: string | number | null) {
    if (newsletterId === null) {
      this.logger.info({
        event: 'generate.result.skipped',
        taskId: this.taskId as TaskId,
        data: { reason: 'publicationCriteria.notMet' },
      });
      return;
    }

    this.logger.info({
      event: 'generate.result.created',
      taskId: this.taskId as TaskId,
      data: { newsletterId },
    });
  }

  private async sendPreviewNewsletterIfConfigured(
    newsletterId: string | number | null,
  ) {
    const preview = this.previewNewsletterOptions;

    if (!preview) {
      return;
    }

    if (newsletterId === null) {
      this.logger.info({
        event: 'generate.preview.skip',
        taskId: this.taskId as TaskId,
        data: { reason: 'noNewsletterCreated' },
      });
      return;
    }

    try {
      // Fetch newsletter entity for preview
      const newsletter = await preview.fetchNewsletterForPreview();

      // Compose email subject/html/text
      const subject = `[Preview] ${newsletter.title}`;
      const html = newsletter.htmlBody;
      const text = `${newsletter.title}\n\nIssue #${newsletter.issueOrder} - ${newsletter.date}`;

      await preview.emailService.send({
        ...preview.emailMessage,
        subject,
        html,
        text,
      });

      this.logger.info({
        event: 'generate.preview.sent',
        taskId: this.taskId as TaskId,
        data: {
          newsletterId,
          to: (preview.emailMessage as any).to,
        },
      });
    } catch (err) {
      this.logger.error({
        event: 'generate.preview.error',
        taskId: this.taskId as TaskId,
        data: { newsletterId },
      });
      this.logger.error(err);
    }
  }

  private async startTask() {
    this.taskId = await this.taskService.start();
  }

  private async endTask() {
    await this.taskService.end();
  }
}
