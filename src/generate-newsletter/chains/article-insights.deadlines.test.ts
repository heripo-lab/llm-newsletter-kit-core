import type { LanguageModel } from 'ai';

import type { UnscoredArticle } from '../models/article';

import { generateText } from 'ai';

import { extractArticleDeadlines } from '~/extract-article-deadlines';
import { LoggingExecutor } from '~/logging/logging-executor';

import ArticleInsightsChain from './article-insights.chain';

vi.mock('~/extract-article-deadlines');

const article: UnscoredArticle = {
  id: 1,
  title: '2026 applications',
  detailContent: 'Apply by 2026-11-13.',
  hasAttachedImage: false,
  imageContextByLlm: null,
  tag1: 'Research',
  tag2: 'Applications',
  tag3: 'Conference',
  targetUrl: 'https://example.com/board',
};
const scoreModel: LanguageModel = 'score-model';
const deadlineModel: LanguageModel = 'deadline-model';
const deadline = {
  title: 'Conference',
  kind: 'application',
  date: '2026-11-13',
  time: null,
  timeZone: null,
  status: 'active' as const,
  evidence: 'Apply by 2026-11-13.',
};

function buildChain(
  extractionOptions?: { model?: LanguageModel; includeEvents?: boolean },
  articles: UnscoredArticle[] = [article],
) {
  const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
  const promptBuilder = { system: () => 'Only extract source deadlines' };
  const chain = new ArticleInsightsChain({
    logger,
    taskId: 'task',
    provider: {
      unscoredArticles: articles,
      tags: [],
      classifyTagOptions: { model: scoreModel },
      analyzeImagesOptions: { model: scoreModel },
      determineScoreOptions: { model: scoreModel },
      extractDeadlineOptions: extractionOptions,
    },
    options: {
      content: { outputLanguage: '한국어', expertField: 'Research' },
      llm: { maxRetries: 2 },
      chain: { stopAfterAttempt: 1 },
    },
    dateService: {
      getPublicationISODateString: () => '2026-10-13',
      getPublicationDisplayDateString: () => '2026년 10월 13일',
    },
    loggingExecutor: new LoggingExecutor(logger, 'task'),
    promptProvider: { extractDeadlines: promptBuilder },
  });
  return { chain, logger, promptBuilder };
}

beforeEach(() => {
  vi.mocked(generateText).mockResolvedValue({
    output: { importanceScore: 7 },
    usage: {},
  } as never);
  vi.mocked(extractArticleDeadlines).mockResolvedValue({
    deadlines: [deadline],
    usage: undefined,
  });
});

test('disabled extraction preserves analysis shape and performs no extra call', async () => {
  const { chain } = buildChain();
  expect(await chain.generateInsights()).toEqual([
    { ...article, importanceScore: 7 },
  ]);
  expect(extractArticleDeadlines).not.toHaveBeenCalled();
});

test('configured extraction uses raw article, its model and prompt, and carries deadlines to results', async () => {
  const { chain, promptBuilder } = buildChain({ model: deadlineModel });
  expect(await chain.generateInsights()).toEqual([
    { ...article, importanceScore: 7, deadlines: [deadline] },
  ]);
  expect(extractArticleDeadlines).toHaveBeenCalledWith({
    model: deadlineModel,
    article: { ...article, importanceScore: 7 },
    outputLanguage: '한국어',
    maxRetries: 2,
    includeEvents: undefined,
    promptBuilder,
  });
});

test('an empty extraction option reuses the importance model', async () => {
  const { chain } = buildChain({});
  await chain.generateInsights();
  expect(extractArticleDeadlines).toHaveBeenCalledWith(
    expect.objectContaining({ model: scoreModel }),
  );
});

test('cached deadlines, including an empty-success result, avoid repeated extraction', async () => {
  const { chain } = buildChain({}, [
    { ...article, deadlines: [deadline] },
    { ...article, id: 2, deadlines: [] },
  ]);
  const result = await chain.generateInsights();
  expect(result[0].deadlines).toEqual([deadline]);
  expect(result[1].deadlines).toEqual([]);
  expect(extractArticleDeadlines).not.toHaveBeenCalled();
});

test('a failed extraction does not erase scoring, mark empty success, or stop later articles', async () => {
  vi.mocked(extractArticleDeadlines).mockRejectedValueOnce(
    new Error('Timeout'),
  );
  const { chain, logger } = buildChain({}, [article, { ...article, id: 2 }]);
  const result = await chain.generateInsights();
  expect(result).toEqual([
    { ...article, importanceScore: 7 },
    { ...article, id: 2, importanceScore: 7, deadlines: [deadline] },
  ]);
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'insights.deadlines.extract.failed' }),
  );
});

test('analysis carries event type and period to persistence without altering its score', async () => {
  const event = {
    ...deadline,
    type: 'event' as const,
    kind: 'attendance',
    endDate: '2026-11-14',
    endTime: '16:00',
  };
  vi.mocked(extractArticleDeadlines).mockResolvedValue({
    deadlines: [event],
    usage: undefined,
  });
  const { chain } = buildChain({ includeEvents: true });
  expect(await chain.generateInsights()).toEqual([
    { ...article, importanceScore: 7, deadlines: [event] },
  ]);
});

test.each([false, true])(
  'cached events are preserved regardless of the extraction opt-in: %s',
  async (includeEvents) => {
    const event = { ...deadline, type: 'event' as const, kind: 'attendance' };
    const { chain } = buildChain({ includeEvents }, [
      { ...article, deadlines: [deadline, event] },
    ]);
    expect((await chain.generateInsights())[0].deadlines).toEqual([
      deadline,
      event,
    ]);
    expect(extractArticleDeadlines).not.toHaveBeenCalled();
  },
);
