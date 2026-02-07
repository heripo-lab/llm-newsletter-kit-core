import type { UnscoredArticle } from '../models/article';
import type { MinimumImportanceScoreRule } from '../models/interfaces';

import { Output, generateText } from 'ai';
import { z } from 'zod';

import type { DateService } from '~/models/interfaces';

import { LLMQuery, type LLMQueryConfig } from './llm-query';

type Config<TaskId> = LLMQueryConfig<TaskId> & {
  minimumImportanceScoreRules?: MinimumImportanceScoreRule[];
  dateService: DateService;
};

export default class DetermineArticleImportance<TaskId> extends LLMQuery<
  TaskId,
  UnscoredArticle,
  undefined,
  number
> {
  private readonly minimumImportanceScoreRules: MinimumImportanceScoreRule[];
  private readonly schema = z.object({
    importanceScore: z
      .number()
      .min(1)
      .max(10)
      .describe('Article importance score (1-10, 10 is most important)'),
  });

  private readonly dateService: DateService;

  constructor(config: Config<TaskId>) {
    super(config);

    this.minimumImportanceScoreRules = config.minimumImportanceScoreRules ?? [];
    this.dateService = config.dateService;
  }

  public async execute() {
    const { output, usage } = await generateText({
      model: this.model,
      maxRetries: this.options.llm.maxRetries,
      output: Output.object({
        schema: this.schema,
      }),
      system: this.systemPrompt,
      prompt: this.userPrompt,
    });

    return { result: output.importanceScore, usage };
  }

  private get minPoint() {
    const targetRule = this.minimumImportanceScoreRules.find(
      ({ targetUrl }) => targetUrl === this.targetArticle.targetUrl,
    );

    return targetRule?.minScore ?? 1;
  }

  private get hasHigherMinimumScore() {
    return this.minPoint > 1;
  }

  private get systemPrompt() {
    return `You are an expert in importance evaluation in the field of ${this.expertFields.join(', ')}.

Role:
- Analyze titles and content in depth to objectively evaluate the importance of news and announcements.
- Extract the most important insights for industry professionals. Main readers are practitioners from research institutions, local/public officials, graduate students, and field experts in ${this.expertFields.join(', ')}.
- Score based on urgency, impact, and scarcity of information.

Importance Score Criteria (${this.minPoint}-10):
10: Information with immediate and significant impact on entire industry (e.g., major legislation passed, large budget allocation, critical discoveries/events that transform the field)
8-9: Information with important impact on many stakeholders (e.g., major policy changes, major findings/achievements released, large project announcements)
7-8: Very important academic/professional achievements or information in specific fields (e.g., journal publication/release, major research results announcement, professional report publication, important academic events, research database construction/release, designation of important field resources/assets, medium-scale bid information)
5-6: General important information limited to specific fields or regions (e.g., small project permits, general event notices, small-scale bids)
4-5: General industry news or small/medium-scale event information
2-3: Simple information sharing or repetitive daily news
${this.hasHigherMinimumScore ? '' : `1: Information without current significance - Expired support programs, past events, invalid bid notices or recruitment information, notices that have lost practical value, or administrative/simple notices like "membership fee status", "meeting minutes", "internal schedule notices"`}

Evaluation Criteria:
- Academic Value: Journal publications, research reports, academic seminars/symposiums, research output presentations etc. minimum 7 points (knowledge base expansion and long-term reference value)
- Practical Impact: Information requiring immediate response like policies, regulations, bids, recruitment
- Impact Range: How many stakeholders are affected
- Scarcity: How rare and exclusive the information is
- Temporal Context: Practical value at current time considering deadlines, event schedules${this.hasHigherMinimumScore ? '' : ' (However, recent academic achievements maintain high scores)'}

Important Notes:
- Evaluate considering characteristics and context of ${this.expertFields.join(', ')} fields.
- Be sensitive to core keywords, events, policies considered important in the field.`;
  }

  private get userPrompt() {
    return `Please rate the importance of this article from ${this.minPoint} to 10.

**Current Date:** ${this.dateService.getCurrentISODateString()}

**Title:** ${this.targetArticle.title || 'No Title'}

**Content:** ${this.targetArticle.detailContent || 'No Content'}

**Tags:** ${this.targetArticle.tag1 || ''}, ${this.targetArticle.tag2 || ''}, ${this.targetArticle.tag3 || ''}
${
  this.targetArticle.imageContextByLlm
    ? `
**Image Analysis:** ${this.targetArticle.imageContextByLlm}`
    : ''
}`;
  }
}
