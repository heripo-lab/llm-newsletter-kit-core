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

export type PlaygroundConfig = {
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

export function createModel(config: PlaygroundConfig): LanguageModel {
  const providers = {
    openai: () => createOpenAI({ apiKey: config.apiKey })(config.model),
    anthropic: () => createAnthropic({ apiKey: config.apiKey })(config.model),
    google: () =>
      createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model),
    togetherai: () => createTogetherAI({ apiKey: config.apiKey })(config.model),
  };

  const providerName = config.provider ?? 'openai';
  const createProviderModel = providers[providerName];
  if (!createProviderModel) {
    console.error(
      `[ERROR] Unknown provider "${providerName}". Use: ${Object.keys(providers).join(', ')}`,
    );
    process.exit(1);
  }

  return createProviderModel();
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

export function describePromptBuilder(
  builder?: PromptBuilder<never>,
): string {
  if (!builder || (!builder.system && !builder.user)) {
    return 'built-in defaults (system + user)';
  }

  const system = builder.system ? 'custom' : 'default';
  const user = builder.user ? 'custom' : 'default';
  return `system: ${system} / user: ${user}`;
}
