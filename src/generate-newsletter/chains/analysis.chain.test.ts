import { RunnablePassthrough } from '@langchain/core/runnables';
import * as Runnables from '@langchain/core/runnables';

import AnalysisChain from './analysis.chain';

vi.unmock('~/generate-newsletter/chains/analysis.chain');

vi.mock('./article-insights.chain', () => {
  const localGenerate = vi.fn();
  const Ctor: any = vi.fn().mockImplementation(function (
    this: any,
    config: any,
  ) {
    this.__config = config;
  });
  Ctor.prototype.generateInsights = function (...args: any[]) {
    return localGenerate(...args);
  };
  Ctor.__generateInsightsMock = localGenerate;
  return { default: Ctor };
});

function makeSut() {
  const provider = {
    fetchUnscoredArticles: vi.fn(),
    fetchTags: vi.fn(),
    update: vi.fn(),
  };

  const logger = {
    child: vi.fn().mockReturnThis(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;

  const options = {
    chain: {
      stopAfterAttempt: 3,
    },
  } as any;

  const loggingExecutor = { executeWithLogging: vi.fn() } as any;

  const sut = new AnalysisChain<{ id: string }>({
    logger,
    taskId: { id: 'task-1' },
    provider: provider as any,
    options,
    loggingExecutor,
    dateService: {},
  } as any);

  // Make executeWithLogging transparent and capturable
  const capturedMeta: any[] = [];
  const execSpy = vi
    .spyOn(sut as any, 'executeWithLogging')
    .mockImplementation(async (meta: any, fn: any) => {
      capturedMeta.push(meta);
      return await fn();
    });

  return { sut, provider, logger, options, execSpy, capturedMeta } as const;
}

describe('AnalysisChain', () => {
  test('chain getter builds a runnable chain without throwing', () => {
    const { sut } = makeSut();

    expect(() => {
      const _chain = sut.chain;
      void _chain;
    }).not.toThrow();

    // If RunnablePassthrough.assign is a mock function, it should have been called
    const maybeMock = (RunnablePassthrough as any).assign;
    if (typeof maybeMock === 'function' && 'mock' in maybeMock) {
      expect(maybeMock.mock.calls.length).toBeGreaterThan(0);
    }
  });

  test('fetchUnscoredArticles delegates to provider via executeWithLogging and returns items', async () => {
    const { sut, provider, execSpy, capturedMeta } = makeSut();
    const items = [{ id: 'a' }, { id: 'b' }];
    provider.fetchUnscoredArticles.mockResolvedValue(items);

    const result = await (sut as any).fetchUnscoredArticles();

    expect(result).toBe(items);
    expect(provider.fetchUnscoredArticles).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledTimes(1);
    const meta = capturedMeta[0];
    expect(meta.event).toBe('analysis.articles.fetch');
    expect(typeof meta.doneFields).toBe('function');
    expect(meta.doneFields(items)).toEqual({ count: items.length });
  });

  test('fetchTags delegates to provider via executeWithLogging and returns tags', async () => {
    const { sut, provider, execSpy, capturedMeta } = makeSut();
    const tags = ['ai', 'web'];
    provider.fetchTags.mockResolvedValue(tags);

    const result = await (sut as any).fetchTags();

    expect(result).toBe(tags);
    expect(provider.fetchTags).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledTimes(1);
    const meta = capturedMeta[0];
    expect(meta.event).toBe('analysis.tags.fetch');
    expect(typeof meta.doneFields).toBe('function');
    expect(meta.doneFields(tags)).toEqual({ count: tags.length });
  });

  test('analyzeArticles constructs ArticleInsightsChain with correct config and returns generated insights', async () => {
    const { sut, logger, options, capturedMeta } = makeSut();
    const unscoredArticles = [{ id: '1' }];
    const tags = ['tag1'];
    const determined = [{ id: '1', score: 1 }];

    const ArticleInsightsModule: any = await import('./article-insights.chain');
    const ArticleInsightsChainMock: any = ArticleInsightsModule.default as any;
    const localGenerateMock: any =
      ArticleInsightsChainMock.__generateInsightsMock;
    localGenerateMock.mockResolvedValue(determined);

    const result = await (sut as any).analyzeArticles(unscoredArticles, tags);

    expect(result).toBe(determined);
    expect(ArticleInsightsChainMock).toHaveBeenCalledTimes(1);

    const call = ArticleInsightsChainMock.mock.calls[0][0];
    expect(call.logger).toBe(logger);
    expect(call.taskId).toEqual({ id: 'task-1' });
    expect(call.provider).toEqual({ unscoredArticles, tags });
    expect(call.options).toBe(options);
    // loggingExecutor existence (instance specifics are globally mocked)
    expect('loggingExecutor' in call).toBe(true);

    expect(localGenerateMock).toHaveBeenCalledTimes(1);

    // executeWithLogging metadata assertions for analyzeArticles
    expect(capturedMeta.length).toBe(1);
    const meta = capturedMeta[0];
    expect(meta.event).toBe('analysis.articles.analyze');
    expect(meta.startFields).toEqual({ unscoredArticles, tags });
    expect(typeof meta.doneFields).toBe('function');
    expect(meta.doneFields(determined)).toEqual({ count: determined.length });
  });

  test('updateAnalysisContext updates all articles via provider and returns count', async () => {
    const { sut, provider, execSpy, capturedMeta } = makeSut();
    const determined = [{ id: '1' }, { id: '2' }];

    const result = await (sut as any).updateAnalysisContext(determined);

    expect(result).toBe(2);
    expect(provider.update).toHaveBeenCalledTimes(2);
    expect(provider.update).toHaveBeenNthCalledWith(1, determined[0]);
    expect(provider.update).toHaveBeenNthCalledWith(2, determined[1]);

    expect(execSpy).toHaveBeenCalledTimes(1);
    const meta = capturedMeta[0];
    expect(meta.event).toBe('analysis.articles.update');
    expect(typeof meta.doneFields).toBe('function');
    expect(meta.doneFields(result)).toEqual({ count: result });
    expect(meta.startFields).toEqual({ determinedArticles: determined });
  });

  test('chain getter lambdas call fetchUnscoredArticles and fetchTags', async () => {
    (Runnables as any).__resetRunnables();
    const { sut } = makeSut();

    const _chain = sut.chain;
    void _chain;

    const calls = (Runnables as any).__getAssignCalls();
    expect(calls.length).toBeGreaterThanOrEqual(3);

    const firstMapping = calls[0];

    const fetchArticlesSpy = vi
      .spyOn(sut as any, 'fetchUnscoredArticles')
      .mockResolvedValue([{ id: 'a1' }] as any);
    const fetchTagsSpy = vi
      .spyOn(sut as any, 'fetchTags')
      .mockResolvedValue(['tag1'] as any);

    const articles = await firstMapping.unscoredArticles();
    expect(fetchArticlesSpy).toHaveBeenCalledTimes(1);
    expect(articles).toEqual([{ id: 'a1' }]);

    const tags = await firstMapping.tags();
    expect(fetchTagsSpy).toHaveBeenCalledTimes(1);
    expect(tags).toEqual(['tag1']);
  });

  test('chain getter lambdas call analyzeArticles and updateAnalysisContext', async () => {
    (Runnables as any).__resetRunnables();
    const { sut } = makeSut();

    const _chain = sut.chain;
    void _chain;

    const calls = (Runnables as any).__getAssignCalls();
    expect(calls.length).toBeGreaterThanOrEqual(3);

    const secondMapping = calls[1];
    const thirdMapping = calls[2];

    const analyzeSpy = vi
      .spyOn(sut as any, 'analyzeArticles')
      .mockResolvedValue([{ id: 'x' }] as any);
    const updateSpy = vi
      .spyOn(sut as any, 'updateAnalysisContext')
      .mockResolvedValue(1 as any);

    const unscoredArticles = [{ id: 'u1' }];
    const tags = ['t1'];
    const det = await secondMapping.determinedArticles({
      unscoredArticles,
      tags,
    });
    expect(analyzeSpy).toHaveBeenCalledWith(unscoredArticles, tags);
    expect(det).toEqual([{ id: 'x' }]);

    const processed = await thirdMapping.processedCount({
      determinedArticles: det,
    });
    expect(updateSpy).toHaveBeenCalledWith(det);
    expect(processed).toBe(1);
  });
});
