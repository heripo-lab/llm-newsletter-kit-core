import type { UnscoredArticle } from '../models/article';

import { z } from 'zod';

import { generateObjectByLLM } from './generate-object-by-llm';
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
        'A high-level overview of the general theme, mood, and context conveyed by the images (without specific names, titles, or exact figures from text within images)',
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

    const { output, usage } = await generateObjectByLLM({
      model: this.model,
      maxRetries: this.options.llm.maxRetries,
      schema: this.schema,
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
3. Summarize the general theme and context of charts, data visualizations, and text within images at a high level
4. Synthesize visual information with article context

## Critical Rule: NO Detailed Text Transcription
- Do NOT transcribe specific names, titles, numbers, dates, or exact phrases from text within images
- Instead, describe WHAT KIND of information is present (e.g., "a conference poster listing multiple speaker sessions" instead of transcribing each speaker's name and talk title)
- Specific text in images is prone to misreading — only describe the general nature and purpose of such text
- Focus on the overall theme, mood, and context that the images convey

## Analysis Framework

### Information Categories to Extract
- Industry-relevant visual elements
- General theme and purpose of text/data shown in images (without exact transcription)
- Key subjects (people, places, objects, infrastructure) described at a general level
- Contextual relationships to ${this.expertFields.join(', ')}
- Information gaps filled by visual analysis

### Quality Standards
- High-level accuracy in describing the overall context
- Professional relevance for industry practitioners
- Integration with accompanying text content
- Preference for general descriptions over specific details from image text

## Output Specifications
- Language: ${this.options.content.outputLanguage}
- Format: Single cohesive explanation (not numbered list)
- Focus: High-level context and practical insights for industry professionals
- Integration: Seamlessly merge all extracted information
- Granularity: Describe the general nature of visual content — avoid quoting specific names, titles, figures, or exact text from images`;
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

2. **Summarizes Visual Text & Data**: Describe the general theme and purpose of any text, numerical data, charts, or graphs shown in images — do NOT transcribe specific names, titles, exact numbers, or quoted phrases

3. **Describes Visual Elements**: Detail important subjects (people, places, objects) and their significance at a general level

4. **Establishes Connections**: Link visual information to ${this.expertFields.join(', ')} context and article content

5. **Provides Context**: Explain what industry professionals should understand from these images

6. **Complements Text**: Add visual insights not covered in the article text

**Important**: Do NOT attempt to exactly transcribe text within images (names, titles, numbers, dates). Instead, describe what kind of information is shown. Exact text from images is unreliable and may contain errors.

**Format**: Present all findings as one flowing narrative without enumeration.`,
    };
  }
}
