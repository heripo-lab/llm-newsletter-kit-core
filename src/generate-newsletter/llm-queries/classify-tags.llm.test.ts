import { generateText } from 'ai';

import ClassifyTags from './classify-tags.llm';

describe('ClassifyTags', () => {
  test('execute calls generateText with correct params and returns object', async () => {
    const model: any = { name: 'fake-model' };
    const logger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    const loggingExecutor: any = {
      // Not used by ClassifyTags directly, but required by base class
      executeWithLogging: vi.fn(async (_taskId: any, fn: any) => fn()),
    };

    const options: any = {
      content: { outputLanguage: 'Korean', expertField: 'AI' },
      llm: { maxRetries: 3 },
    };

    const targetArticle: any = {
      title: 'Transformers in Production',
      detailContent: 'We deployed a transformer model for NLP tasks.',
    };

    const query = new ClassifyTags({
      model,
      logger,
      taskId: 'task-1',
      targetArticle,
      options,
      loggingExecutor,
    });

    const existTags = ['NLP', 'Machine Learning'];
    const expected = { tag1: 'NLP', tag2: 'Deployment', tag3: 'Transformers' };
    const stubUsage = { inputTokens: 5, outputTokens: 10, totalTokens: 15 };
    vi.mocked(generateText).mockResolvedValue({
      output: expected,
      usage: stubUsage,
    } as any);

    const result = await query.execute({ existTags });

    expect(result.result).toEqual(expected);
    expect(result.usage).toEqual(stubUsage);
    expect(generateText).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.model).toBe(model);
    expect(callArg.maxRetries).toBe(3);

    // Validate schema behavior
    expect(() =>
      callArg.output.schema.parse({ tag1: 'a', tag2: 'b', tag3: 'c' }),
    ).not.toThrow();
    expect(() =>
      callArg.output.schema.parse({ tag1: 'a', tag2: 'b' }),
    ).toThrow();

    // system prompt should include expert field and output language
    expect(callArg.instructions).toContain('AI');
    expect(callArg.instructions).toContain('Korean');

    // user prompt should include task, article information, and JSON of existing tags
    expect(callArg.prompt).toContain(
      '*Task**: Classify this article with 3 optimal detailed tags.',
    );
    expect(callArg.prompt).toContain('**Article Information**');
    expect(callArg.prompt).toContain(JSON.stringify(existTags, null, 2));
  });

  test('uses custom promptBuilder when provided', async () => {
    const model: any = { name: 'fake-model' };
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
      llm: { maxRetries: 3 },
    };
    const targetArticle: any = {
      title: 'Test Article',
      detailContent: 'Test content',
    };

    const customSystem = vi.fn().mockReturnValue('custom system prompt');
    const customUser = vi.fn().mockReturnValue('custom user prompt');

    const query = new ClassifyTags({
      model,
      logger,
      taskId: 'task-1',
      targetArticle,
      options,
      loggingExecutor,
      promptBuilder: { system: customSystem, user: customUser },
    });

    const stubUsage = { inputTokens: 5, outputTokens: 10, totalTokens: 15 };
    vi.mocked(generateText).mockResolvedValue({
      output: { tag1: 'a', tag2: 'b', tag3: 'c' },
      usage: stubUsage,
    } as any);

    await query.execute({ existTags: ['existing'] });

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.instructions).toBe('custom system prompt');
    expect(callArg.prompt).toBe('custom user prompt');

    expect(customSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        expertFields: ['AI'],
        outputLanguage: 'Korean',
        targetArticle,
        existTags: ['existing'],
      }),
    );
    expect(customUser).toHaveBeenCalledWith(
      expect.objectContaining({
        expertFields: ['AI'],
        outputLanguage: 'Korean',
        targetArticle,
        existTags: ['existing'],
      }),
    );
  });

  test('uses default prompt when only system promptBuilder is provided', async () => {
    const model: any = { name: 'fake-model' };
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
      llm: { maxRetries: 3 },
    };
    const targetArticle: any = {
      title: 'Test',
      detailContent: 'Content',
    };

    const customSystem = vi.fn().mockReturnValue('custom system only');

    const query = new ClassifyTags({
      model,
      logger,
      taskId: 'task-1',
      targetArticle,
      options,
      loggingExecutor,
      promptBuilder: { system: customSystem },
    });

    const stubUsage = { inputTokens: 5, outputTokens: 10, totalTokens: 15 };
    vi.mocked(generateText).mockResolvedValue({
      output: { tag1: 'a', tag2: 'b', tag3: 'c' },
      usage: stubUsage,
    } as any);

    await query.execute({ existTags: [] });

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.instructions).toBe('custom system only');
    expect(callArg.prompt).toContain('**Task**');
  });
});
