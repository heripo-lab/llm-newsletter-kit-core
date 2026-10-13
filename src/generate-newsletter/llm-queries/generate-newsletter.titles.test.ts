import { generateText } from 'ai';

import { LoggingExecutor } from '~/logging/logging-executor';

import {
  NewsletterTitleValidationError,
  normalizeNewsletterTitle,
} from '../utils/newsletter-title';
import GenerateNewsletter from './generate-newsletter.llm';

const oldTitle = 'New applications open for archaeology researchers';
const newTitle = 'Conference registration closes on November thirteen';
const content = 'Registration closes on November 13. Original **body** stays.';
const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };

function mockBody(title = oldTitle) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: {
      title,
      content,
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    },
    usage,
    finishReason: 'stop',
  } as never);
}

function mockTitle(
  title = newTitle,
  overrides: Record<string, unknown> = {},
  finishReason = 'stop',
) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: {
      title,
      isWrittenInOutputLanguage: true,
      factAccuracy: true,
      ...overrides,
    },
    usage,
    finishReason,
  } as never);
}

function buildQuery(
  recentTitles?: string[],
  titleContext?: string,
  overrides: Partial<ConstructorParameters<typeof GenerateNewsletter>[0]> = {},
) {
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return new GenerateNewsletter({
    model: 'test-model',
    logger,
    taskId: 'task',
    options: {
      content: {
        outputLanguage: 'English',
        expertField: 'Archaeology',
        titleContext,
      },
      llm: { maxRetries: 0 },
    },
    loggingExecutor: new LoggingExecutor(logger, 'task'),
    targetArticles: [],
    dateService: {
      getPublicationISODateString: () => '2026-10-13',
      getPublicationDisplayDateString: () => 'October 13, 2026',
    },
    newsletterBrandName: 'Research Radar',
    recentTitles,
    ...overrides,
  });
}

test('title comparison normalizes Unicode, case, punctuation, symbols and whitespace', () => {
  expect(normalizeNewsletterTitle(' “Ｎｅｗ”  POLICY! 🏺 ')).toBe('newpolicy');
  expect(normalizeNewsletterTitle('마감 2026-11-13')).toBe('마감20261113');
  expect(normalizeNewsletterTitle('새로운 소식')).not.toBe(
    normalizeNewsletterTitle('다른 소식'),
  );
});

test('a unique title with history or an empty history requires no rewrite', async () => {
  mockBody(newTitle);
  expect((await buildQuery([oldTitle]).execute()).result).toEqual({
    title: newTitle,
    content,
  });
  expect(vi.mocked(generateText).mock.calls[0][0].instructions).toContain(
    oldTitle,
  );
  mockBody(newTitle);
  await buildQuery([]).execute();
  expect(vi.mocked(generateText).mock.calls[1][0].instructions).not.toContain(
    'Recent published titles',
  );
  expect(generateText).toHaveBeenCalledTimes(2);
});

test('normalized duplicate titles are rewritten without changing the body and usage is accumulated', async () => {
  mockBody(`“${oldTitle.toUpperCase()}!”`);
  mockTitle();
  const result = await buildQuery([oldTitle]).execute();
  expect(result.result).toEqual({ title: newTitle, content });
  expect(result.usage).toEqual(
    expect.objectContaining({
      inputTokens: 2,
      outputTokens: 4,
      totalTokens: 6,
    }),
  );
  expect(generateText).toHaveBeenCalledTimes(2);
  const repair = vi.mocked(generateText).mock.calls[1][0];
  expect(repair.instructions).toContain('Rewrite only the email title');
  expect(repair.prompt).toContain(content);
  expect(repair.prompt).toContain(oldTitle);
  expect(repair.maxOutputTokens).toBe(512);
  expect(
    (repair.output as unknown as { schema: { shape: object } }).schema.shape,
  ).not.toHaveProperty('content');
});

test('a second title-only rewrite gets rejected titles and still preserves the original body', async () => {
  mockBody();
  mockTitle(`${oldTitle}!`);
  mockTitle();
  const result = await buildQuery([oldTitle]).execute();
  expect(result.result).toEqual({ title: newTitle, content });
  expect(result.usage.totalTokens).toBe(9);
  expect(vi.mocked(generateText).mock.calls[2][0].prompt).toContain(
    `${oldTitle}!`,
  );
  expect(generateText).toHaveBeenCalledTimes(3);
});

test('duplicate exhaustion throws after exactly two title-only calls', async () => {
  mockBody();
  mockTitle(oldTitle);
  mockTitle(oldTitle);
  await expect(buildQuery([oldTitle]).execute()).rejects.toThrow(
    NewsletterTitleValidationError,
  );
  expect(generateText).toHaveBeenCalledTimes(3);
});

test('titleContext failures in guarded mode repair only the title, even with empty history', async () => {
  mockBody();
  mockTitle('Unrelated conference registration deadline announcement');
  const fixedTitle = 'Research Radar: conference registration closes soon';
  mockTitle(fixedTitle);
  const result = await buildQuery([], 'Research Radar').execute();
  expect(result.result).toEqual({ title: fixedTitle, content });
  expect(generateText).toHaveBeenCalledTimes(3);
  expect(vi.mocked(generateText).mock.calls[1][0].instructions).toContain(
    'Include the exact phrase "Research Radar"',
  );
});

test('the fixed titleContext can repeat while the full headline changes', async () => {
  const title = 'Research Radar: new conference registration deadline';
  mockBody(title);
  await expect(
    buildQuery(
      ['Research Radar: last week excavation findings'],
      'Research Radar',
    ).execute(),
  ).resolves.toEqual({ result: { title, content }, usage });
  expect(generateText).toHaveBeenCalledTimes(1);
});

test.each([
  ['too short', 'Short'],
  ['too long', 'x'.repeat(71)],
  ['only punctuation', '!'.repeat(20)],
])('repairs invalid initial titles: %s', async (_, title) => {
  mockBody(title);
  mockTitle();
  expect((await buildQuery([]).execute()).result.title).toBe(newTitle);
});

test('malformed rewrite output cannot bypass title validation', async () => {
  mockBody();
  mockTitle('Short');
  mockTitle();
  expect((await buildQuery([oldTitle]).execute()).result.title).toBe(newTitle);
  expect(generateText).toHaveBeenCalledTimes(3);
});

test.each(['isWrittenInOutputLanguage', 'factAccuracy'])(
  'retries a title failing %s without regenerating content',
  async (check) => {
    mockBody();
    mockTitle(newTitle, { [check]: false });
    mockTitle();
    expect((await buildQuery([oldTitle]).execute()).result).toEqual({
      title: newTitle,
      content,
    });
    expect(generateText).toHaveBeenCalledTimes(3);
  },
);

test('custom content prompts receive recent titles and retain the history safeguard', async () => {
  const system = vi.fn(() => 'Custom content system');
  const user = vi.fn(() => 'Current articles only');
  mockBody(newTitle);
  await buildQuery([oldTitle], undefined, {
    promptBuilder: { system, user },
  }).execute();
  expect(system).toHaveBeenCalledWith(
    expect.objectContaining({ recentTitles: [oldTitle] }),
  );
  expect(user).toHaveBeenCalledWith(
    expect.objectContaining({ recentTitles: [oldTitle] }),
  );
  const request = vi.mocked(generateText).mock.calls[0][0];
  expect(request.instructions).toContain('Custom content system');
  expect(request.instructions).toContain(oldTitle);
  expect(request.prompt).toBe('Current articles only');
});

test('custom title builders receive the unchanged body, history and rejection feedback', async () => {
  const system = vi.fn((_context: unknown) => 'Custom title system');
  const user = vi.fn(() => 'Custom title user');
  mockBody();
  mockTitle();
  await buildQuery([oldTitle], undefined, {
    titlePromptBuilder: { system, user },
  }).execute();
  expect(system).toHaveBeenCalledWith({
    outputLanguage: 'English',
    titleContext: undefined,
    newsletterContent: content,
    currentTitle: oldTitle,
    recentTitles: [oldTitle],
    rejectedTitles: [oldTitle],
  });
  expect(user).toHaveBeenCalledWith(system.mock.calls[0][0]);
  expect(generateText).toHaveBeenLastCalledWith(
    expect.objectContaining({
      instructions: 'Custom title system',
      prompt: 'Custom title user',
    }),
  );
});

test.each(['system', 'user'] as const)(
  'an omitted custom title %s builder uses its default',
  async (slot) => {
    mockBody();
    mockTitle();
    await buildQuery([oldTitle], undefined, {
      titlePromptBuilder: { [slot]: () => 'Custom title prompt' },
    }).execute();
    const request = vi.mocked(generateText).mock.calls[1][0];
    expect(slot === 'system' ? request.prompt : request.instructions).toContain(
      slot === 'system' ? content : 'Rewrite only the email title',
    );
  },
);

test('title SDK failures are terminal and retain the cause', async () => {
  mockBody();
  const failure = new Error('Provider unavailable');
  vi.mocked(generateText).mockRejectedValueOnce(failure);
  await expect(buildQuery([oldTitle]).execute()).rejects.toMatchObject({
    name: 'NewsletterTitleValidationError',
    cause: failure,
  });
  expect(generateText).toHaveBeenCalledTimes(2);
});

test('truncated title rewrites are terminal instead of being saved', async () => {
  mockBody();
  mockTitle(newTitle, {}, 'length');
  await expect(buildQuery([oldTitle]).execute()).rejects.toMatchObject({
    name: 'NewsletterTitleValidationError',
    cause: expect.objectContaining({ message: 'Title output truncated.' }),
  });
});

test.each([
  ['zero width space', '\u200B'],
  ['word joiner', '\u2060'],
  ['zero width non-joiner', '\u200C'],
  ['zero width joiner', '\u200D'],
  ['zero width no-break space', '\uFEFF'],
  ['left-to-right mark', '\u200E'],
  ['right-to-left override', '\u202E'],
  ['directional isolate', '\u2066'],
  ['soft hyphen', '\u00AD'],
  ['text variation selector', '\uFE0E'],
  ['emoji variation selector', '\uFE0F'],
  ['supplementary variation selector', '\u{E0100}'],
])(
  'invisible %s characters cannot distinguish otherwise identical titles',
  (_, character) => {
    expect(normalizeNewsletterTitle(`Research${character}Radar News`)).toBe(
      normalizeNewsletterTitle('Research Radar News'),
    );
  },
);

test('removing invisible marks precedes Unicode composition and preserves visible accents and Hangul', () => {
  expect(normalizeNewsletterTitle('Cafe\u034F\u0301 news')).toBe(
    normalizeNewsletterTitle('Café news'),
  );
  expect(normalizeNewsletterTitle('Café news')).not.toBe(
    normalizeNewsletterTitle('Cafe news'),
  );
  expect(normalizeNewsletterTitle('연구\u200B소의 새로운 소식')).toBe(
    normalizeNewsletterTitle('연구소의 새로운 소식'),
  );
  expect(normalizeNewsletterTitle('다른 연구 소식')).not.toBe(
    normalizeNewsletterTitle('연구소의 새로운 소식'),
  );
  expect(normalizeNewsletterTitle('\u200B\u2060\uFEFF')).toBe('');
});

test('invisible characters in both stored and generated titles trigger title-only repair', async () => {
  mockBody(oldTitle.replace(' ', '\u200B'));
  mockTitle(oldTitle + '\u2060');
  mockTitle(newTitle);
  const result = await buildQuery([oldTitle + '\uFEFF']).execute();
  expect(result.result).toEqual({ title: newTitle, content });
  expect(generateText).toHaveBeenCalledTimes(3);
});
