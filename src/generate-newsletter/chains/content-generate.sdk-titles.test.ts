import type { ArticleForGenerateContent } from '../models/article';

import { NoObjectGeneratedError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

import { LoggingExecutor } from '~/logging/logging-executor';

import { generateObjectByLLM } from '../llm-queries/generate-object-by-llm';
import { NewsletterTitleValidationError } from '../utils/newsletter-title';
import ContentGenerateChain from './content-generate.chain';

// Keep Output.object(), Zod validation and chain retry behavior real. Only the
// provider transport and persistence are replaced; no network or API key is used.
vi.unmock('ai');
vi.unmock('@langchain/core/runnables');
vi.unmock('~/generate-newsletter/chains/content-generate.chain');

const oldTitle = 'Conference applications open for archaeology researchers';
const newTitle = 'New excavation findings published by research institute';
const content = 'Original **body** remains unchanged.';
const article: ArticleForGenerateContent = {
  id: 1,
  title: 'Research',
  detailContent: content,
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

function response(output: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
}
const body = (title: string) =>
  response({
    title,
    content,
    isWrittenInOutputLanguage: true,
    copyrightVerified: true,
    factAccuracy: true,
  });
const title = (value: unknown) =>
  response({
    title: value,
    isWrittenInOutputLanguage: true,
    factAccuracy: true,
  });

function build(
  responses: ReturnType<typeof response>[],
  history: string[] | undefined,
  attempts = 1,
) {
  const model = new MockLanguageModelV4({ doGenerate: responses });
  const saveNewsletter = vi.fn().mockResolvedValue({ id: 1 });
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const chain = new ContentGenerateChain({
    taskId: 'task',
    logger,
    loggingExecutor: new LoggingExecutor(logger, 'task'),
    provider: {
      model,
      issueOrder: 1,
      newsletterBrandName: 'Research Radar',
      htmlTemplate: { html: '<h1>{{title}}</h1><div>{{content}}</div>' },
      fetchArticleCandidates: async () => [article],
      ...(history !== undefined && { fetchRecentTitles: async () => history }),
      saveNewsletter,
    },
    options: {
      content: { outputLanguage: 'English', expertField: 'Research' },
      llm: { maxRetries: 0 },
      chain: { stopAfterAttempt: attempts },
    },
    dateService: {
      getPublicationISODateString: () => '2026-10-14',
      getPublicationDisplayDateString: () => 'October 14, 2026',
    },
  });
  return { chain, model, saveNewsletter };
}

test('the installed SDK rejects an out-of-range title before returning a strict object', async () => {
  const model = new MockLanguageModelV4({ doGenerate: title('x'.repeat(19)) });
  await expect(
    generateObjectByLLM({
      model,
      maxRetries: 0,
      prompt: 'title',
      schema: z.object({
        title: z.string().min(20).max(70),
        isWrittenInOutputLanguage: z.boolean(),
        factAccuracy: z.boolean(),
      }),
    }),
  ).rejects.toThrow(NoObjectGeneratedError);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test.each(['', 'x'.repeat(19), 'x'.repeat(71)])(
  'guarded generation repairs a title of length %s through the actual SDK',
  async (invalid) => {
    const { chain, model, saveNewsletter } = build(
      [body(invalid), title(newTitle)],
      [],
    );
    await chain.chain.invoke({});
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(saveNewsletter).toHaveBeenCalledWith({
      newsletter: expect.objectContaining({
        title: newTitle,
        content,
        htmlBody: expect.stringContaining(newTitle),
      }),
      usedArticles: [article],
    });
  },
);

test.each(['', 'x'.repeat(19), 'x'.repeat(71)])(
  'a rewrite of length %s can use the second title-only attempt through the actual SDK',
  async (invalid) => {
    const { chain, model, saveNewsletter } = build(
      [body(oldTitle), title(invalid), title(newTitle)],
      [oldTitle],
    );
    await chain.chain.invoke({});
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(saveNewsletter).toHaveBeenCalledWith({
      newsletter: expect.objectContaining({ title: newTitle, content }),
      usedArticles: [article],
    });
    const rewritePrompt = JSON.stringify(model.doGenerateCalls[2].prompt);
    expect(rewritePrompt).toContain(content);
    expect(rewritePrompt).toContain(invalid);
  },
);

test('actual SDK length failures exhaust two title-only attempts without restarting the body chain', async () => {
  const { chain, model, saveNewsletter } = build(
    [body(oldTitle), title('x'.repeat(19)), title('x'.repeat(71))],
    [oldTitle],
    3,
  );
  await expect(chain.chain.invoke({})).rejects.toThrow(
    NewsletterTitleValidationError,
  );
  expect(model.doGenerateCalls).toHaveLength(3);
  expect(saveNewsletter).not.toHaveBeenCalled();
});

test('a structurally invalid title output remains terminal through the real SDK', async () => {
  const { chain, model, saveNewsletter } = build(
    [body(oldTitle), title(123)],
    [oldTitle],
    3,
  );
  await expect(chain.chain.invoke({})).rejects.toMatchObject({
    name: 'NewsletterTitleValidationError',
    cause: expect.any(NoObjectGeneratedError),
  });
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(saveNewsletter).not.toHaveBeenCalled();
});

test('without the title guard the SDK retains its existing strict title schema', async () => {
  const { chain, model, saveNewsletter } = build(
    [body('x'.repeat(19))],
    undefined,
  );
  await expect(chain.chain.invoke({})).rejects.toThrow(NoObjectGeneratedError);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(saveNewsletter).not.toHaveBeenCalled();
});
