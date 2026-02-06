import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createTogetherAI } from '@ai-sdk/togetherai';
import juice from 'juice';

import type { ArticleForGenerateContent } from '~/generate-newsletter/models/article';
import GenerateNewsletter from '~/generate-newsletter/llm-queries/generate-newsletter.llm';
import { LoggingExecutor } from '~/logging/logging-executor';
import markdownToHtml from '~/utils/markdown-to-html';

import {
  DATA_DIR,
  OUTPUT_DIR,
  consoleLogger,
  createDateService,
  ensureDir,
  loadJson,
  loadText,
} from './_shared';

type PlaygroundConfig = {
  provider: 'openai' | 'anthropic' | 'google' | 'togetherai';
  apiKey: string;
  model: string;
  outputLanguage: string;
  expertField: string[];
  freeFormIntro?: boolean;
  titleContext?: string;
  newsletterBrandName: string;
  subscribePageUrl?: string;
  displayDate: string;
  isoDate: string;
  maxRetries?: number;
  templateMarkers: {
    title: string;
    content: string;
  };
};

async function main() {
  // 1. Load config
  let config: PlaygroundConfig;
  try {
    config = await loadJson<PlaygroundConfig>(resolve(DATA_DIR, 'config.json'));
  } catch {
    console.error(
      '\n[ERROR] playground/data/config.json not found.\n' +
        'Copy example files first:\n\n' +
        '  mkdir -p playground/data\n' +
        '  cp playground/data-examples/config.example.json playground/data/config.json\n' +
        '  cp playground/data-examples/articles.example.json playground/data/articles.json\n' +
        '  cp playground/data-examples/template.example.html playground/data/template.html\n\n' +
        'Then edit playground/data/config.json with your OpenAI API key.\n',
    );
    process.exit(1);
  }

  // 2. Load articles
  const articles = await loadJson<ArticleForGenerateContent[]>(
    resolve(DATA_DIR, 'articles.json'),
  );

  // 3. Load HTML template
  const htmlTemplate = await loadText(resolve(DATA_DIR, 'template.html'));

  console.log(`\nLoaded ${articles.length} articles`);
  console.log(`Provider: ${config.provider ?? 'openai'}`);
  console.log(`Model: ${config.model}`);
  console.log(`Language: ${config.outputLanguage}`);
  console.log(`Expert fields: ${config.expertField.join(', ')}\n`);

  // 4. Create model from provider
  const providers = {
    openai: () => createOpenAI({ apiKey: config.apiKey })(config.model),
    anthropic: () => createAnthropic({ apiKey: config.apiKey })(config.model),
    google: () =>
      createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model),
    togetherai: () => createTogetherAI({ apiKey: config.apiKey })(config.model),
  };

  const providerName = config.provider ?? 'openai';
  const createModel = providers[providerName];
  if (!createModel) {
    console.error(
      `[ERROR] Unknown provider "${providerName}". Use: ${Object.keys(providers).join(', ')}`,
    );
    process.exit(1);
  }
  const model = createModel();

  // 5. Execute LLM query
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
  });

  const { result, usage } = await query.execute();

  console.log(`Title: ${result.title}`);
  console.log(`Token usage: ${usage.inputTokens ?? 0} input / ${usage.outputTokens ?? 0} output / ${usage.totalTokens ?? 0} total\n`);

  // 6. Convert markdown to HTML
  const contentHtml = markdownToHtml(result.content);

  // 7. Apply template markers
  const { title: titleMarker, content: contentMarker } =
    config.templateMarkers;
  let renderedHtml = htmlTemplate
    .replace(`{{${titleMarker}}}`, result.title)
    .replace(`{{${contentMarker}}}`, contentHtml);

  // 8. Inline CSS with juice
  renderedHtml = juice(renderedHtml);

  // 9. Save outputs
  await ensureDir(OUTPUT_DIR);

  const mdContent = `---\ntitle: "${result.title}"\n---\n\n${result.content}`;
  await writeFile(resolve(OUTPUT_DIR, 'newsletter.md'), mdContent, 'utf-8');
  await writeFile(resolve(OUTPUT_DIR, 'newsletter.html'), renderedHtml, 'utf-8');

  // 10. Save usage report
  const usageMd = [
    '# Token Usage Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Provider | ${providerName} |`,
    `| Model | ${config.model} |`,
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
