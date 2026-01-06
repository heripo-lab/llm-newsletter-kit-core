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
    vi.mocked(generateText).mockResolvedValue({ output: expected } as any);

    const result = await query.execute({ existTags });

    expect(result).toEqual(expected);
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
    expect(callArg.system).toContain('AI');
    expect(callArg.system).toContain('Korean');

    // user prompt should include task, article information, and JSON of existing tags
    expect(callArg.prompt).toContain(
      '*Task**: Classify this article with 3 optimal detailed tags.',
    );
    expect(callArg.prompt).toContain('**Article Information**');
    expect(callArg.prompt).toContain(JSON.stringify(existTags, null, 2));
  });
});
