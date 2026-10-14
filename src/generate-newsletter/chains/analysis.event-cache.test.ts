import type { LanguageModel } from 'ai';

import type { UnscoredArticle } from '../models/article';

import { generateText } from 'ai';

import { extractArticleDeadlines } from '~/extract-article-deadlines';
import { LoggingExecutor } from '~/logging/logging-executor';

import AnalysisChain from './analysis.chain';

// Run the real analysis and insights chains through the persistence callback.
vi.unmock('@langchain/core/runnables');
vi.unmock('~/generate-newsletter/chains/analysis.chain');
vi.mock('~/extract-article-deadlines');

test('enabling, disabling and re-enabling events preserves the persisted source cache', async () => {
  const model: LanguageModel = 'test-model';
  let stored: UnscoredArticle = {
    id: 1,
    title: '2026 conference',
    detailContent:
      'Registration closes 2026-11-13. Conference starts 2026-11-21.',
    hasAttachedImage: false,
    imageContextByLlm: null,
    tag1: 'Research',
    tag2: 'Conference',
    tag3: 'Applications',
    targetUrl: 'https://example.com/board',
  };
  const deadline = {
    type: 'deadline' as const,
    title: 'Conference',
    kind: 'registration',
    date: '2026-11-13',
    time: null,
    endDate: null,
    endTime: null,
    timeZone: null,
    status: 'active' as const,
    evidence: 'Registration closes 2026-11-13.',
  };
  const event = {
    ...deadline,
    type: 'event' as const,
    kind: 'attendance',
    date: '2026-11-21',
    evidence: 'Conference starts 2026-11-21.',
  };
  const cache = [deadline, event];
  vi.mocked(generateText).mockResolvedValue({
    output: { importanceScore: 7 },
    usage: {},
  } as never);
  vi.mocked(extractArticleDeadlines).mockResolvedValue({
    deadlines: cache,
    usage: undefined,
  });
  const extractDeadlineOptions = { includeEvents: true };
  const update = vi.fn(async (article: UnscoredArticle) => {
    stored = article;
  });
  const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
  const chain = new AnalysisChain({
    taskId: 'task',
    logger,
    loggingExecutor: new LoggingExecutor(logger, 'task'),
    provider: {
      fetchUnscoredArticles: async () => [stored],
      fetchTags: async () => [],
      update,
      classifyTagOptions: { model },
      analyzeImagesOptions: { model },
      determineScoreOptions: { model },
      extractDeadlineOptions,
    },
    options: {
      content: { outputLanguage: 'English', expertField: 'Research' },
      llm: { maxRetries: 0 },
      chain: { stopAfterAttempt: 1 },
    },
    dateService: {
      getPublicationISODateString: () => '2026-10-14',
      getPublicationDisplayDateString: () => 'October 14, 2026',
    },
  });
  for (const includeEvents of [true, false, true]) {
    extractDeadlineOptions.includeEvents = includeEvents;
    await chain.chain.invoke({});
    expect(stored.deadlines).toBe(cache);
    expect(stored.deadlines).toEqual([deadline, event]);
  }
  expect(update).toHaveBeenCalledTimes(3);
  expect(extractArticleDeadlines).toHaveBeenCalledTimes(1);
});
