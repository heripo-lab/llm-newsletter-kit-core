import type { UnscoredArticle } from '../models/article';

import { Output, generateText } from 'ai';
import { z } from 'zod';

import {
  LLMQuery,
  type LLMQueryConfig,
  type LLMQueryExecuteResult,
} from './llm-query';

type ReturnType = string | null;

const ZERO_USAGE = {
  inputTokens: undefined,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokens: undefined,
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  totalTokens: undefined,
} as const;

export default class AnalyzeImages<TaskId> extends LLMQuery<
  TaskId,
  UnscoredArticle,
  undefined,
  ReturnType
> {
  private readonly schema = z.object({
    imageContext: z
      .string()
      .describe(
        'A comprehensive description of all information extracted from the images',
      ),
  });

  constructor(config: LLMQueryConfig<TaskId>) {
    super(config);
  }

  public async execute(): Promise<LLMQueryExecuteResult<ReturnType>> {
    if (
      !this.targetArticle.hasAttachedImage ||
      !this.targetArticle.detailContent
    ) {
      return { result: null, usage: ZERO_USAGE };
    }

    if (this.imageMessages.length === 0) {
      return { result: null, usage: ZERO_USAGE };
    }

    const { output, usage } = await generateText({
      model: this.model,
      maxRetries: this.options.llm.maxRetries,
      output: Output.object({
        schema: this.schema,
      }),
      system: this.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [this.textMessage, ...this.imageMessages],
        },
      ],
    });

    return { result: output.imageContext, usage };
  }

  private get systemPrompt(): string {
    return `# Image Analysis Expert System

## Identity & Expertise
You are a specialized image analysis expert in: ${this.expertFields.join(', ')}

## Core Responsibilities
1. Extract visual information unavailable from text alone
2. Identify industry-specific elements, facilities, and stakeholders
3. Accurately read and transcribe text, charts, and data visualizations
4. Synthesize visual information with article context

## Analysis Framework

### Information Categories to Extract
- Industry-relevant visual elements
- Text and numerical data within images
- Key subjects (people, places, objects, infrastructure)
- Contextual relationships to ${this.expertFields.join(', ')}
- Information gaps filled by visual analysis

### Quality Standards
- Accuracy and specificity in descriptions
- Professional relevance for industry practitioners
- Integration with accompanying text content
- Completeness in covering all visual information

## Output Specifications
- Language: ${this.options.content.outputLanguage}
- Format: Single cohesive explanation (not numbered list)
- Focus: Practical insights for industry professionals
- Integration: Seamlessly merge all extracted information`;
  }

  private get imageUrls() {
    // Markdown image pattern: ![alt text](url) or ![](url)
    // Includes http, https, relative paths, and data URIs
    const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
    const urls: string[] = [];
    let match;

    while (
      (match = imageRegex.exec(this.targetArticle.detailContent)) !== null
    ) {
      const url = match[1].trim();

      // Validate URL format (http, https, relative path, data URI)
      if (
        url &&
        (url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('//') || // Protocol-relative URL
          url.startsWith('/') || // Absolute path
          url.startsWith('./') || // Relative path
          url.startsWith('../') || // Parent directory relative path
          url.startsWith('data:image/')) // Data URI
      ) {
        urls.push(url);
      }
    }

    // Process max 5 images only (to save cost)
    return urls.slice(0, 5);
  }

  private get imageMessages() {
    return this.imageUrls.map((url) => ({
      type: 'image' as const,
      image: url,
    }));
  }

  private get textMessage() {
    return {
      type: 'text' as const,
      text: `## Analysis Task

**Document Context:**
- Title: ${this.targetArticle.title}
- Content: ${this.targetArticle.detailContent}

## Instructions

Analyze the provided images and synthesize your findings into a single comprehensive explanation that:

1. **Identifies Visual Content**: Extract industry-specific elements, infrastructure, and stakeholders relevant to ${this.expertFields.join(', ')}

2. **Captures Text & Data**: Accurately read and include all visible text, numerical data, charts, and graphs

3. **Describes Visual Elements**: Detail important subjects (people, places, objects) and their significance

4. **Establishes Connections**: Link visual information to ${this.expertFields.join(', ')} context and article content

5. **Provides Context**: Explain what industry professionals should understand from these images

6. **Complements Text**: Add visual insights not covered in the article text

**Format**: Present all findings as one flowing narrative without enumeration.`,
    };
  }
}
