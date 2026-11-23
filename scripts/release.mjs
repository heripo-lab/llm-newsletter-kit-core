#!/usr/bin/env node
// Local release trigger. Pushes a `core-release-<level>-<timestamp>` tag;
// .github/workflows/release.yml performs bump, build, push, and publish.
import { execFileSync } from 'node:child_process';

const LEVELS = ['none', 'patch', 'minor', 'major'];
const TAG_PREFIX = 'core-release';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const level = process.argv[2];
if (!LEVELS.includes(level)) {
  fail(`Usage: node scripts/release.mjs <${LEVELS.join('|')}>`);
}

if (git('status', '--porcelain') !== '') {
  fail(
    'Working tree is not clean (including untracked files). Commit or remove changes first.',
  );
}

git('fetch', 'origin', 'main');
const head = git('rev-parse', 'HEAD');
const originMain = git('rev-parse', 'origin/main');
if (head !== originMain) {
  fail(
    `HEAD (${head.slice(0, 7)}) is not origin/main (${originMain.slice(0, 7)}). Check out and pull the latest main first.`,
  );
}

const timestamp = new Date()
  .toISOString()
  .replace(/\.\d{3}Z$/, '')
  .replace(/\D/g, '');
const tag = `${TAG_PREFIX}-${level}-${timestamp}`;

git('tag', tag, head);
try {
  execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], {
    stdio: 'inherit',
  });
} catch {
  git('tag', '-d', tag);
  fail(`Failed to push trigger tag ${tag}.`);
}

console.log(`\nPushed release trigger tag: ${tag}`);
console.log(
  'Follow progress at https://github.com/heripo-lab/llm-newsletter-kit-core/actions/workflows/release.yml',
);
