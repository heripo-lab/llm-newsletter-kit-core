import { generateText } from 'ai';

import { loadImageAttachments } from '../utils/image-attachments';
import AnalyzeImages from './analyze-images.llm';

vi.mock('../utils/image-attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/image-attachments')>()),
  loadImageAttachments: vi.fn(),
}));

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

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
      targetUrl: 'https://board.example.com/notice/list',
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

  test('returns null with zero usage when article has no attached image', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: '![alt](http://img)',
        hasAttachedImage: false,
      },
    });

    const result = await query.execute();

    expect(result.result).toBeNull();
    expect(result.usage.totalTokens).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('returns null with zero usage when article has no detail content', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: '',
        hasAttachedImage: true,
      },
    });

    const result = await query.execute();

    expect(result.result).toBeNull();
    expect(result.usage.totalTokens).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('returns null with zero usage when there are no image urls in content', async () => {
    const query = buildQuery({
      targetArticle: {
        title: 't',
        detailContent: 'This article has text but no images.',
        hasAttachedImage: true,
      },
    });

    const result = await query.execute();

    expect(result.result).toBeNull();
    expect(result.usage.totalTokens).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('returns null without an LLM request when no image can be loaded', async () => {
    vi.mocked(loadImageAttachments).mockResolvedValue([]);
    const query = buildQuery({
      targetArticle: { detailContent: '![a](https://a.com/x.png)' },
    });

    const result = await query.execute();

    expect(result.result).toBeNull();
    expect(result.usage.totalTokens).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
  });

  test('sends downloaded image bytes and returns imageContext', async () => {
    const detailContent = [
      'Some intro text.',
      '![a](http://a.com/img.png "title")',
      '![b](/images/b.jpg)',
    ].join('\n');
    const customFetch = vi.fn();
    vi.mocked(loadImageAttachments).mockResolvedValue([
      { data: png, mediaType: 'image/png' },
      { data: jpeg, mediaType: 'image/jpeg' },
    ]);

    const query = buildQuery({
      targetArticle: {
        title: 'Vision Models in the Wild',
        detailContent,
        hasAttachedImage: true,
      },
      customFetch,
    });

    const expectedContext = 'Comprehensive image-based insights.';
    const stubUsage = { inputTokens: 50, outputTokens: 30, totalTokens: 80 };
    vi.mocked(generateText).mockResolvedValue({
      output: { imageContext: expectedContext },
      usage: stubUsage,
    } as any);

    const result = await query.execute();

    expect(result.result).toBe(expectedContext);
    expect(result.usage).toEqual(stubUsage);

    // References are resolved against the board URL with the host's fetch
    expect(loadImageAttachments).toHaveBeenCalledWith({
      references: ['http://a.com/img.png "title"', '/images/b.jpg'],
      baseUrl: 'https://board.example.com/notice/list',
      customFetch,
      logger: (query as any).logger,
    });

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
    expect(callArg.instructions).toContain('AI');
    expect(callArg.instructions).toContain('Korean');

    expect(callArg.messages).toHaveLength(1);
    const [textPart, ...imageParts] = callArg.messages[0].content;
    expect(callArg.messages[0].role).toBe('user');
    expect(textPart.type).toBe('text');
    expect(textPart.text).toContain('Vision Models in the Wild');
    expect(textPart.text).toContain('Some intro text.');
    expect(imageParts).toEqual([
      { type: 'file', mediaType: 'image/png', data: png },
      { type: 'file', mediaType: 'image/jpeg', data: jpeg },
    ]);
  });

  test('uses custom promptBuilder for system and user prompts', async () => {
    const detailContent = '![a](https://img.com/a.png)\nSome text';
    const customSystem = vi.fn().mockReturnValue('custom system');
    const customUser = vi.fn().mockReturnValue('custom user text');

    const query = buildQuery({
      targetArticle: {
        title: 'Custom prompt test',
        detailContent,
        hasAttachedImage: true,
      },
      promptBuilder: { system: customSystem, user: customUser },
    });
    vi.mocked(loadImageAttachments).mockResolvedValue([
      { data: png, mediaType: 'image/png' },
    ]);

    const stubUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    vi.mocked(generateText).mockResolvedValue({
      output: { imageContext: 'result' },
      usage: stubUsage,
    } as any);

    await query.execute();

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.instructions).toBe('custom system');

    const textPart = callArg.messages[0].content[0];
    expect(textPart.text).toBe('custom user text');

    expect(customSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        expertFields: ['AI'],
        outputLanguage: 'Korean',
      }),
    );
    expect(customUser).toHaveBeenCalledWith(
      expect.objectContaining({
        expertFields: ['AI'],
        outputLanguage: 'Korean',
      }),
    );
  });
});
