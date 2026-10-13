import type { LanguageModel } from 'ai';

import { generateText } from 'ai';

import { extractArticleDeadlines } from './extract-article-deadlines';

const model: LanguageModel = 'test-model';
const article = {
  title: '2026 conference applications',
  detailContent:
    'Abstract submission closes 2026-11-13 at 18:00 Asia/Seoul.\n' +
    'Registration closes 2026-11-20.\nThe workshop application is cancelled.',
};
const deadline = {
  title: 'Conference abstract submission',
  kind: 'abstract submission',
  date: '2026-11-13',
  time: '18:00',
  timeZone: 'Asia/Seoul',
  status: 'active' as const,
  evidence: 'Abstract submission closes 2026-11-13 at 18:00 Asia/Seoul.',
};
const usage = { inputTokens: 50, outputTokens: 20, totalTokens: 70 };

function mockOutput(deadlines: unknown[], finishReason = 'stop') {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: { deadlines },
    usage,
    finishReason,
  } as never);
}

test('extracts multiple action deadlines and explicit undated cancellations from raw source', async () => {
  const registration = {
    ...deadline,
    kind: 'registration',
    date: '2026-11-20',
    time: null,
    timeZone: null,
    evidence: 'Registration closes 2026-11-20.',
  };
  const cancelled = {
    ...deadline,
    title: 'Workshop',
    kind: 'workshop application',
    date: null,
    time: null,
    timeZone: null,
    status: 'cancelled',
    evidence: 'The workshop application is cancelled.',
  };
  mockOutput([deadline, registration, cancelled]);

  await expect(
    extractArticleDeadlines({ model, article, outputLanguage: 'English' }),
  ).resolves.toEqual({ deadlines: [deadline, registration, cancelled], usage });
  const request = vi.mocked(generateText).mock.calls[0][0];
  expect(request.maxRetries).toBe(5);
  expect(request.instructions).toContain('Never fill an absent closing time');
  expect(request.instructions).toContain('Do not filter expired deadlines');
  expect(request.prompt).toContain(article.detailContent);
});

test('does not call an LLM for empty source text', async () => {
  await expect(
    extractArticleDeadlines({
      model,
      article: { title: ' ', detailContent: '\n' },
      outputLanguage: 'English',
    }),
  ).resolves.toEqual({ deadlines: [], usage: undefined });
  expect(generateText).not.toHaveBeenCalled();
});

test('allows both custom prompts while exposing only original title and body', async () => {
  const system = vi.fn(() => 'Custom extraction system');
  const user = vi.fn(() => 'Custom source prompt');
  mockOutput([]);
  await extractArticleDeadlines({
    model,
    article: { ...article, imageContextByLlm: 'An invented deadline' },
    outputLanguage: '한국어',
    maxRetries: 1,
    promptBuilder: { system, user },
  } as Parameters<typeof extractArticleDeadlines>[0]);
  const context = { outputLanguage: '한국어', targetArticle: article };
  expect(system).toHaveBeenCalledWith(context);
  expect(user).toHaveBeenCalledWith(context);
  expect(generateText).toHaveBeenCalledWith(
    expect.objectContaining({
      instructions: 'Custom extraction system',
      prompt: 'Custom source prompt',
      maxRetries: 1,
    }),
  );
});

test('an omitted custom builder independently retains its default', async () => {
  mockOutput([]);
  await extractArticleDeadlines({
    model,
    article,
    outputLanguage: '한국어',
    promptBuilder: { system: () => 'Custom system' },
  });
  expect(vi.mocked(generateText).mock.calls[0][0].prompt).toContain(
    article.detailContent,
  );
  mockOutput([]);
  await extractArticleDeadlines({
    model,
    article,
    outputLanguage: '한국어',
    promptBuilder: { user: () => 'Custom user' },
  });
  expect(vi.mocked(generateText).mock.calls[1][0].instructions).toContain(
    '한국어',
  );
});

test('drops invented evidence, guessed years, unknown active dates, and invalid time zones', async () => {
  mockOutput([
    deadline,
    { ...deadline, evidence: 'A sentence absent from the original source' },
    { ...deadline, date: '2027-11-13' },
    { ...deadline, date: null },
    { ...deadline, date: null, status: 'cancelled' },
    { ...deadline, timeZone: 'Not/A_Timezone' },
  ]);
  const result = await extractArticleDeadlines({
    model,
    article,
    outputLanguage: 'English',
  });
  expect(result.deadlines).toEqual([deadline]);
});

test('matches verbatim evidence across whitespace and full-width source characters', async () => {
  mockOutput([{ ...deadline, evidence: 'Deadline: 2026-11-13 at 18:00' }]);
  const result = await extractArticleDeadlines({
    model,
    article: {
      title: '',
      detailContent: 'Deadline:\n２０２６-１１-１３ at 18:00',
    },
    outputLanguage: 'English',
  });
  expect(result.deadlines).toHaveLength(1);
});

test.each([
  ['impossible calendar date', { date: '2026-02-30' }],
  ['invalid closing time', { time: '24:00' }],
  ['empty evidence', { evidence: ' ' }],
])('rejects structurally invalid output: %s', async (_, fields) => {
  mockOutput([{ ...deadline, ...fields }]);
  await expect(
    extractArticleDeadlines({ model, article, outputLanguage: 'English' }),
  ).rejects.toThrow();
});

test('accepts explicit seconds without inventing or dropping source precision', async () => {
  mockOutput([
    { ...deadline, time: '18:00:30', evidence: '2026-11-13 18:00:30' },
  ]);
  const result = await extractArticleDeadlines({
    model,
    article: { title: 'Application', detailContent: '2026-11-13 18:00:30' },
    outputLanguage: 'English',
  });
  expect(result.deadlines[0].time).toBe('18:00:30');
});

test('rejects truncated output and propagates LLM errors for host retry', async () => {
  mockOutput([deadline], 'length');
  await expect(
    extractArticleDeadlines({ model, article, outputLanguage: 'English' }),
  ).rejects.toThrow('Output truncated');
  vi.mocked(generateText).mockRejectedValueOnce(new Error('LLM unavailable'));
  await expect(
    extractArticleDeadlines({ model, article, outputLanguage: 'English' }),
  ).rejects.toThrow('LLM unavailable');
});
