import type { LanguageModel, LanguageModelUsage } from 'ai';

import type { UnscoredArticle } from '../models/article';
import type { CommonProcessingOptions } from '../models/options';

import type { LoggingExecutor } from '~/logging/logging-executor';
import type { AppLogger } from '~/models/interfaces';
import { ensureStringArray } from '~/utils/string';

type Options = Pick<CommonProcessingOptions, 'content' | 'llm'>;

export type LLMQueryExecuteResult<T> = {
  result: T;
  usage: LanguageModelUsage;
};

export type BaseLLMQueryConfig<TaskId> = {
  model: LanguageModel;
  logger: AppLogger;
  taskId: TaskId;
  options: Options;
  loggingExecutor: LoggingExecutor<TaskId>;
};

export type LLMQueryConfig<
  TaskId,
  TargetArticle extends UnscoredArticle = UnscoredArticle,
> = BaseLLMQueryConfig<TaskId> & {
  targetArticle: TargetArticle;
};

export abstract class BaseLLMQuery<
  TaskId,
  Params extends { [key: string]: unknown } | undefined,
  ReturnType,
> {
  protected readonly model: LanguageModel;
  protected readonly expertFields: string[];
  protected readonly logger: AppLogger;
  protected readonly taskId: TaskId;
  protected readonly options: Options;
  protected readonly executeWithLogging: LoggingExecutor<TaskId>['executeWithLogging'];

  protected constructor(config: BaseLLMQueryConfig<TaskId>) {
    this.model = config.model;
    this.expertFields = ensureStringArray(config.options.content.expertField);
    this.logger = config.logger;
    this.taskId = config.taskId;
    this.options = config.options;
    this.executeWithLogging = config.loggingExecutor.executeWithLogging.bind(
      config.loggingExecutor,
    );
  }

  abstract execute(params: Params): Promise<LLMQueryExecuteResult<ReturnType>>;
}

export abstract class LLMQuery<
  TaskId,
  TargetArticle extends UnscoredArticle,
  Params extends { [key: string]: unknown } | undefined,
  ReturnType,
> extends BaseLLMQuery<TaskId, Params, ReturnType> {
  protected readonly targetArticle: TargetArticle;

  protected constructor(config: LLMQueryConfig<TaskId, TargetArticle>) {
    super(config);

    this.targetArticle = config.targetArticle;
  }
}
