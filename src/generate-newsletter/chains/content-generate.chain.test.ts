import { LoggingExecutor } from '~/logging/logging-executor';

import GenerateNewsletter from '../llm-queries/generate-newsletter.llm';
import ContentGenerateChain from './content-generate.chain';

vi.mock('../llm-queries/generate-newsletter.llm', () => {
  let nextResult: any = null;
  const calls: any[] = [];
  class GenerateNewsletterMock {
    public config: any;
    constructor(config: any) {
      this.config = config;
      calls.push(config);
    }
    async execute() {
      return nextResult;
    }
    static __setExecuteResult(r: any) {
      nextResult = r;
    }
    static __getCalls() {
      return calls;
    }
  }
  return { default: GenerateNewsletterMock };
});

describe('ContentGenerateChain', () => {
  const createChain = (overrides?: Partial<any>) => {
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
    const dateService = {
      getCurrentISODateString: vi.fn().mockReturnValue('2024-01-01'),
    } as any;

    const provider = {
      model: { name: 'model-x' },
      publicationCriteria: overrides?.publicationCriteria,
      htmlTemplate: overrides?.htmlTemplate ?? {
        html: '<h1>{{title}}</h1><div>{{content}}</div>',
      },
      issueOrder: overrides?.issueOrder ?? 1,
      subscribePageUrl: overrides?.subscribePageUrl ?? 'https://sub.example',
      fetchArticleCandidates:
        overrides?.fetchArticleCandidates ?? vi.fn().mockResolvedValue([]),
      saveNewsletter:
        overrides?.saveNewsletter ?? vi.fn().mockResolvedValue({ id: 999 }),
    } as any;

    const options = {
      chain: { stopAfterAttempt: 2 },
      content: { lang: 'ko' },
      llm: { temperature: 0.2 },
    } as any;

    const chain = new ContentGenerateChain<{ id: string }>({
      logger,
      taskId: { id: 'task-1' } as any,
      provider,
      options,
      loggingExecutor: new LoggingExecutor(logger, {
        id: 'task-1',
      } as any) as any,
      dateService,
    });

    // Bind private methods so that our runnable mock preserves `this`
    // @ts-expect-error - accessing private methods for test setup
    chain.fetchArticleCandidates = chain.fetchArticleCandidates.bind(chain);
    // @ts-expect-error
    chain.generateCoreContent = chain.generateCoreContent.bind(chain);
    // @ts-expect-error
    chain.renderHtml = chain.renderHtml.bind(chain);
    // @ts-expect-error
    chain.createNewsletter = chain.createNewsletter.bind(chain);

    return { chain, provider, logger, dateService };
  };

  test('returns nulls when no candidate articles', async () => {
    const { chain, provider, logger } = createChain({
      fetchArticleCandidates: vi.fn().mockResolvedValue([]),
    });

    const result = await (chain.chain as any).invoke({});

    expect(provider.fetchArticleCandidates).toHaveBeenCalledTimes(1);
    expect(result.candidateArticles).toEqual([]);
    expect(result.generatedCoreContent).toBeNull();
    expect(result.html).toBeNull();
    expect(result.newsletterId).toBeNull();

    // no save, no LLM call
    expect(provider.saveNewsletter).not.toHaveBeenCalled();
    expect((GenerateNewsletter as any).__getCalls?.()).toHaveLength(0);

    // early-return log
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'generate.content.core.generate.noarticle',
      }),
    );
  });

  test('skips when below minimum without high-importance article', async () => {
    const candidates = Array.from({ length: 5 }).map((_, i) => ({
      url: `u${i}`,
      title: `t${i}`,
      summary: `s${i}`,
      importanceScore: 3,
    }));

    const { chain, provider, logger } = createChain({
      fetchArticleCandidates: vi.fn().mockResolvedValue(candidates),
      publicationCriteria: {
        minimumArticleCountForIssue: 5,
        priorityArticleScoreThreshold: 8,
      },
    });

    const result = await (chain.chain as any).invoke({});

    expect(result.candidateArticles).toHaveLength(5);
    expect(result.generatedCoreContent).toBeNull();
    expect(result.html).toBeNull();
    expect(result.newsletterId).toBeNull();

    expect(provider.saveNewsletter).not.toHaveBeenCalled();
    expect((GenerateNewsletter as any).__getCalls?.()).toHaveLength(0);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'generate.content.core.generate.criteria',
      }),
    );
  });

  test('generates and saves newsletter when count meets minimum (default markers)', async () => {
    const candidates = Array.from({ length: 6 }).map((_, i) => ({
      url: `u${i}`,
      title: `t${i}`,
      summary: `s${i}`,
      importanceScore: 2,
    }));

    const saveNewsletter = vi.fn().mockResolvedValue({ id: 123 });

    const { chain, provider, dateService } = createChain({
      fetchArticleCandidates: vi.fn().mockResolvedValue(candidates),
      saveNewsletter,
      htmlTemplate: { html: '<h1>{{title}}</h1>\n<p>{{content}}</p>' },
      issueOrder: 42,
    });

    // Configure LLM result
    (GenerateNewsletter as any).__setExecuteResult?.({
      title: 'Hello',
      content: 'World',
    });

    const result = await (chain.chain as any).invoke({});

    expect((GenerateNewsletter as any).__getCalls?.()).toHaveLength(1);
    const callCfg = (GenerateNewsletter as any).__getCalls?.()[0];
    expect(callCfg.model).toBe(provider.model);
    expect(callCfg.targetArticles).toEqual(candidates);
    expect(callCfg.subscribePageUrl).toBe(provider.subscribePageUrl);
    expect(callCfg.dateService).toBe(dateService);
    expect(callCfg.options).toEqual({
      content: { lang: 'ko' },
      llm: { temperature: 0.2 },
    });
    expect(callCfg.loggingExecutor).toBeTruthy();

    const expectedHtml = '<h1>Hello</h1>\n<p>World</p>';
    expect(result.generatedCoreContent).toEqual({
      title: 'Hello',
      content: 'World',
    });
    expect(result.html).toBe(expectedHtml);
    expect(saveNewsletter).toHaveBeenCalledTimes(1);
    expect(saveNewsletter).toHaveBeenCalledWith({
      newsletter: {
        title: 'Hello',
        content: 'World',
        htmlBody: expectedHtml,
        issueOrder: 42,
        date: '2024-01-01',
      },
      usedArticles: candidates,
    });
    expect(result.newsletterId).toBe(123);
  });

  test('generates when high-importance article exists despite low count (custom markers)', async () => {
    const candidates = [
      { url: 'a', title: 'A', summary: 'Sa', importanceScore: 9 },
      { url: 'b', title: 'B', summary: 'Sb', importanceScore: 1 },
    ];

    const { chain } = createChain({
      fetchArticleCandidates: vi.fn().mockResolvedValue(candidates),
      publicationCriteria: {
        minimumArticleCountForIssue: 5,
        priorityArticleScoreThreshold: 8,
      },
      htmlTemplate: {
        html: '<h1>{{mt}}</h1><section>{{mc}}</section>',
        markers: { title: 'mt', content: 'mc' },
      },
    });

    (GenerateNewsletter as any).__setExecuteResult?.({
      title: 'T',
      content: 'C',
    });

    const result = await (chain.chain as any).invoke({});

    expect(result.generatedCoreContent).toEqual({ title: 'T', content: 'C' });
    expect(result.html).toBe('<h1>T</h1><section>C</section>');
    expect(result.newsletterId).not.toBeNull();
  });
});
