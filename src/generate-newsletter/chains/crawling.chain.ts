import type {
  CrawlingTarget,
  CrawlingTargetGroup,
  ParsedTarget,
  ParsedTargetDetail,
  ParsedTargetListItem,
} from '../models/crawling';
import type { CrawlingProvider } from '../models/interfaces';

import { RunnablePassthrough } from '@langchain/core/runnables';
import { omit } from 'es-toolkit';
import { randomUUID } from 'node:crypto';

import { getHtmlFromUrl } from '../utils/get-html-from-url';
import { Chain, type ChainConfig } from './chain';

type ParsedTargetListItemWithPipelineId = ParsedTargetListItem & {
  pipelineId: string;
};

type ParsedTargetDetailWithPipelineId = ParsedTargetDetail & {
  pipelineId: string;
};

type HtmlWithPipelineId = {
  html: string;
  pipelineId: string;
};

type DetailFetchResult = {
  list: ParsedTargetListItemWithPipelineId[];
  detailPagesHtmlWithPipelineId: HtmlWithPipelineId[];
  failedCount: number;
};

type DetailParseResult = {
  list: ParsedTargetListItemWithPipelineId[];
  parsedDetails: ParsedTargetDetailWithPipelineId[];
  failedCount: number;
};

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default class CrawlingChain<TaskId> extends Chain<
  TaskId,
  CrawlingProvider
> {
  constructor(config: ChainConfig<TaskId, CrawlingProvider>) {
    const provider = config.provider;
    provider.maxConcurrency ??= 5;

    super({ ...config, provider });
  }

  public get chain() {
    const mapping = this.provider.crawlingTargetGroups.reduce<{
      [key: string]: () => Promise<number>;
    }>((result, group) => {
      return {
        ...result,
        [group.name]: () => this.executeGroupPipeline(group),
      };
    }, {});

    return RunnablePassthrough.assign(mapping);
  }

  private async executeGroupPipeline(group: CrawlingTargetGroup) {
    const groupLabel = group.name;

    const chain = RunnablePassthrough.assign({
      listPageHtml: ({ target }: { target: CrawlingTarget }) =>
        this.fetchListPageHtml(target),
    })
      .pipe({
        parsedList: ({ target, listPageHtml }) =>
          this.parseListPageHtml(target, listPageHtml),
        target: ({ target }) => target,
      })
      .pipe({
        list: ({ target, parsedList }) =>
          this.dedupeListItems(target, parsedList),
        target: ({ target }) => target,
      })
      .pipe({
        detailFetchResult: ({ target, list }) =>
          this.fetchDetailPagesHtml(target, list),
        target: ({ target }) => target,
      })
      .pipe({
        detailParseResult: ({ target, detailFetchResult }) =>
          this.parseDetailPagesHtml(
            target,
            detailFetchResult.list,
            detailFetchResult.detailPagesHtmlWithPipelineId,
          ),
        target: ({ target }) => target,
      })
      .pipe({
        processedArticles: ({ target, detailParseResult }) =>
          this.mergeParsedArticles(
            target,
            detailParseResult.list,
            detailParseResult.parsedDetails,
          ),
        target: ({ target }) => target,
      })
      .pipe({
        count: ({ target, processedArticles }) =>
          this.saveArticles(group, target, processedArticles),
      })
      .withRetry({ stopAfterAttempt: this.options.chain.stopAfterAttempt });

    return this.executeWithLogging(
      {
        event: 'crawl.group',
        level: 'debug',
        startFields: {
          group: groupLabel,
          targets: group.targets.length,
        },
        doneFields: (total) => ({ totalSaved: total }),
      },
      async () => {
        const results = await chain.batch(
          group.targets.map((target) => ({ target })),
          {
            maxConcurrency: this.provider.maxConcurrency,
          },
        );

        return results.reduce((sum, result) => sum + result.count, 0);
      },
    );
  }

  private async fetchListPageHtml(target: CrawlingTarget): Promise<string> {
    return this.executeWithLogging(
      {
        event: 'crawl.list.fetch',
        level: 'debug',
        startFields: { target: this.describeTarget(target) },
      },
      async () => {
        try {
          return await getHtmlFromUrl(
            this.logger,
            target.url,
            undefined,
            this.provider.customFetch,
          );
        } catch (error) {
          this.logger.error({
            event: 'crawl.list.fetch.failed',
            taskId: this.taskId,
            data: {
              target: this.describeTarget(target),
              url: target.url,
              error: toErrorMessage(error),
            },
          });
          return '';
        }
      },
    );
  }

  private async parseListPageHtml(
    target: CrawlingTarget,
    listPageHtml: string,
  ): Promise<ParsedTargetListItemWithPipelineId[]> {
    return this.executeWithLogging(
      {
        event: 'crawl.list.parse',
        level: 'debug',
        startFields: {
          target: this.describeTarget(target),
          htmlLength: listPageHtml.length,
        },
        doneFields: (items) => ({ count: items.length }),
      },
      async () => {
        if (listPageHtml.length === 0) {
          return [];
        }

        try {
          return (await target.parseList(listPageHtml)).map((item) => ({
            ...item,
            pipelineId: randomUUID(),
          }));
        } catch (error) {
          this.logger.error({
            event: 'crawl.list.parse.failed',
            taskId: this.taskId,
            data: {
              target: this.describeTarget(target),
              error: toErrorMessage(error),
            },
          });
          return [];
        }
      },
    );
  }

  private async dedupeListItems(
    target: CrawlingTarget,
    parsedList: ParsedTargetListItemWithPipelineId[],
  ): Promise<ParsedTargetListItemWithPipelineId[]> {
    return this.executeWithLogging(
      {
        event: 'crawl.list.dedupe',
        level: 'debug',
        startFields: {
          target: this.describeTarget(target),
          inCount: parsedList.length,
        },
        doneFields: (deduped) => ({
          outCount: deduped.length,
          filtered: parsedList.length - deduped.length,
        }),
      },
      async () => {
        const existingArticles =
          await this.provider.fetchExistingArticlesByUrls(
            parsedList.map(({ detailUrl }) => detailUrl),
          );

        const existingUrlSet = new Set(
          existingArticles.map(({ detailUrl }) => detailUrl),
        );

        return parsedList.filter((item) => !existingUrlSet.has(item.detailUrl));
      },
    );
  }

  private async fetchDetailPagesHtml(
    target: CrawlingTarget,
    list: ParsedTargetListItemWithPipelineId[],
  ): Promise<DetailFetchResult> {
    return this.executeWithLogging(
      {
        event: 'crawl.detail.fetch',
        level: 'debug',
        startFields: {
          target: this.describeTarget(target),
          count: list.length,
        },
        doneFields: (result) => ({
          successCount: result.detailPagesHtmlWithPipelineId.length,
          failedCount: result.failedCount,
        }),
      },
      async () => {
        const settled = await Promise.allSettled(
          list.map((data) =>
            getHtmlFromUrl(
              this.logger,
              data.detailUrl,
              undefined,
              this.provider.customFetch,
            ),
          ),
        );

        const detailPagesHtmlWithPipelineId: HtmlWithPipelineId[] = [];
        const successList: ParsedTargetListItemWithPipelineId[] = [];
        let failedCount = 0;

        settled.forEach((result, index) => {
          const item = list[index];
          if (result.status === 'fulfilled') {
            detailPagesHtmlWithPipelineId.push({
              pipelineId: item.pipelineId,
              html: result.value,
            });
            successList.push(item);
            return;
          }

          failedCount += 1;
          this.logger.error({
            event: 'crawl.detail.fetch.failed',
            taskId: this.taskId,
            data: {
              target: this.describeTarget(target),
              detailUrl: item.detailUrl,
              error: toErrorMessage(result.reason),
            },
          });
        });

        return {
          list: successList,
          detailPagesHtmlWithPipelineId,
          failedCount,
        };
      },
    );
  }

  private async parseDetailPagesHtml(
    target: CrawlingTarget,
    list: ParsedTargetListItemWithPipelineId[],
    detailPagesHtmlWithPipelineId: HtmlWithPipelineId[],
  ): Promise<DetailParseResult> {
    return this.executeWithLogging(
      {
        event: 'crawl.detail.parse',
        level: 'debug',
        startFields: {
          target: this.describeTarget(target),
          count: detailPagesHtmlWithPipelineId.length,
        },
        doneFields: (result) => ({
          successCount: result.parsedDetails.length,
          failedCount: result.failedCount,
        }),
      },
      async () => {
        const listItemMap = new Map(
          list.map((item) => [item.pipelineId, item]),
        );

        const settled = await Promise.allSettled(
          detailPagesHtmlWithPipelineId.map(({ html }) =>
            target.parseDetail(html),
          ),
        );

        const parsedDetails: ParsedTargetDetailWithPipelineId[] = [];
        const successList: ParsedTargetListItemWithPipelineId[] = [];
        let failedCount = 0;

        settled.forEach((result, index) => {
          const htmlItem = detailPagesHtmlWithPipelineId[index];
          const listItem = listItemMap.get(htmlItem.pipelineId);

          if (result.status === 'fulfilled' && listItem) {
            parsedDetails.push({
              pipelineId: htmlItem.pipelineId,
              ...result.value,
            });
            successList.push(listItem);
            return;
          }

          failedCount += 1;
          this.logger.error({
            event: 'crawl.detail.parse.failed',
            taskId: this.taskId,
            data: {
              target: this.describeTarget(target),
              detailUrl: listItem?.detailUrl,
              pipelineId: htmlItem.pipelineId,
              error:
                result.status === 'rejected'
                  ? toErrorMessage(result.reason)
                  : 'Missing list item for parsed detail',
            },
          });
        });

        return {
          list: successList,
          parsedDetails,
          failedCount,
        };
      },
    );
  }

  // Although this is a synchronous method, using async wrapping to maintain consistency with the executeWithLogging interface
  private async mergeParsedArticles(
    target: CrawlingTarget,
    list: ParsedTargetListItemWithPipelineId[],
    parsedDetails: ParsedTargetDetailWithPipelineId[],
  ): Promise<ParsedTarget[]> {
    return this.executeWithLogging(
      {
        event: 'crawl.merge',
        level: 'debug',
        startFields: {
          target: this.describeTarget(target),
          listCount: list.length,
          detailCount: parsedDetails.length,
        },
        doneFields: (merged) => ({ count: merged.length }),
      },
      async () => {
        const listItemMap = new Map(
          list.map((item) => [item.pipelineId, item]),
        );

        const merged: ParsedTarget[] = parsedDetails.map((detail) => {
          const listItem = listItemMap.get(detail.pipelineId);
          if (!listItem) {
            throw new Error(
              `No matching list item for detail with pipelineId: ${detail.pipelineId}`,
            );
          }

          return {
            ...omit(listItem, ['pipelineId']),
            ...omit(detail, ['pipelineId']),
          };
        });

        return merged;
      },
    );
  }

  private async saveArticles(
    group: CrawlingTargetGroup,
    target: CrawlingTarget,
    processedArticles: ParsedTarget[],
  ): Promise<number> {
    const omittedGroup = omit(group, ['targets']);

    return this.executeWithLogging(
      {
        event: 'crawl.save',
        level: 'debug',
        startFields: {
          group: omittedGroup,
          target: this.describeTarget(target),
          count: processedArticles.length,
        },
        doneFields: (saved) => ({ saved }),
      },
      async () => {
        return await this.provider.saveCrawledArticles(processedArticles, {
          taskId: this.taskId,
          targetGroup: omittedGroup,
          target,
        });
      },
    );
  }

  private describeTarget(target: CrawlingTarget) {
    return {
      name: target.name || 'unknown',
      listUrl: target.url,
    };
  }
}
