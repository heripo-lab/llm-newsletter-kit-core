import { LoggingExecutor } from './logging-executor';

afterEach(() => {
  vi.restoreAllMocks();
});

type Logger = {
  debug: (msg: unknown) => void;
  info: (msg: unknown) => void;
  error: (err: unknown) => void;
};

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe('LoggingExecutor.executeWithLogging', () => {
  test('logs start and done with default debug level, merges fields, and returns result', async () => {
    const logger = makeLogger();
    const executor = new LoggingExecutor(logger as any, 'task-1');

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000) // startedAt
      .mockReturnValueOnce(1_300); // when done

    const fn = vi.fn<() => Promise<string>>().mockResolvedValue('ok');

    const result = await executor.executeWithLogging(
      {
        event: 'crawl.group',
        startFields: { a: 1 },
        doneFields: (res) => ({ b: res.length }),
      },
      fn,
    );

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);

    expect(vi.mocked(logger.debug)).toHaveBeenCalledTimes(2);

    expect(vi.mocked(logger.debug).mock.calls[0][0]).toEqual({
      event: 'crawl.group.start',
      level: 'debug',
      taskId: 'task-1',
      data: { a: 1 },
    });

    expect(vi.mocked(logger.debug).mock.calls[1][0]).toEqual({
      event: 'crawl.group.done',
      level: 'debug',
      taskId: 'task-1',
      durationMs: 300,
      data: { a: 1, b: 2 },
    });
  });

  test('uses provided info level and handles missing doneFields with empty data', async () => {
    const logger = makeLogger();
    const executor = new LoggingExecutor(logger as any, 'task-2');

    vi.spyOn(Date, 'now').mockReturnValueOnce(2_000).mockReturnValueOnce(2_600);

    const fn = vi.fn<() => Promise<number>>().mockResolvedValue(42);

    const result = await executor.executeWithLogging(
      {
        event: 'job.run',
        level: 'info',
        // no startFields, no doneFields
      },
      fn,
    );

    expect(result).toBe(42);

    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);

    expect(vi.mocked(logger.info).mock.calls[0][0]).toEqual({
      event: 'job.run.start',
      level: 'info',
      taskId: 'task-2',
      data: {},
    });

    expect(vi.mocked(logger.info).mock.calls[1][0]).toEqual({
      event: 'job.run.done',
      level: 'info',
      taskId: 'task-2',
      durationMs: 600,
      data: {},
    });
  });

  test('handles doneFields present but returning void (nullish coalescing to {})', async () => {
    const logger = makeLogger();
    const executor = new LoggingExecutor(logger as any, 'task-void');

    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_050);

    const fn = vi.fn<() => Promise<string>>().mockResolvedValue('X');

    await executor.executeWithLogging(
      {
        event: 'void.case',
        startFields: { s: 1 },
        doneFields: () => undefined,
      },
      fn,
    );

    expect(vi.mocked(logger.debug).mock.calls[0][0]).toEqual({
      event: 'void.case.start',
      level: 'debug',
      taskId: 'task-void',
      data: { s: 1 },
    });

    expect(vi.mocked(logger.debug).mock.calls[1][0]).toEqual({
      event: 'void.case.done',
      level: 'debug',
      taskId: 'task-void',
      durationMs: 50,
      data: { s: 1 },
    });
  });

  test('on failure logs error event with duration, calls logger.error, and rethrows', async () => {
    const logger = makeLogger();
    const executor = new LoggingExecutor(logger as any, 'task-3');

    vi.spyOn(Date, 'now').mockReturnValueOnce(3_000).mockReturnValueOnce(3_700);

    const boom = new Error('boom');
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(boom);

    await expect(
      executor.executeWithLogging(
        {
          event: 'task.exec',
          startFields: { x: true },
          doneFields: vi.fn(), // must not be called on error path
        },
        fn,
      ),
    ).rejects.toThrow('boom');

    // start + error
    expect(vi.mocked(logger.debug)).toHaveBeenCalledTimes(2);

    expect(vi.mocked(logger.debug).mock.calls[0][0]).toEqual({
      event: 'task.exec.start',
      level: 'debug',
      taskId: 'task-3',
      data: { x: true },
    });

    expect(vi.mocked(logger.debug).mock.calls[1][0]).toEqual({
      event: 'task.exec.error',
      level: 'debug',
      taskId: 'task-3',
      durationMs: 700,
      data: { x: true },
    });

    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(boom);
  });

  test('error path with missing startFields uses empty data and respects info level', async () => {
    const logger = makeLogger();
    const executor = new LoggingExecutor(logger as any, 'task-4');

    vi.spyOn(Date, 'now').mockReturnValueOnce(5_000).mockReturnValueOnce(5_123);

    const err = new Error('fail');
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(err);

    await expect(
      executor.executeWithLogging(
        {
          event: 'other.exec',
          level: 'info',
        },
        fn,
      ),
    ).rejects.toThrow('fail');

    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);

    expect(vi.mocked(logger.info).mock.calls[0][0]).toEqual({
      event: 'other.exec.start',
      level: 'info',
      taskId: 'task-4',
      data: {},
    });

    expect(vi.mocked(logger.info).mock.calls[1][0]).toEqual({
      event: 'other.exec.error',
      level: 'info',
      taskId: 'task-4',
      durationMs: 123,
      data: {},
    });

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(err);
  });
});
