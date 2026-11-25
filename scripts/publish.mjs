#!/usr/bin/env node
// CI-only release script, run by the `release` job of
// .github/workflows/release.yml.
// Order: bump → pack → atomic push (commit + version tag) → npm stage publish.
// It does not build. `dist` is produced by the workflow's `build` job and
// arrives here as an artifact, so that dependency and build-tool code never
// runs in the job holding the release token. This script therefore runs without
// `node_modules` and must stay that way: node builtins, git, `npm version`,
// `npm pack` and `npm stage publish` only.
// The trusted publisher is configured stage-only, so this script never puts a
// version on the registry by itself: it stages one, and a maintainer approves
// it with 2FA. Approval cannot be automated (npm requires proof of presence).
// Level `none` re-stages the current version without bumping; it is the
// recovery path when only the staging step failed. A version already pending
// approval must be rejected first, because npm refuses to stage a version that
// already exists as a staged version.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LEVELS = ['none', 'patch', 'minor', 'major'];

// What `package.json`'s `files` field publishes out of the build output. The
// tarball would pack happily without them — README, LICENSE and NOTICE alone
// make a valid-looking package — so their absence has to be an error here.
const BUILD_OUTPUT = ['dist/index.js', 'dist/index.d.ts'];

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

// `dist` crosses from the build job as an artifact. Check it before the bump,
// so a handoff that arrived empty or at an unexpected depth fails while another
// trigger tag can still release the version cleanly, rather than leaving a
// bumped version on main that only level `none` can finish.
function requireBuildOutput() {
  const missing = BUILD_OUTPUT.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    fail(
      `Missing build output: ${missing.join(', ')}. The build job's \`dist\` artifact did not arrive as expected.`,
    );
  }
}

// Publishing a tarball rather than the directory is what lets this job skip the
// install: `npm pack` reads `package.json` and the files it lists, and needs no
// `node_modules`. `--ignore-scripts` keeps it that way — there is no `prepack`
// or `prepare` script today, and one added later must not quietly become a
// build step in the job that holds the token.
function pack() {
  const destination = mkdtempSync(join(tmpdir(), 'core-pack-'));
  const packed = JSON.parse(
    output('npm', [
      'pack',
      '--ignore-scripts',
      '--pack-destination',
      destination,
      '--json',
    ]),
  );
  const filename = packed?.[0]?.filename;
  if (!filename) {
    fail('npm pack did not report a tarball.');
  }
  const tarball = join(destination, filename);
  if (!existsSync(tarball)) {
    fail(`npm pack reported ${filename}, but it is not in ${destination}.`);
  }
  return tarball;
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

requireBuildOutput();

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

  run('npm', [
    'stage',
    'publish',
    pack(),
    '--access',
    'public',
    '--ignore-scripts',
  ]);
  reportStaged(version);
  process.exit(0);
}

// `preversion` and `postversion` are deliberately absent from package.json, and
// `--ignore-scripts` holds that open: this job has no `node_modules` to run a
// version hook with, and `postversion`'s usual `git push --follow-tags` would
// push before the release commit exists.
run('npm', ['version', level, '--no-git-tag-version', '--ignore-scripts']);
const version = readVersion();
const versionTag = `v${version}`;

// Packed before anything is pushed, so that a packing failure leaves the bump
// local and the release recoverable with another trigger tag.
const tarball = pack();

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

// npm runs no lifecycle script of the current directory when it is handed a
// tarball, so `prepublishOnly` does not rebuild here; `--ignore-scripts` only
// makes sure a future npm cannot reintroduce a build into this job.
run('npm', [
  'stage',
  'publish',
  tarball,
  '--access',
  'public',
  '--ignore-scripts',
]);
reportStaged(version);
