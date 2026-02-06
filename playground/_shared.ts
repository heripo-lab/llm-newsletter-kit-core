import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppLogger, DateService } from '@llm-newsletter-kit/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLAYGROUND_DIR = __dirname;
export const DATA_DIR = resolve(__dirname, 'data');
export const OUTPUT_DIR = resolve(__dirname, 'output');

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
    getDisplayDateString: () => displayDate,
    getCurrentISODateString: () => isoDate,
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
