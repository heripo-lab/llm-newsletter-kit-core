import type {
  AppLogger,
  DateService,
  MinimumImportanceScoreRule,
  PromptBuilder,
  PromptProvider,
} from '@llm-newsletter-kit/core';
import type { LanguageModel } from 'ai';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLAYGROUND_DIR = __dirname;
export const DATA_DIR = resolve(__dirname, 'data');
export const OUTPUT_DIR = resolve(__dirname, 'output');

export type ProviderName = 'openai' | 'anthropic' | 'google' | 'togetherai';

/** Pipeline stages that run an LLM query. */
export type PlaygroundStage =
  | 'classifyTags'
  | 'analyzeImages'
  | 'determineImportance'
  | 'generateNewsletter';

/**
 * Per-stage model override. Any omitted field falls back to the
 * top-level `provider` / `apiKey` / `model`.
 *
 * Real pipelines often mix providers — e.g. OpenAI for the analysis
 * stages and Anthropic for content generation.
 */
export type StageModelConfig = {
  provider?: ProviderName;
  apiKey?: string;
  model?: string;
};

/**
 * Sampling / output options forwarded to the newsletter generation query.
 * Omitted values fall back to the core defaults (temperature: 0.3, rest unset).
 */
export type GenerationOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
};

export type PlaygroundConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  /** Optional per-stage model overrides. */
  models?: Partial<Record<PlaygroundStage, StageModelConfig>>;
  /** Optional generation params for the newsletter generation stage. */
  generation?: GenerationOptions;
  outputLanguage: string;
  expertField: string[];
  freeFormIntro?: boolean;
  titleContext?: string;
  newsletterBrandName: string;
  subscribePageUrl?: string;
  displayDate: string;
  isoDate: string;
  maxRetries?: number;
  existTags?: string[];
  minimumImportanceScoreRules?: MinimumImportanceScoreRule[];
  templateMarkers: {
    title: string;
    content: string;
  };
};

export const consoleLogger: AppLogger = {
  info: (msg) => console.log('[INFO]', JSON.stringify(msg)),
  debug: (msg) => console.log('[DEBUG]', JSON.stringify(msg)),
  error: (msg) => console.error('[ERROR]', msg),
};

export function createDateService(
  displayDate: string,
  isoDate: string,
): DateService {
  return {
    getPublicationDisplayDateString: () => displayDate,
    getPublicationISODateString: () => isoDate,
  };
}

export async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Converts a snake_case DB dump (e.g. an export from heripo-research-radar)
 * into the camelCase shape core's UnscoredArticle / ArticleForGenerateContent expect.
 * Already-camelCase records (detailContent present) pass through unchanged.
 */
function toCamelArticle(raw: Record<string, any>): Record<string, any> {
  if (raw.detailContent !== undefined) return raw;

  return {
    ...raw,
    id: raw.id ?? raw.post_id ?? raw.uniq_id,
    detailContent: raw.detail_content,
    hasAttachedImage: raw.has_attached_image,
    imageContextByLlm: raw.image_context_by_llm,
    targetUrl: raw.target_url,
    importanceScore: raw.importance_score,
    contentType: raw.content_type,
    publishedDate: raw.date,
  };
}

/**
 * Loads playground/data/articles.json and normalizes snake_case DB dumps to
 * the camelCase shape core expects. Already-camelCase files pass through unchanged.
 */
export async function loadArticles<T>(filePath: string): Promise<T> {
  const raw = await loadJson<Record<string, any>[]>(filePath);
  return raw.map(toCamelArticle) as T;
}

export async function loadText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function loadConfig(): Promise<PlaygroundConfig> {
  try {
    return await loadJson<PlaygroundConfig>(resolve(DATA_DIR, 'config.json'));
  } catch {
    console.error(
      '\n[ERROR] playground/data/config.json not found.\n' +
        'Copy example files first:\n\n' +
        '  mkdir -p playground/data\n' +
        '  cp playground/data-examples/config.example.json playground/data/config.json\n' +
        '  cp playground/data-examples/articles.example.json playground/data/articles.json\n' +
        '  cp playground/data-examples/template.example.html playground/data/template.html\n' +
        '  # optional — custom LLM prompts per stage:\n' +
        '  cp playground/data-examples/prompts.example.ts playground/data/prompts.ts\n\n' +
        'Then edit playground/data/config.json with your API key.\n',
    );
    process.exit(1);
  }
}

/**
 * Resolves the effective provider / apiKey / model for a stage,
 * layering `config.models[stage]` over the top-level defaults.
 */
export function resolveStageModel(
  config: PlaygroundConfig,
  stage?: PlaygroundStage,
): Required<StageModelConfig> {
  const override = stage ? (config.models?.[stage] ?? {}) : {};

  return {
    provider: override.provider ?? config.provider ?? 'openai',
    apiKey: override.apiKey ?? config.apiKey,
    model: override.model ?? config.model,
  };
}

export function createModel(
  config: PlaygroundConfig,
  stage?: PlaygroundStage,
): LanguageModel {
  const { provider, apiKey, model } = resolveStageModel(config, stage);

  const providers = {
    openai: () => createOpenAI({ apiKey })(model),
    anthropic: () => createAnthropic({ apiKey })(model),
    google: () => createGoogleGenerativeAI({ apiKey })(model),
    togetherai: () => createTogetherAI({ apiKey })(model),
  };

  const createProviderModel = providers[provider];
  if (!createProviderModel) {
    console.error(
      `[ERROR] Unknown provider "${provider}". Use: ${Object.keys(providers).join(', ')}`,
    );
    process.exit(1);
  }

  if (!apiKey) {
    console.error(
      `[ERROR] No apiKey for stage "${stage ?? 'default'}" (provider: ${provider}).\n` +
        `Set "apiKey" at the top level, or under "models.${stage}" in config.json.`,
    );
    process.exit(1);
  }

  return createProviderModel();
}

/** `openai / gpt-5-mini` — for logging which model a stage actually uses. */
export function describeStageModel(
  config: PlaygroundConfig,
  stage?: PlaygroundStage,
): string {
  const { provider, model } = resolveStageModel(config, stage);
  const overridden = stage && config.models?.[stage] ? ' (override)' : '';
  return `${provider} / ${model}${overridden}`;
}

/**
 * Loads the optional custom prompt module (playground/data/prompts.ts).
 * Returns an empty provider when the file does not exist,
 * so every stage falls back to its built-in default prompt.
 */
export async function loadPromptProvider(): Promise<PromptProvider> {
  const promptsPath = resolve(DATA_DIR, 'prompts.ts');

  try {
    await access(promptsPath);
  } catch {
    return {};
  }

  const mod = await import(pathToFileURL(promptsPath).href);
  return (mod.default ?? {}) as PromptProvider;
}

export function describePromptBuilder(builder?: PromptBuilder<never>): string {
  if (!builder || (!builder.system && !builder.user)) {
    return 'built-in defaults (system + user)';
  }

  const system = builder.system ? 'custom' : 'default';
  const user = builder.user ? 'custom' : 'default';
  return `system: ${system} / user: ${user}`;
}
