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

function buildUsage(overrides: Partial<Record<string, any>> = {}) {
  return {
    inputTokens: 10,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 20,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: 30,
    ...overrides,
  };
}

const stubUsage = buildUsage();

function mockObjectOnce(obj: any, usage = stubUsage) {
  vi.mocked(generateText).mockResolvedValueOnce({
    output: obj,
    usage,
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

  test('retries when isWrittenInOutputLanguage is false and aggregates usage', async () => {
    const usage1 = buildUsage({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputTokenDetails: {
        noCacheTokens: 5,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: 18, reasoningTokens: undefined },
    });
    const usage2 = buildUsage({
      inputTokens: 15,
      outputTokens: 25,
      totalTokens: 40,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: 3,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: 2 },
    });
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Bad language',
        isWrittenInOutputLanguage: false,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage1,
    );
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Good content',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage2,
    );

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Good content' });
    expect(res.usage.inputTokens).toBe(25);
    expect(res.usage.outputTokens).toBe(45);
    expect(res.usage.totalTokens).toBe(70);
    expect(res.usage.inputTokenDetails.noCacheTokens).toBe(5);
    expect(res.usage.inputTokenDetails.cacheReadTokens).toBe(3);
    expect(res.usage.inputTokenDetails.cacheWriteTokens).toBeUndefined();
    expect(res.usage.outputTokenDetails.textTokens).toBe(18);
    expect(res.usage.outputTokenDetails.reasoningTokens).toBe(2);
  });

  test('retries when copyrightVerified is false and aggregates usage', async () => {
    const usage1 = buildUsage({
      inputTokens: 5,
      outputTokens: 10,
      totalTokens: 15,
    });
    const usage2 = buildUsage({
      inputTokens: 5,
      outputTokens: 10,
      totalTokens: 15,
    });
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Bad copyright',
        isWrittenInOutputLanguage: true,
        copyrightVerified: false,
        factAccuracy: true,
      },
      usage1,
    );
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Good content 2',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage2,
    );

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Good content 2' });
    expect(res.usage.inputTokens).toBe(10);
    expect(res.usage.outputTokens).toBe(20);
    expect(res.usage.totalTokens).toBe(30);
  });

  test('retries when factAccuracy is false and aggregates usage', async () => {
    const usage1 = buildUsage({
      inputTokens: 8,
      outputTokens: 12,
      totalTokens: 20,
    });
    const usage2 = buildUsage({
      inputTokens: 8,
      outputTokens: 12,
      totalTokens: 20,
    });
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Inaccurate',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: false,
      },
      usage1,
    );
    mockObjectOnce(
      {
        title: longTitle,
        content: 'Accurate',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage2,
    );

    const instance = new (GenerateNewsletter as any)(buildConfig());
    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result).toEqual({ title: longTitle, content: 'Accurate' });
    expect(res.usage.inputTokens).toBe(16);
    expect(res.usage.outputTokens).toBe(24);
    expect(res.usage.totalTokens).toBe(40);
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

    // Start section should skip opening entirely when freeFormIntro=true
    expect(callArg.system).toContain(
      'Begin directly with the Overall Briefing section (no separate opening heading or greeting).',
    );
    expect(callArg.system).not.toContain('Specify date');
    expect(callArg.system).not.toContain(
      'begin with neutral, objective greeting',
    );

    // Briefing section should use Heading 2 with date + briefing word, no domain
    expect(callArg.system).toContain('Heading 2 (##)');
    expect(callArg.system).toContain(
      'do NOT include domain or field names in the heading',
    );
    expect(callArg.system).toContain(
      'Immediately follow with a brief paragraph introducing key factual information',
    );
    expect(callArg.system).toContain(
      'then include the following bullet points:',
    );
    expect(callArg.system).not.toContain('- Brief Introduction:');

    // Category headings should also use Heading 2
    expect(callArg.system).toContain(
      'Use Heading 2 (##) for each category heading',
    );

    // Additional Requirements should NOT contain the fixed heading directive
    expect(callArg.system).not.toContain(
      'Declare this part as `Heading 1`(#).',
    );
  });

  test('titleContext is included in Title Writing Guidelines when provided', async () => {
    const titleWithContext =
      'Weekly AI Research Digest: Latest Trends and Insights';
    mockObjectOnce({
      title: titleWithContext,
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

    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(res.result.title).toBe(titleWithContext);

    const callArg = vi.mocked(generateText).mock.calls[0][0] as any;

    expect(callArg.system).toContain(
      '**Required title keyword**: "Weekly AI Research Digest"',
    );
    expect(callArg.system).toContain('This phrase MUST appear in the title');
    expect(callArg.system).toContain(
      "Combine it with key context from today's newsletter content",
    );
    // When titleContext is provided, should NOT contain the default title guideline
    expect(callArg.system).not.toContain(
      'Title should objectively convey core facts of 1-2 most important news items today',
    );
  });

  test('retries when title does not contain titleContext and aggregates usage', async () => {
    const usage1 = buildUsage({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
    const usage2 = buildUsage({
      inputTokens: 12,
      outputTokens: 22,
      totalTokens: 34,
    });
    mockObjectOnce(
      {
        title: 'Unrelated title that is long enough for validation',
        content: 'Content',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage1,
    );
    mockObjectOnce(
      {
        title: 'Weekly AI Research Digest: Key Developments',
        content: 'Content',
        isWrittenInOutputLanguage: true,
        copyrightVerified: true,
        factAccuracy: true,
      },
      usage2,
    );

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

    const res = await instance.execute();

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(res.result.title).toBe(
      'Weekly AI Research Digest: Key Developments',
    );
    expect(res.usage.inputTokens).toBe(22);
    expect(res.usage.outputTokens).toBe(42);
    expect(res.usage.totalTokens).toBe(64);
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
