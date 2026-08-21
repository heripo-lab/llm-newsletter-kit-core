import { JSDOM } from 'jsdom';
import juice from 'juice';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import safeMarkdown2Html from 'safe-markdown2html';

import GenerateNewsletter from '~/generate-newsletter/llm-queries/generate-newsletter.llm';
import type { ArticleForGenerateContent } from '~/generate-newsletter/models/article';
import { LoggingExecutor } from '~/logging/logging-executor';
import { ensureHrBeforeH2 } from '~/utils/string';

import {
  DATA_DIR,
  OUTPUT_DIR,
  consoleLogger,
  createDateService,
  createModel,
  describePromptBuilder,
  describeStageModel,
  ensureDir,
  loadArticles,
  loadConfig,
  loadPromptProvider,
  loadText,
  resolveStageModel,
} from './_shared';

async function main() {
  // 1. Load config
  const config = await loadConfig();

  // 2. Load articles
  const articles = await loadArticles<ArticleForGenerateContent[]>(
    resolve(DATA_DIR, 'articles.json'),
  );

  // 3. Load HTML template
  const htmlTemplate = await loadText(resolve(DATA_DIR, 'template.html'));

  // 4. Load optional custom prompts
  const prompts = await loadPromptProvider();
  const promptBuilder = prompts.contentGenerate?.generateNewsletter;

  const generation = config.generation ?? {};

  console.log(`\nLoaded ${articles.length} articles`);
  console.log(`Model: ${describeStageModel(config, 'generateNewsletter')}`);
  console.log(`Language: ${config.outputLanguage}`);
  console.log(`Expert fields: ${config.expertField.join(', ')}`);
  console.log(`Prompts: ${describePromptBuilder(promptBuilder)}`);
  console.log(
    `Generation: temperature ${generation.temperature ?? '0.3 (core default)'} / maxOutputTokens ${generation.maxOutputTokens ?? 'unset'}\n`,
  );

  // 5. Create model from provider
  const model = createModel(config, 'generateNewsletter');

  // 6. Execute LLM query
  const taskId = `playground-${Date.now()}`;
  const loggingExecutor = new LoggingExecutor(consoleLogger, taskId);
  const dateService = createDateService(config.displayDate, config.isoDate);

  console.log('Generating newsletter via LLM...\n');

  const query = new GenerateNewsletter({
    model,
    logger: consoleLogger,
    taskId,
    loggingExecutor,
    options: {
      content: {
        outputLanguage: config.outputLanguage,
        expertField: config.expertField,
        freeFormIntro: config.freeFormIntro,
        titleContext: config.titleContext,
      },
      llm: { maxRetries: config.maxRetries ?? 3 },
    },
    targetArticles: articles,
    dateService,
    subscribePageUrl: config.subscribePageUrl,
    newsletterBrandName: config.newsletterBrandName,
    promptBuilder,
    maxOutputTokens: generation.maxOutputTokens,
    temperature: generation.temperature,
    topP: generation.topP,
    topK: generation.topK,
    presencePenalty: generation.presencePenalty,
    frequencyPenalty: generation.frequencyPenalty,
  });

  const { result, usage } = await query.execute();

  console.log(`Title: ${result.title}`);
  console.log(
    `Token usage: ${usage.inputTokens ?? 0} input / ${usage.outputTokens ?? 0} output / ${usage.totalTokens ?? 0} total\n`,
  );

  // 7. Convert markdown to HTML
  const contentHtml = safeMarkdown2Html(ensureHrBeforeH2(result.content), {
    window: new JSDOM('').window,
    linkTargetBlank: true,
    fixMalformedUrls: true,
    fixBoldSyntax: true,
    convertStrikethrough: true,
  });

  // 8. Apply template markers
  const { title: titleMarker, content: contentMarker } = config.templateMarkers;
  let renderedHtml = htmlTemplate
    .replace(`{{${titleMarker}}}`, result.title)
    .replace(`{{${contentMarker}}}`, contentHtml);

  // 9. Inline CSS with juice
  renderedHtml = juice(renderedHtml);

  // 10. Save outputs
  await ensureDir(OUTPUT_DIR);

  const mdContent = `---\ntitle: "${result.title}"\n---\n\n${result.content}`;
  await writeFile(resolve(OUTPUT_DIR, 'newsletter.md'), mdContent, 'utf-8');
  await writeFile(
    resolve(OUTPUT_DIR, 'newsletter.html'),
    renderedHtml,
    'utf-8',
  );

  // 11. Save usage report
  const usageMd = [
    '# Token Usage Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Provider | ${resolveStageModel(config, 'generateNewsletter').provider} |`,
    `| Model | ${resolveStageModel(config, 'generateNewsletter').model} |`,
    `| Temperature | ${generation.temperature ?? 0.3} |`,
    `| Max Output Tokens | ${generation.maxOutputTokens ?? 'unset'} |`,
    `| Input Tokens | ${usage.inputTokens ?? 0} |`,
    `| Output Tokens | ${usage.outputTokens ?? 0} |`,
    `| Total Tokens | ${usage.totalTokens ?? 0} |`,
  ].join('\n');
  await writeFile(resolve(OUTPUT_DIR, 'usage.md'), usageMd, 'utf-8');

  console.log('Output saved:');
  console.log(`  - playground/output/newsletter.md`);
  console.log(`  - playground/output/newsletter.html`);
  console.log(`  - playground/output/usage.md\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
