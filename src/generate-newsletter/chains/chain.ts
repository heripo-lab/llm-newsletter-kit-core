import type { RunnablePassthrough } from '@langchain/core/runnables';

import type { CommonProcessingOptions } from '../models/options';

import {
  type RunnableAssign,
  type RunnableRetry,
} from '@langchain/core/runnables';

import type { LoggingExecutor } from '~/logging/logging-executor';
import type { AppLogger } from '~/models/interfaces';

export type ChainConfig<TaskId, Provider> = {
  logger: AppLogger;
  taskId: TaskId;
  provider: Provider;
  options: CommonProcessingOptions;
  loggingExecutor: LoggingExecutor<TaskId>;
};

class BaseChain<TaskId, Provider> {
  protected readonly logger: AppLogger;
  protected readonly taskId: TaskId;
  protected readonly provider: Provider;
  protected readonly options: CommonProcessingOptions;
  protected readonly executeWithLogging: LoggingExecutor<TaskId>['executeWithLogging'];

  protected constructor(config: ChainConfig<TaskId, Provider>) {
    this.logger = config.logger;
    this.taskId = config.taskId;
    this.provider = config.provider;
    this.options = config.options;
    this.executeWithLogging = config.loggingExecutor.executeWithLogging.bind(
      config.loggingExecutor,
    );
  }
}

export abstract class Chain<TaskId, Provider> extends BaseChain<
  TaskId,
  Provider
> {
  abstract get chain(): RunnableAssign | RunnableRetry | RunnablePassthrough;
}

export abstract class PrivateChain<TaskId, Provider> extends BaseChain<
  TaskId,
  Provider
> {
  protected abstract get chain():
    RunnableAssign | RunnableRetry | RunnablePassthrough;
}
