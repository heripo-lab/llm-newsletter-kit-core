// Bring mocks into scope for assertions/control
import * as Runnables from '@langchain/core/runnables';

import * as CrawlingChainMod from '~/generate-newsletter/chains/crawling.chain';
import * as LoggingExecutorMod from '~/logging/logging-executor';

import GenerateNewsletter from './generate-newsletter';

const {
  chainObj,
  __getCalls: __getCrawlingCalls,
  __resetCrawlingCalls,
} = CrawlingChainMod as any;
const { LoggingExecutor: LoggingExecutorClass, __resetLoggingExecutor } =
  LoggingExecutorMod as any;

const makeConfig = (overrides: Partial<any> = {}) => {
  const taskService = {
    start: vi.fn().mockResolvedValue('T1'),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const base = {
    contentOptions: {
      outputLanguage: 'English',
      expertField: ['AI', 'Cloud'],
    },
    taskService,
    dateService: {} as any,
    crawlingProvider: { name: 'crawly' } as any,
    analysisProvider: {} as any,
    contentGenerateProvider: {} as any,
    options: overrides.options ?? overrides,
  };
  return { ...base, ...overrides, taskService } as any;
};

beforeEach(() => {
  __resetLoggingExecutor();
  __resetCrawlingCalls();
  (Runnables as any).__resetRunnables();
  (Runnables as any).__setSequenceInvoke(async () => 'SEQUENCE_RESULT');
});

describe('GenerateNewsletter', () => {
  test('generate() builds sequence, uses default logger, merges options, and returns sequence result', async () => {
    const config = makeConfig({
      options: {
        llm: { maxRetries: 7 },
        chain: { stopAfterAttempt: 2 },
        // no logger to trigger default logger branch
      },
    });

    const sut = new (GenerateNewsletter as any)(config);

    const result = await sut.generate();

    // Task lifecycle
    expect(config.taskService.start).toHaveBeenCalledTimes(1);
    expect(config.taskService.end).toHaveBeenCalledTimes(1);

    // LoggingExecutor usage (outer + inner)
    expect(LoggingExecutorClass.instances.length).toBe(2);
    expect(LoggingExecutorClass.instances[0].taskId).toBe('T1');
    expect(LoggingExecutorClass.instances[1].taskId).toBe('T1');

    // CrawlingChain constructed with expected args
    expect(__getCrawlingCalls().length).toBe(1);
    const crawlingArgs = __getCrawlingCalls()[0][0];
    expect(crawlingArgs.taskId).toBe('T1');
    expect(crawlingArgs.provider).toBe(config.crawlingProvider);
    expect(crawlingArgs.loggingExecutor).toBe(
      LoggingExecutorClass.instances[1],
    );
    // default logger object shape
    expect(typeof crawlingArgs.logger).toBe('object');
    expect(typeof crawlingArgs.logger.info).toBe('function');
    expect(typeof crawlingArgs.logger.debug).toBe('function');
    expect(typeof crawlingArgs.logger.error).toBe('function');
    // invoke default logger no-op handlers to cover function declarations
    expect(() => crawlingArgs.logger.info('info')).not.toThrow();
    expect(() => crawlingArgs.logger.debug('debug')).not.toThrow();
    expect(() => crawlingArgs.logger.error('error')).not.toThrow();
    // merged options
    expect(crawlingArgs.options).toEqual({
      content: {
        outputLanguage: 'English',
        expertField: ['AI', 'Cloud'],
      },
      llm: { maxRetries: 7 },
      chain: { stopAfterAttempt: 2 },
    });

    // Runnable assembly
    const fromCalls = (Runnables as any).__getFromCalls();
    expect(fromCalls.length).toBe(1);
    const fromArgs = fromCalls[0];
    expect(Array.isArray(fromArgs)).toBe(true);
    expect(fromArgs.length).toBe(3);
    expect(fromArgs[0]).toBe(chainObj);
  });

  test('uses provided custom logger as-is', async () => {
    const customLogger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const config = makeConfig({ options: { logger: customLogger } });

    const sut = new (GenerateNewsletter as any)(config);
    await sut.generate();

    expect(__getCrawlingCalls().length).toBe(1);
    const crawlingArgs = __getCrawlingCalls()[0][0];
    expect(crawlingArgs.logger).toBe(customLogger);

    // LoggingExecutors also receive the same logger
    expect(LoggingExecutorClass.instances.length).toBe(2);
    expect(LoggingExecutorClass.instances[0].logger).toBe(customLogger);
    expect(LoggingExecutorClass.instances[1].logger).toBe(customLogger);
  });

  test('ensure endTask runs even when sequence throws', async () => {
    (Runnables as any).__setSequenceInvoke(async () => {
      throw new Error('sequence failed');
    });

    const config = makeConfig();
    const sut = new (GenerateNewsletter as any)(config);

    await expect(sut.generate()).rejects.toThrow('sequence failed');

    expect(config.taskService.start).toHaveBeenCalledTimes(1);
    expect(config.taskService.end).toHaveBeenCalledTimes(1);
  });

  test('logs result.created and sends preview when newsletter created', async () => {
    (Runnables as any).__setSequenceInvoke(async () => ({
      newsletterId: 'ID-123',
    }));

    const newsletter = {
      title: 'LLM Newsletter #42',
      htmlBody: '<h1>Hi</h1>',
      issueOrder: 42,
      date: '2025-10-01',
    };

    const emailService = { send: vi.fn().mockResolvedValue(undefined) };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const config = makeConfig({
      options: {
        logger,
        previewNewsletter: {
          fetchNewsletterForPreview: vi.fn().mockResolvedValue(newsletter),
          emailService,
          emailMessage: { from: 'bot@example.com', to: 'reviewer@example.com' },
        },
      },
    });

    const sut = new (GenerateNewsletter as any)(config);
    const ret = await sut.generate();

    expect(ret).toBe('ID-123');

    // email sent with composed fields
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith({
      from: 'bot@example.com',
      to: 'reviewer@example.com',
      subject: `[Preview] ${newsletter.title}`,
      html: newsletter.htmlBody,
      text: `${newsletter.title}\n\nIssue #${newsletter.issueOrder} - ${newsletter.date}`,
    });

    // logs include result.created and preview.sent
    const infoCalls = (logger.info as any).mock.calls.map((c: any[]) => c[0]);
    const events = infoCalls.map((m: any) => m.event);
    expect(events).toContain('generate.result.created');
    expect(events).toContain('generate.preview.sent');

    // preview.sent contains metadata
    const previewLog = infoCalls.find(
      (m: any) => m.event === 'generate.preview.sent',
    );
    expect(previewLog.data.newsletterId).toBe('ID-123');
    expect(previewLog.data.to).toBe('reviewer@example.com');

    // task lifecycle
    expect(config.taskService.start).toHaveBeenCalledTimes(1);
    expect(config.taskService.end).toHaveBeenCalledTimes(1);
  });

  test('logs result.skipped and skips preview when no newsletter created', async () => {
    (Runnables as any).__setSequenceInvoke(async () => ({
      newsletterId: null,
    }));

    const emailService = { send: vi.fn() };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const config = makeConfig({
      options: {
        logger,
        previewNewsletter: {
          fetchNewsletterForPreview: vi.fn(),
          emailService,
          emailMessage: { from: 'bot@example.com', to: 'reviewer@example.com' },
        },
      },
    });

    const sut = new (GenerateNewsletter as any)(config);
    const ret = await sut.generate();
    expect(ret).toBeNull();

    expect(emailService.send).not.toHaveBeenCalled();

    const infoCalls = (logger.info as any).mock.calls.map((c: any[]) => c[0]);
    expect(
      infoCalls.some((m: any) => m.event === 'generate.result.skipped'),
    ).toBe(true);
    const previewSkip = infoCalls.find(
      (m: any) => m.event === 'generate.preview.skip',
    );
    expect(previewSkip.data.reason).toBe('noNewsletterCreated');
  });

  test('logs preview.error and raw error when email sending fails', async () => {
    (Runnables as any).__setSequenceInvoke(async () => ({
      newsletterId: 'ID-ERR',
    }));

    const newsletter = {
      title: 'Issue Err',
      htmlBody: '<p>Err</p>',
      issueOrder: 9,
      date: '2025-11-01',
    };

    const sendErr = new Error('smtp down');
    const emailService = { send: vi.fn().mockRejectedValue(sendErr) };
    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const config = makeConfig({
      options: {
        logger,
        previewNewsletter: {
          fetchNewsletterForPreview: vi.fn().mockResolvedValue(newsletter),
          emailService,
          emailMessage: { from: 'bot@example.com', to: 'ops@example.com' },
        },
      },
    });

    const sut = new (GenerateNewsletter as any)(config);
    const ret = await sut.generate();
    expect(ret).toBe('ID-ERR');

    expect(emailService.send).toHaveBeenCalledTimes(1);

    const errorCalls = (logger.error as any).mock.calls.map((c: any[]) => c[0]);
    const hasStructured = errorCalls.some(
      (m: any) => m && m.event === 'generate.preview.error',
    );
    const hasRaw = errorCalls.some(
      (m: any) => m instanceof Error || (m && m.message === 'smtp down'),
    );
    expect(hasStructured).toBe(true);
    expect(hasRaw).toBe(true);
  });

  test('does not attempt preview when not configured', async () => {
    (Runnables as any).__setSequenceInvoke(async () => ({
      newsletterId: 'ID-NO-PREVIEW',
    }));

    const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const config = makeConfig({ options: { logger } });
    const sut = new (GenerateNewsletter as any)(config);
    const ret = await sut.generate();
    expect(ret).toBe('ID-NO-PREVIEW');

    const infoCalls = (logger.info as any).mock.calls.map((c: any[]) => c[0]);
    const events = infoCalls.map((m: any) => m.event);
    expect(events).toContain('generate.result.created');
    expect(events).not.toContain('generate.preview.sent');

    expect(
      (logger.debug as any).mock.calls
        .map((c: any[]) => c[0])
        .some((m: any) => m.event && m.event.startsWith('generate.preview')),
    ).toBe(false);
  });
});
