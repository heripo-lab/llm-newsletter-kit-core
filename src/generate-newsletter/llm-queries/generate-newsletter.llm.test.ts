import { generateText } from 'ai';

import GenerateNewsletter from './generate-newsletter.llm';

const longTitle = 'This is a sufficiently long newsletter title for testing';

function buildArticles() {
  return [
    {
      title: 'Post A',
      detailContent: 'Detail A',
      importanceScore: 8,
      tag1: 'AI',
      tag2: 'Policy',
      tag3: undefined,
      contentType: 'news',
      url: 'https://a.example',
      imageContextByLlm: 'An image description',
    },
    {
      title: 'Post B',
      detailContent: 'Detail B',
      importanceScore: 5,
      tag1: 'Cloud',
      tag2: undefined,
      tag3: 'Event',
      contentType: 'notice',
      url: 'https://b.example',
    },
  ] as any[];
}

function buildConfig(overrides: Partial<Record<string, any>> = {}) {
  const dateService = {
    getDisplayDateString: vi.fn().mockReturnValue('June 1-2, 2025'),
  };

  const base = {
    model: { name: 'stub-model' } as any,
    logger: {} as any,
    taskId: 'task-1',
    options: {
      content: { outputLanguage: 'English', expertField: ['AI', 'Robotics'] },
      llm: { maxRetries: 3 },
    },
    loggingExecutor: { executeWithLogging: vi.fn() } as any,
    maxOutputTokens: undefined,
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    presencePenalty: undefined,
    frequencyPenalty: undefined,
    targetArticles: buildArticles(),
    dateService,
    subscribePageUrl: 'https://example.com/subscribe',
    newsletterBrandName: 'TechPulse',
  };

  return { ...base, ...overrides } as any;
}

const stubUsage = {
  inputTokens: 10,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokens: 20,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: 30,
};

function mockObjectOnce(obj: any) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: obj,
    usage: stubUsage,
  } as any);
}

describe('GenerateNewsletter.execute', () => {
  test('calls LLM with correct prompts and options (defaults) and returns only title/content', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Body markdown',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
      extra: 'should be stripped',
    });

    const cfg = buildConfig();
    const instance = new (GenerateNewsletter as any)(cfg);

    const result = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;

    // core options
    expect(callArg.model).toBe(cfg.model);
    expect(callArg.maxRetries).toBe(3);
    expect(callArg.maxOutputTokens).toBeUndefined();
    expect(callArg.temperature).toBe(0.3); // default
    expect(callArg.topP).toBeUndefined();
    expect(callArg.topK).toBeUndefined();
    expect(callArg.presencePenalty).toBeUndefined();
    expect(callArg.frequencyPenalty).toBeUndefined();

    // system prompt validations
    expect(typeof callArg.system).toBe('string');
    expect(callArg.system).toContain('TechPulse');
    expect(callArg.system).toContain('AI, Robotics');
    expect(callArg.system).toContain('hyphen (-) instead of a tilde (~)');
    expect(callArg.system).toContain('June 1-2, 2025');
    expect(callArg.system).toContain('Subscribe to TechPulse');
    expect(callArg.system).toContain('https://example.com/subscribe');

    // user prompt validations
    expect(typeof callArg.prompt).toBe('string');
    expect(callArg.prompt).toContain('## Post 1');
    expect(callArg.prompt).toContain('## Post 2');
    expect(callArg.prompt).toContain('**Title:** Post A');
    expect(callArg.prompt).toContain('**Title:** Post B');
    expect(callArg.prompt).toContain('**Tags:** AI, Policy');
    expect(callArg.prompt).toContain('**Tags:** Cloud, Event');
    // Image Analysis appears only for the first post
    const imageAnalysisMatches =
      callArg.prompt.match(/\*\*Image Analysis:\*\*/g) ?? [];
    expect(imageAnalysisMatches.length).toBe(1);

    // schema: should parse returned shape
    expect(() =>
      callArg.output.schema.parse({
        title: longTitle,
        content: 'content',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      }),
    ).not.toThrow();

    // result should only include title and content (picked), with usage
    expect(result.result).toEqual({
      title: longTitle,
      content: 'Body markdown',
    });
    expect((result.result as any).extra).toBeUndefined();
    expect(result.usage).toEqual(stubUsage);
  });

  test('retries when isWrittenInOutputLanguage is false on first attempt', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Bad language',
      isWrittenInOutputLanguage: false,
      copyrightVerified: true,
      factAccuracy: true,
    });
    mockObjectOnce({
      title: longTitle,
      content: 'Good content',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Good content' });
  });

  test('retries when copyrightVerified is false on first attempt', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Bad copyright',
      isWrittenInOutputLanguage: true,
      copyrightVerified: false,
      factAccuracy: true,
    });
    mockObjectOnce({
      title: longTitle,
      content: 'Good content 2',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Good content 2' });
  });

  test('retries when factAccuracy is false on first attempt', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Inaccurate',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: false,
    });
    mockObjectOnce({
      title: longTitle,
      content: 'Accurate',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Accurate' });
  });

  test('freeFormIntro=true removes intro from Start, adds Brief Introduction to Briefing, removes heading directive', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Free form content',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(
      buildConfig({
        options: {
          content: {
            outputLanguage: 'English',
            expertField: ['AI', 'Robotics'],
            freeFormIntro: true,
          },
          llm: { maxRetries: 3 },
        },
      }),
    );

    await instance.execute();

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;

    // Start section should NOT contain the brief intro text
    expect(callArg.system).toContain('begin with neutral, objective greeting.');
    expect(callArg.system).not.toContain(
      "begin with neutral, objective greeting. Briefly introduce key factual information to be covered in today's newsletter.",
    );

    // Briefing section should contain Brief Introduction sub-bullet
    expect(callArg.system).toContain(
      "- Brief Introduction: Briefly introduce key factual information to be covered in today's newsletter.",
    );

    // Additional Requirements should NOT contain the fixed heading directive
    expect(callArg.system).not.toContain(
      'Declare this part as `Heading 1`(#).',
    );
  });

  test('titleContext is included in Title Writing Guidelines when provided', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'Title context content',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(
      buildConfig({
        options: {
          content: {
            outputLanguage: 'English',
            expertField: ['AI', 'Robotics'],
            titleContext: 'Weekly AI Research Digest',
          },
          llm: { maxRetries: 3 },
        },
      }),
    );

    await instance.execute();

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;

    expect(callArg.system).toContain(
      '**Top priority context for title**: "Weekly AI Research Digest"',
    );
    expect(callArg.system).toContain(
      'Use this as the primary reference when crafting the title',
    );
  });

  test('uses provided sampling/penalty options and omits subscribe link when not given', async () => {
    mockObjectOnce({
      title: longTitle,
      content: 'X',
      isWrittenInOutputLanguage: true,
      copyrightVerified: true,
      factAccuracy: true,
    });

    const instance = new (GenerateNewsletter as any)(
      buildConfig({
        temperature: 0.9,
        topP: 0.8,
        topK: 40,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        subscribePageUrl: undefined,
      }),
    );

    await instance.execute();

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;
    expect(callArg.temperature).toBe(0.9);
    expect(callArg.topP).toBe(0.8);
    expect(callArg.topK).toBe(40);
    expect(callArg.presencePenalty).toBe(0.1);
    expect(callArg.frequencyPenalty).toBe(0.2);
    expect(callArg.system).not.toContain('Subscribe to');
  });
});
