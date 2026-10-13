import type { ArticleForGenerateContent } from '../models/article';
import type { ContentGenerateProvider } from '../models/interfaces';

import { generateText } from 'ai';

import { LoggingExecutor } from '~/logging/logging-executor';

import { NewsletterTitleValidationError } from '../utils/newsletter-title';
import ContentGenerateChain from './content-generate.chain';

// Exercise the installed retry implementation; the shared runnable mock cannot
// prove that title failures abort a full-chain retry.
vi.unmock('@langchain/core/runnables');
vi.unmock('~/generate-newsletter/chains/content-generate.chain');

const oldTitle = 'Conference applications open for archaeology researchers';
const newTitle = 'New excavation findings published by research institute';
const content = 'Original body remains unchanged.';
const article: ArticleForGenerateContent = {
  id: 1,
  title: 'New findings',
  detailContent: 'Original source.',
  hasAttachedImage: false,
  imageContextByLlm: null,
  tag1: 'Research',
  tag2: 'Archaeology',
  tag3: 'Findings',
  importanceScore: 9,
  contentType: 'news',
  targetUrl: 'https://example.com/board',
  url: 'https://example.com/article',
};

function mockBody(title = oldTitle) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: {
      title,
      content,
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    },
    usage: {},
    finishReason: 'stop',
  } as never);
}

function mockTitle(title: string) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: {
      title,
      isWrittenInOutputLanguage: true,
      factAccuracy: true,
    },
    usage: {},
    finishReason: 'stop',
  } as never);
}

function buildChain(candidates = [article], attempts = 3) {
  const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
  const fetchRecentTitles = vi
    .fn<NonNullable<ContentGenerateProvider['fetchRecentTitles']>>()
    .mockResolvedValue([oldTitle]);
  const saveNewsletter = vi
    .fn<ContentGenerateProvider['saveNewsletter']>()
    .mockResolvedValue({ id: 1 });
  const chain = new ContentGenerateChain({
    taskId: 'task',
    logger,
    provider: {
      model: 'test-model',
      issueOrder: 1,
      newsletterBrandName: 'Research Radar',
      htmlTemplate: { html: '<h1>{{title}}</h1><div>{{content}}</div>' },
      fetchArticleCandidates: async () => candidates,
      fetchRecentTitles,
      saveNewsletter,
    },
    options: {
      content: { outputLanguage: 'English', expertField: 'Research' },
      llm: { maxRetries: 0 },
      chain: { stopAfterAttempt: attempts },
    },
    dateService: {
      getPublicationISODateString: () => '2026-10-13',
      getPublicationDisplayDateString: () => 'October 13, 2026',
    },
    loggingExecutor: new LoggingExecutor(logger, 'task'),
  });
  return { chain, fetchRecentTitles, saveNewsletter };
}

test('a repaired title is rendered and saved with the same Markdown and article candidates', async () => {
  mockBody();
  mockTitle(newTitle);
  const { chain, fetchRecentTitles, saveNewsletter } = buildChain();
  await chain.chain.invoke({});
  expect(fetchRecentTitles).toHaveBeenCalledWith('2026-10-13');
  expect(saveNewsletter).toHaveBeenCalledWith({
    newsletter: expect.objectContaining({
      title: newTitle,
      content,
      htmlBody: expect.stringContaining(newTitle),
    }),
    usedArticles: [article],
  });
  expect(generateText).toHaveBeenCalledTimes(2);
});

test('title rewrite exhaustion never regenerates a full body or saves a duplicate', async () => {
  mockBody();
  mockTitle(oldTitle);
  mockTitle(oldTitle);
  const { chain, fetchRecentTitles, saveNewsletter } = buildChain();
  await expect(chain.chain.invoke({})).rejects.toThrow(
    NewsletterTitleValidationError,
  );
  expect(generateText).toHaveBeenCalledTimes(3);
  expect(fetchRecentTitles).toHaveBeenCalledTimes(1);
  expect(saveNewsletter).not.toHaveBeenCalled();
});

test.each([
  { candidates: [] },
  { candidates: [{ ...article, importanceScore: 3 }] },
])(
  'skipped issues do not fetch history or call an LLM',
  async ({ candidates }) => {
    const { chain, fetchRecentTitles, saveNewsletter } = buildChain(candidates);
    const result = await chain.chain.invoke({});
    expect(result.newsletterId).toBeNull();
    expect(fetchRecentTitles).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(saveNewsletter).not.toHaveBeenCalled();
  },
);

test('history lookup failures do not silently disable the safeguard', async () => {
  const { chain, fetchRecentTitles, saveNewsletter } = buildChain([article], 1);
  fetchRecentTitles.mockRejectedValueOnce(new Error('History unavailable'));
  await expect(chain.chain.invoke({})).rejects.toThrow('History unavailable');
  expect(generateText).not.toHaveBeenCalled();
  expect(saveNewsletter).not.toHaveBeenCalled();
});
