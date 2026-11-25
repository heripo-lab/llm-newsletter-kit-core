#!/usr/bin/env node
// CI-only release script, run by .github/workflows/release.yml.
// Order: bump → build → atomic push (commit + version tag) → npm stage publish.
// The trusted publisher is configured stage-only, so this script never puts a
// version on the registry by itself: it stages one, and a maintainer approves
// it with 2FA. Approval cannot be automated (npm requires proof of presence).
// Level `none` re-stages the current version without bumping; it is the
// recovery path when only the staging step failed. A version already pending
// approval must be rejected first, because npm refuses to stage a version that
// already exists as a staged version.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

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

// The run ends with the version staged, not published, so say what is left.
function reportStaged(version) {
  const message = `Staged ${version}. Approve it with 2FA to publish: \`npm stage list\` then \`npm stage approve <stage-id>\`, or the Staged Packages tab on npmjs.com.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  }
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
  run('npm', ['stage', 'publish', '--access', 'public', '--ignore-scripts']);
  reportStaged(version);
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
run('npm', ['stage', 'publish', '--access', 'public', '--ignore-scripts']);
reportStaged(version);
