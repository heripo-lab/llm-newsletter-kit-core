import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import AnalyzeImages from '~/generate-newsletter/llm-queries/analyze-images.llm';
import type { UnscoredArticle } from '~/generate-newsletter/models/article';
import { LoggingExecutor } from '~/logging/logging-executor';

import {
  DATA_DIR,
  OUTPUT_DIR,
  consoleLogger,
  createModel,
  describePromptBuilder,
  describeStageModel,
  ensureDir,
  loadArticles,
  loadConfig,
  loadPromptProvider,
} from './_shared';

async function main() {
  const config = await loadConfig();
  const articles = await loadArticles<UnscoredArticle[]>(
    resolve(DATA_DIR, 'articles.json'),
  );
  const prompts = await loadPromptProvider();
  const promptBuilder = prompts.analysis?.analyzeImages;

  console.log(`\nLoaded ${articles.length} articles`);
  console.log(`Model: ${describeStageModel(config, 'analyzeImages')}`);
  console.log('Note: this stage requires a multimodal model.');
  console.log(`Prompts: ${describePromptBuilder(promptBuilder)}\n`);

  const model = createModel(config, 'analyzeImages');
  const taskId = `playground-analyze-images-${Date.now()}`;
  const loggingExecutor = new LoggingExecutor(consoleLogger, taskId);
  const options = {
    content: {
      outputLanguage: config.outputLanguage,
      expertField: config.expertField,
    },
    llm: { maxRetries: config.maxRetries ?? 3 },
  };

  const lines: string[] = ['# Analyze Images Result', ''];
  let totalTokens = 0;

  for (const article of articles) {
    const query = new AnalyzeImages({
      model,
      logger: consoleLogger,
      taskId,
      loggingExecutor,
      options,
      targetArticle: article,
      promptBuilder,
    });

    const { result, usage } = await query.execute();
    totalTokens += usage.totalTokens ?? 0;

    console.log(`[${article.id}] ${article.title}`);
    if (result === null) {
      console.log('  → skipped (no attached image or no markdown image URL)\n');
      lines.push(
        `## [${article.id}] ${article.title}`,
        '',
        '_Skipped — no attached image or no markdown image URL in content._',
        '',
      );
      continue;
    }

    console.log(`  → ${result}\n`);
    lines.push(`## [${article.id}] ${article.title}`, '', result, '');
  }

  lines.push('---', '', `Total tokens: ${totalTokens}`);

  await ensureDir(OUTPUT_DIR);
  await writeFile(
    resolve(OUTPUT_DIR, 'analyze-images.md'),
    lines.join('\n'),
    'utf-8',
  );

  console.log(`Total tokens: ${totalTokens}`);
  console.log('Output saved: playground/output/analyze-images.md\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
