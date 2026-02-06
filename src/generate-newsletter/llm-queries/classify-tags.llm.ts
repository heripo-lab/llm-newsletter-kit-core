import type { UnscoredArticle } from '../models/article';

import { Output, generateText } from 'ai';
import { z } from 'zod';

import { LLMQuery, type LLMQueryConfig } from './llm-query';

type Params = {
  existTags: string[];
};
type ReturnType = Pick<UnscoredArticle, 'tag1' | 'tag2' | 'tag3'>;

export default class ClassifyTags<TaskId> extends LLMQuery<
  TaskId,
  UnscoredArticle,
  Params,
  ReturnType
> {
  private readonly schema = z.object({
    tag1: z.string(),
    tag2: z.string(),
    tag3: z.string(),
  });

  private existTags: string[] = [];

  constructor(config: LLMQueryConfig<TaskId>) {
    super(config);
  }

  public async execute({ existTags }: Params) {
    this.existTags = existTags;

    const { output, usage } = await generateText({
      model: this.model,
      maxRetries: this.options.llm.maxRetries,
      output: Output.object({
        schema: this.schema,
      }),
      system: this.systemPrompt,
      prompt: this.userPrompt,
    });

    return { result: output, usage };
  }

  private get systemPrompt(): string {
    return `You are an AI specializing in analyzing and categorizing articles for professionals in ${this.expertFields.join(', ')}.

## Core Responsibility
Analyze article titles and content to generate 3 optimal, detailed classifications by evaluating compatibility with existing tags and determining when new tags are justified.

## Output Language
All classifications must be written in ${this.options.content.outputLanguage}.

## Classification Rules
1. **Reuse Threshold**: Use existing classifications if compatibility is 80% or higher
2. **New Tag Criteria**: Create new classifications only when:
   - Best existing match scores below 80% compatibility
   - New tag demonstrates versatility across 10+ similar articles
3. **Naming Standards**: 
   - Length: 3-15 characters
   - Style: Clear, intuitive ${this.options.content.outputLanguage} terms
   - Balance industry precision with general reader comprehension
4. **Scope Exclusion**: Avoid broad, general tags like ${this.expertFields.map((v) => `"${v}"`).join(', ')} (too generic for this expert audience)

## Decision Framework
Prioritize in order:
- Content accuracy and relevance
- Classification system consistency
- User intuitiveness and searchability
- Long-term scalability and maintainability`;
  }

  private get userPrompt(): string {
    return `**Task**: Classify this article with 3 optimal detailed tags.

**Article Information**
- Title: ${this.targetArticle.title}
- Content: ${this.targetArticle.detailContent}

**Available Existing Tags**
\`\`\`
${JSON.stringify(this.existTags, null, 2)}
\`\`\`

**Analysis Steps**
1. Extract core concepts, industry sectors, and specific topics from the article
2. Score each existing tag for compatibility (0-100%)
3. Identify which existing tags meet the 80%+ threshold
4. For tags below 80%, determine if a new tag would better serve the content
5. Validate new tag names for clarity, length, and future applicability

**Output Requirements**
Return exactly 3 classifications following the system rules. Each classification should:
- Match the article's core content
- Fit logically within the overall classification system
- Be immediately understandable to your target audience
- Support future similar articles`;
  }
}
