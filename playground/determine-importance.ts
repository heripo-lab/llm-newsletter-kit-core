import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import DetermineArticleImportance from '~/generate-newsletter/llm-queries/determine-article-importance.llm';
import type { UnscoredArticle } from '~/generate-newsletter/models/article';
import { LoggingExecutor } from '~/logging/logging-executor';

import {
  DATA_DIR,
  OUTPUT_DIR,
  consoleLogger,
  createDateService,
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
  const promptBuilder = prompts.analysis?.determineImportance;

  console.log(`\nLoaded ${articles.length} articles`);
  console.log(`Provider: ${config.provider ?? 'openai'} / ${config.model}`);
  console.log(`Publication date: ${config.isoDate}`);
  console.log(`Prompts: ${describePromptBuilder(promptBuilder)}\n`);

  const model = createModel(config);
  const taskId = `playground-determine-importance-${Date.now()}`;
  const loggingExecutor = new LoggingExecutor(consoleLogger, taskId);
  const dateService = createDateService(config.displayDate, config.isoDate);
  const options = {
    content: {
      outputLanguage: config.outputLanguage,
      expertField: config.expertField,
    },
    llm: { maxRetries: config.maxRetries ?? 3 },
  };

  const lines: string[] = [
    '# Determine Importance Result',
    '',
    '| Id | Title | Score |',
    '|----|-------|-------|',
  ];
  let totalTokens = 0;

  for (const article of articles) {
    const query = new DetermineArticleImportance({
      model,
      logger: consoleLogger,
      taskId,
      loggingExecutor,
      options,
      targetArticle: article,
      dateService,
      minimumImportanceScoreRules: config.minimumImportanceScoreRules,
      promptBuilder,
    });

    const { result, usage } = await query.execute();
    totalTokens += usage.totalTokens ?? 0;

    console.log(`[${article.id}] ${article.title}`);
    console.log(`  → ${result}/10\n`);

    lines.push(`| ${article.id} | ${article.title} | ${result}/10 |`);
  }

  lines.push('', '---', '', `Total tokens: ${totalTokens}`);

  await ensureDir(OUTPUT_DIR);
  await writeFile(
    resolve(OUTPUT_DIR, 'determine-importance.md'),
    lines.join('\n'),
    'utf-8',
  );

  console.log(`Total tokens: ${totalTokens}`);
  console.log('Output saved: playground/output/determine-importance.md\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
