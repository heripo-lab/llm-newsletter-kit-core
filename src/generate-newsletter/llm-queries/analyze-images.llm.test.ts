import { generateText } from 'ai';

import AnalyzeImages from './analyze-images.llm';

describe('AnalyzeImages', () => {
  const buildQuery = (overrides: Partial<any> = {}) => {
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
      title: 'Vision Models in the Wild',
      detailContent: 'no images',
      hasAttachedImage: true,
    };

    return new AnalyzeImages({
      model,
      logger,
      taskId: 'task-1',
      loggingExecutor,
      ...overrides,
      // allow overriding nested targetArticle/options too
      targetArticle: { ...targetArticle, ...(overrides as any).targetArticle },
      options: { ...options, ...(overrides as any).options },
    });
  };

  test('returns null when article has no attached image', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: '![alt](http://img)',
        hasAttachedImage: false,
      },
    });

    const result = await query.execute();

    expect(result).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('returns null when article has no detail content', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: '',
        hasAttachedImage: true,
      },
    });

    const result = await query.execute();

    expect(result).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('returns null when there are no image urls in content', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: 'This article has text but no images.',
        hasAttachedImage: true,
      },
    });

    const result = await query.execute();

    expect(result).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('calls generateText with correct params and returns imageContext', async () => {
    const detailContent = [
      'Some intro text.',
      '![a](http://a.com/img.png)',
      '![b](https://b.com/i.jpg)',
      '![c](//c.cdn.com/p.webp)',
      '![d](/images/d.png)',
      '![e](./rel/e.jpg)',
      '![f](../parent/f.png)',
      '![g](data:image/png;base64,xyz)',
    ].join('\n');

    const query = buildQuery({
      targetArticle: {
        title: 'Vision Models in the Wild',
        detailContent,
        hasAttachedImage: true,
      },
    });

    const expectedContext = 'Comprehensive image-based insights.';
    vi.mocked(generateText).mockResolvedValue({
      output: { imageContext: expectedContext },
    } as any);

    const result = await query.execute();

    expect(result).toBe(expectedContext);
    expect(generateText).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.model).toBe((query as any).model);
    expect(callArg.maxRetries).toBe(3);

    // schema: requires { imageContext: string }
    expect(() =>
      callArg.output.schema.parse({ imageContext: 'ok' }),
    ).not.toThrow();
    expect(() => callArg.output.schema.parse({})).toThrow();

    // system prompt should include expert field and output language
    expect(callArg.system).toContain('AI');
    expect(callArg.system).toContain('Korean');

    // messages: one user message with text + first 5 images only
    expect(callArg.messages).toHaveLength(1);
    const userMsg = callArg.messages[0];
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content).toHaveLength(6); // 1 text + 5 images

    const [textPart, ...imageParts] = userMsg.content;
    expect(textPart.type).toBe('text');
    expect(textPart.text).toContain('Vision Models in the Wild');
    expect(textPart.text).toContain('Some intro text.');
    expect(textPart.text).toContain('AI');

    // Only first five image urls are included, in order
    const urls = imageParts.map((p: any) => p.image);
    expect(urls).toEqual([
      'http://a.com/img.png',
      'https://b.com/i.jpg',
      '//c.cdn.com/p.webp',
      '/images/d.png',
      './rel/e.jpg',
    ]);
  });
});
