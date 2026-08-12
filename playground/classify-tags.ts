import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ClassifyTags from '~/generate-newsletter/llm-queries/classify-tags.llm';
import type { UnscoredArticle } from '~/generate-newsletter/models/article';
import { LoggingExecutor } from '~/logging/logging-executor';

import {
  DATA_DIR,
  OUTPUT_DIR,
  consoleLogger,
  createModel,
  describePromptBuilder,
  ensureDir,
  loadConfig,
  loadJson,
  loadPromptProvider,
} from './_shared';

async function main() {
  const config = await loadConfig();
  const articles = await loadJson<UnscoredArticle[]>(
    resolve(DATA_DIR, 'articles.json'),
  );
  const prompts = await loadPromptProvider();
  const promptBuilder = prompts.analysis?.classifyTags;
  const existTags = config.existTags ?? [];

  console.log(`\nLoaded ${articles.length} articles`);
  console.log(`Provider: ${config.provider ?? 'openai'} / ${config.model}`);
  console.log(`Prompts: ${describePromptBuilder(promptBuilder)}`);
  console.log(`Existing tags: ${existTags.length}\n`);

  const model = createModel(config);
  const taskId = `playground-classify-tags-${Date.now()}`;
  const loggingExecutor = new LoggingExecutor(consoleLogger, taskId);
  const options = {
    content: {
      outputLanguage: config.outputLanguage,
      expertField: config.expertField,
    },
    llm: { maxRetries: config.maxRetries ?? 3 },
  };

  const lines: string[] = ['# Classify Tags Result', ''];
  let totalTokens = 0;

  for (const article of articles) {
    const query = new ClassifyTags({
      model,
      logger: consoleLogger,
      taskId,
      loggingExecutor,
      options,
      targetArticle: article,
      promptBuilder,
    });

    const { result, usage } = await query.execute({ existTags });
    totalTokens += usage.totalTokens ?? 0;

    const tags = [result.tag1, result.tag2, result.tag3].join(', ');
    console.log(`[${article.id}] ${article.title}`);
    console.log(`  → ${tags}\n`);

    lines.push(`## [${article.id}] ${article.title}`, '', `- Tags: ${tags}`, '');
  }

  lines.push('---', '', `Total tokens: ${totalTokens}`);

  await ensureDir(OUTPUT_DIR);
  await writeFile(
    resolve(OUTPUT_DIR, 'classify-tags.md'),
    lines.join('\n'),
    'utf-8',
  );

  console.log(`Total tokens: ${totalTokens}`);
  console.log('Output saved: playground/output/classify-tags.md\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
