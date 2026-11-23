#!/usr/bin/env node
// CI-only release script, run by .github/workflows/release.yml.
// Order: bump → build → atomic push (commit + version tag) → npm publish.
// Level `none` republishes the current version without bumping; it is the
// recovery path when only the publish step failed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LEVELS = ['none', 'patch', 'minor', 'major'];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readVersion() {
  return JSON.parse(readFileSync('package.json', 'utf8')).version;
}

const level = process.argv[2];
if (!LEVELS.includes(level)) {
  fail(`Usage: node scripts/publish.mjs <${LEVELS.join('|')}>`);
}

const head = output('git', ['rev-parse', 'HEAD']);

if (level === 'none') {
  const version = readVersion();
  const versionTag = `v${version}`;
  let tagSha;
  try {
    tagSha = output('git', ['rev-parse', `refs/tags/${versionTag}^{commit}`]);
  } catch {
    fail(
      `Version tag ${versionTag} does not exist. Release a new version with patch instead.`,
    );
  }
  if (tagSha !== head) {
    fail(
      `Version tag ${versionTag} (${tagSha.slice(0, 7)}) differs from the current HEAD (${head.slice(0, 7)}). Release a new version with patch instead.`,
    );
  }

  run('npm', ['run', 'build']);
  run('npm', ['publish', '--access', 'public', '--ignore-scripts']);
  console.log(`Republished ${version}.`);
  process.exit(0);
}

run('npm', ['version', level, '--no-git-tag-version']);
const version = readVersion();
const versionTag = `v${version}`;

run('npm', ['run', 'build']);

run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', version]);
run('git', ['tag', '-a', versionTag, '-m', version]);
run('git', [
  'push',
  '--atomic',
  'origin',
  'HEAD:refs/heads/main',
  `refs/tags/${versionTag}`,
]);

// Already built above; skip prepublishOnly to avoid a second build.
run('npm', ['publish', '--access', 'public', '--ignore-scripts']);
console.log(`Released ${version}.`);
