import type { PromptProvider } from '@llm-newsletter-kit/core';

/**
 * Custom LLM prompts for playground scripts.
 *
 * Usage:
 *   cp playground/data-examples/prompts.example.ts playground/data/prompts.ts
 *
 * Every field is optional. Delete any builder you do NOT want to customize —
 * the stage then falls back to its built-in default prompt.
 * A builder's return value REPLACES the default prompt entirely (no merging),
 * so a custom prompt must describe the full task on its own.
 *
 * Each builder receives the same context object the built-in prompt uses
 * (articles, expert fields, output language, date service, etc.), so you can
 * interpolate live pipeline data into your custom prompt.
 */
const prompts: PromptProvider = {
  analysis: {
    // ❶ Tag classification — 3 tags per article
    classifyTags: {
      system: ({ expertFields, outputLanguage }) =>
        `You are a tagging assistant for ${expertFields.join(', ')} news.
Return exactly 3 short, specific tags in ${outputLanguage}.
Reuse an existing tag whenever one fits; avoid generic field names.`,
      user: ({ targetArticle, existTags }) =>
        `Classify this article with 3 tags.

Title: ${targetArticle.title}
Content: ${targetArticle.detailContent}

Existing tags: ${JSON.stringify(existTags)}`,
    },

    // ❷ Image analysis — high-level visual context (multimodal model required)
    analyzeImages: {
      system: ({ expertFields, outputLanguage }) =>
        `You are an image analyst for ${expertFields.join(', ')} content.
Describe the overall theme and mood of the attached images in ${outputLanguage}.
Never transcribe specific names, numbers, or text from the images.`,
      user: ({ targetArticle }) =>
        `Describe the general visual context of the images attached to this article as one flowing paragraph.

Title: ${targetArticle.title}
Content: ${targetArticle.detailContent}`,
    },

    // ❸ Importance scoring — 1-10
    determineImportance: {
      system: ({ expertFields }) =>
        `You are an importance evaluator for ${expertFields.join(', ')} professionals.
Score articles 1-10: 10 = industry-changing, 5 = field-specific reference, 1 = expired or trivial.
If a deadline or event date has already passed relative to the publication date, score 1.`,
      user: ({ targetArticle, dateService }) =>
        `Score this article from 1 to 10.

Publication date: ${dateService.getPublicationISODateString()}
Title: ${targetArticle.title}
Content: ${targetArticle.detailContent}
Tags: ${[targetArticle.tag1, targetArticle.tag2, targetArticle.tag3].filter(Boolean).join(', ')}`,
    },
  },

  contentGenerate: {
    // ❹ Newsletter generation — final title + markdown body
    generateNewsletter: {
      system: ({ expertFields, outputLanguage, newsletterBrandName }) =>
        `You are the editor of "${newsletterBrandName}", a ${expertFields.join(', ')} newsletter.
Write in ${outputLanguage}, markdown format.
Use only facts from the provided articles; always cite sources as [original title](URL).
Group related items, lead with the most important news, and keep low-importance items to one sentence.`,
      user: ({ targetArticles, dateService }) =>
        `Write today's newsletter (publication date: ${dateService.getPublicationDisplayDateString()}) from these articles:

${targetArticles
  .map(
    (article, index) => `## Article ${index + 1}
Title: ${article.title}
Content: ${article.detailContent}
Importance: ${article.importanceScore}/10
URL: ${article.url}`,
  )
  .join('\n\n')}

Start with a brief overall briefing, then group articles by topic, and end with a short closing summary.`,
    },
  },
};

export default prompts;
