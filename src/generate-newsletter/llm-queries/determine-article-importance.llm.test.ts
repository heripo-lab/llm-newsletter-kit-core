import { generateText } from 'ai';

import DetermineArticleImportance from './determine-article-importance.llm';

describe('DetermineArticleImportance', () => {
  const date = '2024-01-02T10:00:00.000Z';

  test('execute calls generateText correctly (minPoint=1, no image) and returns importance score', async () => {
    const model: any = { name: 'fake-model' };
    const logger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const loggingExecutor: any = {
      // Base class dependency; not used directly here
      executeWithLogging: vi.fn(async (_taskId: any, fn: any) => fn()),
    };

    const options: any = {
      content: { outputLanguage: 'Korean', expertField: 'AI' },
      llm: { maxRetries: 2 },
    };

    const targetArticle: any = {
      targetUrl: 'https://example.com/a',
      title: 'New Research Published',
      detailContent: 'A significant study has been released.',
      tag1: 'Research',
      tag2: 'Publication',
      tag3: 'AI',
      // imageContextByLlm: undefined
    };

    const query = new DetermineArticleImportance({
      model,
      logger,
      taskId: 'task-1',
      targetArticle,
      options,
      loggingExecutor,
      dateService: {
        getCurrentISODateString: () => date,
        getDisplayDateString: () => date,
      },
    });

    vi.mocked(generateText).mockResolvedValue({
      output: { importanceScore: 7 },
    } as any);

    const result = await query.execute();

    expect(result).toBe(7);
    expect(generateText).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.model).toBe(model);
    expect(callArg.maxRetries).toBe(2);

    // zod schema boundaries
    expect(() =>
      callArg.output.schema.parse({ importanceScore: 1 }),
    ).not.toThrow();
    expect(() =>
      callArg.output.schema.parse({ importanceScore: 10 }),
    ).not.toThrow();
    expect(() => callArg.output.schema.parse({ importanceScore: 0 })).toThrow();
    expect(() =>
      callArg.output.schema.parse({ importanceScore: 11 }),
    ).toThrow();

    // system prompt should include expert field and reflect minPoint=1 branch
    expect(callArg.system).toContain('AI');
    expect(callArg.system).toContain('Importance Score Criteria (1-10)');
    expect(callArg.system).toContain(
      '1: Information without current significance',
    );
    expect(callArg.system).toContain(
      '(However, recent academic achievements maintain high scores)',
    );

    // user prompt should include date, title, content, tags; exclude Image Analysis
    expect(callArg.prompt).toContain(
      'Please rate the importance of this article from 1 to 10.',
    );
    expect(callArg.prompt).toContain(date);
    expect(callArg.prompt).toContain(targetArticle.title);
    expect(callArg.prompt).toContain(targetArticle.detailContent);
    expect(callArg.prompt).toContain(
      `${targetArticle.tag1}, ${targetArticle.tag2}, ${targetArticle.tag3}`,
    );
    expect(callArg.prompt).not.toContain('**Image Analysis:**');
  });

  test('respects minimumImportanceScoreRules and includes image analysis (minPoint>1)', async () => {
    const model: any = { name: 'fake-model-2' };
    const logger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const loggingExecutor: any = {
      executeWithLogging: vi.fn(async (_taskId: any, fn: any) => fn()),
    };

    const options: any = {
      content: { outputLanguage: 'English', expertField: 'Robotics' },
      llm: { maxRetries: 5 },
    };

    const targetArticle: any = {
      targetUrl: 'https://example.com/important',
      title: 'Major Funding Announced',
      detailContent:
        'Government announces major funding for robotics research.',
      tag1: 'Funding',
      tag2: 'Government',
      tag3: 'Robotics',
      imageContextByLlm: 'An infographic showing funding allocations.',
    };

    const minimumImportanceScoreRules = [
      { targetUrl: 'https://example.com/important', minScore: 5 },
      { targetUrl: 'https://example.com/other', minScore: 3 },
    ];

    const query = new DetermineArticleImportance({
      model,
      logger,
      taskId: 'task-2',
      targetArticle,
      options,
      loggingExecutor,
      minimumImportanceScoreRules,
      dateService: {
        getCurrentISODateString: () => date,
        getDisplayDateString: () => date,
      },
    });

    vi.mocked(generateText).mockResolvedValue({
      output: { importanceScore: 9 },
    } as any);

    const date = '2024-05-10T08:00:00.000Z';
    const result = await query.execute();

    expect(result).toBe(9);
    expect(generateText).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.model).toBe(model);
    expect(callArg.maxRetries).toBe(5);

    // system prompt should reflect minPoint=5 branch and exclude 1-point guidance and the parenthetical
    expect(callArg.system).toContain('Robotics');
    expect(callArg.system).toContain('Importance Score Criteria (5-10)');
    expect(callArg.system).not.toContain(
      '1: Information without current significance',
    );
    expect(callArg.system).not.toContain(
      '(However, recent academic achievements maintain high scores)',
    );

    // user prompt should include image analysis and correct min point
    expect(callArg.prompt).toContain(
      'Please rate the importance of this article from 5 to 10.',
    );
    expect(callArg.prompt).toContain(date);
    expect(callArg.prompt).toContain(targetArticle.title);
    expect(callArg.prompt).toContain(targetArticle.detailContent);
    expect(callArg.prompt).toContain(
      `${targetArticle.tag1}, ${targetArticle.tag2}, ${targetArticle.tag3}`,
    );
    expect(callArg.prompt).toContain('**Image Analysis:**');
    expect(callArg.prompt).toContain(targetArticle.imageContextByLlm);
  });
});

describe('DetermineArticleImportance - fallbacks', () => {
  test('uses fallback values when title/content/tags are missing', async () => {
    const model: any = { name: 'fake-model-3' };
    const logger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const loggingExecutor: any = {
      executeWithLogging: vi.fn(async (_taskId: any, fn: any) => fn()),
    };

    const options: any = {
      content: { outputLanguage: 'Korean', expertField: 'AI' },
      llm: { maxRetries: 1 },
    };

    const targetArticle: any = {
      targetUrl: 'https://example.com/fallbacks',
      // title undefined
      title: undefined,
      // content empty string to trigger fallback
      detailContent: '',
      // all tags missing/empty to render as ", , "
      tag1: undefined,
      tag2: '',
      tag3: undefined,
      // no image
    };

    const query = new (
      await import('./determine-article-importance.llm')
    ).default({
      model,
      logger,
      taskId: 'task-3',
      targetArticle,
      options,
      loggingExecutor,
      dateService: {
        getCurrentISODateString: () => date,
        getDisplayDateString: () => date,
      },
    });

    vi.mocked((await import('ai')).generateText).mockResolvedValue({
      output: { importanceScore: 3 },
    } as any);

    const date = '2024-06-15T12:30:00.000Z';
    const result = await query.execute();

    expect(result).toBe(3);

    const callArg = vi.mocked((await import('ai')).generateText).mock
      .calls[0][0] as any;

    expect(callArg.prompt).toContain(
      'Please rate the importance of this article from 1 to 10.',
    );
    expect(callArg.prompt).toContain(date);
    expect(callArg.prompt).toContain('**Title:** No Title');
    expect(callArg.prompt).toContain('**Content:** No Content');
    expect(callArg.prompt).toContain('**Tags:** , , ');
    expect(callArg.prompt).not.toContain('**Image Analysis:**');
  });
});
