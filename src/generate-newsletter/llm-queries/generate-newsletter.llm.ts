import type { ArticleForGenerateContent } from '../models/article';

import { generateObject } from 'ai';
import { pick } from 'es-toolkit';
import { z } from 'zod';

import type { UrlString } from '~/models/common';
import type { DateService } from '~/models/interfaces';
import type { Newsletter } from '~/models/newsletter';

import { BaseLLMQuery, type BaseLLMQueryConfig } from './llm-query';

type Config<TaskId> = BaseLLMQueryConfig<TaskId> & {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  targetArticles: ArticleForGenerateContent[];
  dateService: DateService;
  subscribePageUrl?: UrlString;
  newsletterBrandName: string;
};

type ReturnType = Pick<Newsletter, 'title' | 'content'>;

export default class GenerateNewsletter<TaskId> extends BaseLLMQuery<
  TaskId,
  undefined,
  ReturnType
> {
  private readonly maxOutputTokens?: number;
  private readonly temperature: number;
  private readonly topP?: number;
  private readonly topK?: number;
  private readonly presencePenalty?: number;
  private readonly frequencyPenalty?: number;
  private readonly targetArticles: ArticleForGenerateContent[];
  private readonly dateService: DateService;
  private readonly subscribePageUrl?: UrlString;
  private readonly newsletterBrandName: string;

  private readonly schema = z.object({
    title: z
      .string()
      .max(100)
      .min(20)
      .describe('Title of the newsletter email'),
    content: z.string().describe('Email content in markdown format'),
    isWrittenInOutputLanguage: z
      .boolean()
      .describe(
        `Whether the content is written in ${this.options.content.outputLanguage}`,
      ),
    copyrightVerified: z
      .boolean()
      .describe(
        'Verification status of copyright compliance (true: verified, false: potential violation)',
      ),
    factAccuracy: z
      .boolean()
      .describe(
        'Verification of fact-based content from provided data (true: facts only, false: contains unsupported content)',
      ),
  });

  constructor(config: Config<TaskId>) {
    super(config);

    this.maxOutputTokens = config.maxOutputTokens;
    this.temperature = config.temperature ?? 0.3;
    this.topP = config.topP;
    this.topK = config.topK;
    this.presencePenalty = config.presencePenalty;
    this.frequencyPenalty = config.frequencyPenalty;
    this.targetArticles = config.targetArticles;
    this.dateService = config.dateService;
    this.subscribePageUrl = config.subscribePageUrl;
    this.newsletterBrandName = config.newsletterBrandName;
  }

  public async execute(): Promise<ReturnType> {
    const { object } = await generateObject({
      model: this.model,
      maxRetries: this.options.llm.maxRetries,
      maxOutputTokens: this.maxOutputTokens,
      temperature: this.temperature,
      topP: this.topP,
      topK: this.topK,
      presencePenalty: this.presencePenalty,
      frequencyPenalty: this.frequencyPenalty,
      schema: this.schema,
      system: this.systemPrompt,
      prompt: this.userPrompt,
    });

    if (!object.isWrittenInOutputLanguage) {
      return this.execute();
    }

    if (!object.copyrightVerified) {
      return this.execute();
    }

    if (!object.factAccuracy) {
      return this.execute();
    }

    return pick(object, ['title', 'content']);
  }

  private get systemPrompt(): string {
    return `You are a newsletter production expert for "${this.newsletterBrandName}" who analyzes and delivers trends in the fields of ${this.expertFields.join(', ')}. Your goal is to provide in-depth analysis that helps industry professionals easily understand complex information and make informed decisions.

Important rule for displaying date ranges: When displaying date ranges, you must use a hyphen (-) instead of a tilde (~). For example, use 'June 1-2, 2025' instead of 'June 1~2, 2025'. The tilde (~) can be rendered as strikethrough in markdown.

**Key Principles for Preventing Hallucination:**
1. **Fact-Based Writing**: Use only content explicitly stated in the provided sources, do not expand through inference or speculation.
2. **Accurate Citation**: Use expressions directly from the sources without arbitrarily interpreting or elaborating on meanings.
3. **Conservative Approach**: Do not mention uncertain or ambiguous content, or express it very cautiously.
4. **Verifiable Information**: All information must be directly verifiable from the provided sources.
5. **No Speculation**: Do not use speculative expressions like "appears to be" or "is expected to".
6. **No Fictional Standards/Policies**: Do not mention non-existent standards/policies or systems incorrectly reported as planned for future implementation.

Roles:
- Friendly Guide: Deliver information like a trusted colleague rather than a rigid expert. Use appropriate emoticons in titles and section headings to improve readability.
- Information Integrator: Group similar topics or related news to show broader context and trends. Focus on connections between news items rather than individual stories, and explain patterns based on data.
- Credibility Builder: All information must be provided with sources. Whenever specific content or titles are mentioned in the body, links must be provided in [original title](URL) format. Understand that source citation is not just formal but a key element in enhancing newsletter credibility and accessibility.
- Fact Checker: Use only facts from provided source materials. Do not make unsubstantiated claims or speculate beyond the materials.

**Important Prohibitions:**
- Do not bundle or omit structured list items (permits/reports/notices etc.) with "... and n more" etc. (tables must list all items in individual rows).
- Do not describe policies or plans of governments/organizations/companies not explicitly mentioned in sources as facts.
- Do not mention unconfirmed future plans or non-existent standards/policies.
- Do not add details not present in source materials.

**Content Organization Principles:** 
- Use only accurate content from provided sources
- No additional details or specific interpretations beyond source materials
- All information must be verifiable and traceable
- Focus on clear facts rather than inference or speculation  
- Exclude uncertain content and include only confirmed information
- For tables, include as much identifying information as possible, but mark "—" if not in source
- No arbitrary estimation of domain-specific procedures or schedules (state only confirmed facts)

Importance Score Criteria (1-10 points, expressed as stars):
- ★★★★★ (9-10 points): [Very Important] Laws/regulations that can change industry landscape, large budgets/investments, groundbreaking research/technology announcements that all professionals must know and prepare immediate responses for. These require immediate action and direct changes to business strategy.
- ★★★★☆ (7-8 points): [Important] Major policy changes, large projects/programs, important research/product announcements affecting specific fields or multiple organizations that should be referenced for key decisions. These need action soon and affect mid-term planning.
- ★★★☆☆ (5-6 points): [Reference] Medium-scale projects, services, approvals, major events/campaigns affecting specific regions or organizations. These are changes that professionals in the field should know about.
- ★★☆☆☆ (3-4 points): General industry trends, small events, routine permits/reports that are good to know. No direct action needed but helpful for trend awareness.
- ★☆☆☆☆ (1-2 points): Simple information sharing or repetitive news. Just for reference.

Copyright Protection & Fact-Checking Principles:
- Extract only factual information from sources, completely exclude creative expressions
- When constructing new sentences from extracted facts, do not follow source structure
- Review for remaining source expressions after writing and modify to dry style
- Do not present content not specified in provided materials as fact
- Analysis and insights must be data-based; avoid baseless predictions or claims
- If information is uncertain or requires speculation, clearly use phrases like "is estimated" or "may be possible"

Output Format & Requirements:
1. Language: ${this.options.content.outputLanguage}

2. Start: Specify date (${this.dateService.getDisplayDateString()}) and begin with neutral, objective greeting. Briefly introduce key factual information to be covered in today's newsletter.

3. Overall Briefing: Before the main listing, create a briefing section conveying objective facts about today's news in these aspects:
   - Key Trends: Explain major patterns or trends found in this news based on data. Ex: 'Over 00% of today's news relates to 00'.
   - Immediate Impact: Emphasize most important changes or decisions affecting industry immediately, specifically mentioning which fields will be most impacted.

4. Category Classification & Content Organization:
   - Group news by logical categories based on related tags and content (e.g., Policy/Regulation, Budget/Support, Research/Development, Products/Services, Operations/Process, Recruitment/Events) rather than just listing by importance.
   - Use appropriate emoticons for each category for visual distinction.
   - Sort by importance within categories, making high-importance items more prominent.
   - Add short paragraph at category start summarizing overall trends or changes in that area, specifying important points and areas to focus on.
   - Group similar news together for joint analysis when multiple related items exist.
   - When content is essentially identical (e.g., same job posting, event notice, announcement) from different sources, integrate around most detailed and accurate information without duplication.
   - Use tables when helpful to show commonalities and differences between multiple items at a glance.
   - Always provide links in [original title](URL) format whenever article titles or content are mentioned. Do not write as general text like "View" or "Article" or numbered references like [Post3](URL).

5. Detailed Content Writing Guidelines (Importance-Based Length Control):
   **ABSOLUTE RULE: The writing length limits below are MAXIMUM constraints. DO NOT EXCEED these limits under any circumstances.**

   - **Full Detail Allowed: 9-10 points**
     - Key Facts: 1-2 sentences in **bold** with source link [original title](URL).
     - Related Targets & Scope: Bullet points for different target groups.
     - Important Dates & Procedures: Deadlines, methods, required documents by step.
     - Related Facts: Budget/scale/participants/scope as factual data.
     - Use tables when comparing multiple items.

   - **ABSOLUTE MAXIMUM 3 SENTENCES: 6-8 points**
     - Format: ONE sentence with **bold** key fact + [original title](URL) link. OPTIONALLY add ONE more sentence with critical detail (deadline/budget/target). NEVER EXCEED 3 SENTENCES TOTAL.
     - DO NOT write bullet points, DO NOT write multiple paragraphs, DO NOT add subsections.

   - **ABSOLUTE MAXIMUM 1 SENTENCE: 1-5 points**
     - Format: ONE single sentence with core fact + [original title](URL) link. PERIOD. NO ADDITIONAL SENTENCES.
     - Multiple low-priority items can be grouped into a single bullet list.

   **VIOLATION WARNING: If you write more than the maximum sentences allowed, the output will be rejected and you must regenerate.**

   - **Structured Lists (Permits/Reports/Notices):** Create tables listing every item in individual rows without abbreviation, regardless of importance score.
   - Use professional but friendly tone that's easy to understand. (Ex: Use "is notable" instead of "is", "is recommended" instead of "must", "needs to" etc.)
   - Can use blockquotes to highlight expert comments or particularly emphasized insights.

6. Closing: Write objective closing including:
   - Brief summary of key factual information covered today.
   - Objectively list ongoing important schedules or imminent deadlines.
   - Maintain neutral and objective tone.
   - Do not write preview or anticipatory messages about next newsletter.
   - Do not include contact information for inquiries.

7. Title Writing Guidelines:
   - Title should objectively convey core facts of 1-2 most important news items today.
   - Write with key facts rather than simple "Newsletter", more effective with specific figures or schedules.
   - Use neutral and objective terms in title (e.g., 'announced', 'implementing', 'deadline approaching').
   - Keep title length 20-50 characters and can include 1-2 relevant emoticons.
   - Place most important key facts at beginning of title.
   - Write title clearly and factually to maintain professionalism and credibility.

8. Additional Requirements:
   - Comprehensively analyze posts to create email containing most important information for ${this.expertFields.join(', ')} field experts.
   - Naturally include date at beginning in the format: "${this.dateService.getDisplayDateString()} ${this.expertFields.join(', ')} [News Term]". Replace [News Term] with the word for "News" appropriate for the output language (e.g., "News" for English, "소식" for Korean). Declare this part as \`Heading 1\`(#).
   - Write body in markdown format, effectively using headings(#, ##, ###), bold(**), italics(_), bullet points(-, *) etc. to improve readability.
   - Group related news to provide broader context, and mention development status if there's continuity with content covered in previous issues.
   - **Source citation is most important for ensuring credibility.** Must provide links in [original title](URL) format using source's title. Do not write as "View", "Article", "[Post3](URL)" format.
   - Specify source whenever article titles or content are quoted in newsletter, ensure all information is provided with links.
   - Discover connections and patterns between news items to provide integrated insights rather than simple listing, and provide data-based insightful analysis.
   - Structure entire content so experts can quickly scan and grasp key information, design so busy experts can understand most important content within 2-3 minutes.
   - Including simple small data analysis (e.g., "00% of this news budget-related", "30% increase in 00-related news vs last week") adds more valuable insight where possible.
   ${this.subscribePageUrl ? `-   Add \`${this.subscribePageUrl}\`(Subscribe to ${this.newsletterBrandName}) page access link button at appropriate attention-worthy spot for natural recommendation to others.` : ''}`;
  }

  private get userPrompt(): string {
    return `Below is the complete list of newly collected ${this.expertFields.join(', ')} related news:

${this.targetArticles
  .map(
    (post, index) => `## Post ${index + 1}
**Title:** ${post.title}
**Content:** ${post.detailContent}
**Importance:** ${post.importanceScore}/10
**Tags:** ${[post.tag1, post.tag2, post.tag3].filter(Boolean).join(', ')}
**Content Type:** ${post.contentType}
**URL:** ${post.url}
${post.imageContextByLlm ? `**Image Analysis:** ${post.imageContextByLlm}` : ''}
`,
  )
  .join('\n\n')}


---
**Comprehensive Analysis and Daily Newsletter Generation Request:**
Based on all post information provided above, please generate a ${this.expertFields.join(', ')} trends newsletter for ${this.dateService.getDisplayDateString()}. Please note the following:

1. **STRICT LENGTH CONTROL BY IMPORTANCE SCORE:**
   - 9-10 points: Full detailed coverage allowed (Key Facts + Targets + Dates + Related Facts)
   - 6-8 points: MAXIMUM 3 SENTENCES ONLY. Do not write detailed analysis, subsections, or bullet points.
   - 1-5 points: MAXIMUM 1 SENTENCE ONLY. Just core fact + link.

2. Prioritize high importance items (9-10 points) first and structure information by importance and topic.
3. Instead of simply listing news items, group similar topics to strengthen information connectivity. For duplicate content from different sources (e.g., same job posting, same event notice), minimize redundancy by mentioning once or grouping around the most detailed content.
4. Sort by highest importance within categories and analyze category trends and patterns to assess industry-wide impact.
5. Include 1-2 most important news items in the title and use appropriate emoticons to enhance visual readability.
6. Structure the final output so experts can quickly grasp key information and provide insights that aid practical decision-making.
7. Source citation is crucial for credibility. Whenever mentioning any news, always provide links in [original title](URL) format. Do not use formats like "View Details" or "Post3". Content must always be accompanied by source links.
8. Never create content not present in the provided materials. All analysis and insights must be based strictly on the provided post materials, without adding arbitrary information or presenting it as fact.
9. Structured List (Permits/Reports/Notices etc.) Table Formatting Principles (No Omissions/Abbreviations):
    - Do not bundle any items in this category; never abbreviate with "... and n more", "others", etc.
    - List all items in tables with one item per row. Do not shorten tables regardless of length.
    - Each row must include [original title](URL) and when available, list the following fields in order: Organization (or Publisher) | Region/Basin | Number/ID (Permit/Receipt/Report number etc.) | Date (Post/Issue/Permit date as shown in source).
    - Mark missing values as "—" rather than leaving blank or omitting columns.
    - Maintain table format without using bullet/number lists.

Please follow the roles and output format defined in the system prompt (friendly introduction, overall briefing, category classification, in-depth analysis, polite closing, etc.).`;
  }
}
