# Contributing

Thank you for your interest in this project! This guide concisely explains local development, testing, code style, and the PR process.

## Development Environment
- Node.js: >= 22 (CI verified on 24.x)
- Package manager: npm (with package-lock.json)
- Language/Runtime: TypeScript, ESM (ES2022)

### Project Setup
```bash
npm ci
npm run typecheck
npm run build
npm test
```

### Useful Scripts
- Build: `npm run build` (Rollup, generates CJS/ESM/d.ts in dist)
- Test: `npm run test` / `npm run test:watch` / `npm run test:coverage`
- Coverage (CI mode): `npm run test:ci`
- Lint: `npm run lint` / auto fix `npm run lint:fix`
- Typecheck: `npm run typecheck`
- Format: `npm run format`

## Code Style
- ESLint (typescript-eslint), Prettier
- Import sorting: `@trivago/prettier-plugin-sort-imports`
- Before committing: run `npm run lint` `npm run typecheck` `npm test`

## Testing Guide
- Test runner: Vitest
- Environment: Node (`environment: 'node'`), ESM, globals `describe/test/expect/vi`
- Config: `vitest.config.ts`, global mocks in `vitest.setup.ts`
- File pattern: `src/**/*.{test,spec}.{ts,js,mjs}`
- Coverage: v8, threshold 100% (lines/functions/branches/statements)

### Mocking Principles
- Mock all side effects: network/file/process/time/randomness
- Do not re-`vi.mock` modules already mocked globally; instead control behavior with `vi.mocked(...).mockResolvedValue`/`mockRejectedValue`, etc.
  - `ai`, `@langchain/core/runnables`
  - `~/generate-newsletter/chains/{analysis,content-generate,crawling}.chain`
  - `~/logging/logging-executor`
- Path alias: `~/*` → `./src/*`
- Replace chainable APIs with minimal stubs matching only what's needed
- Make time/randomness deterministic (`Date.now`, `crypto.randomUUID`)

## Architecture / Public API
- Entry: `src/index.ts`
  - Default export: `GenerateNewsletter` class
  - Type exports: Crawling/Analysis/ContentGenerate providers, TaskService, DateService, EmailService, Newsletter, and domain models
- Main flow: Crawling → Analysis → ContentGenerate → Save → (optional) preview email
- All chains are connected via `@langchain/core/runnables` sequences

## Fork & Pull Request Workflow

### 1. Fork the Repository
Click "Fork" button on GitHub: https://github.com/heripo-lab/llm-newsletter-kit-core

### 2. Clone Your Fork
```bash
git clone https://github.com/YOUR_USERNAME/llm-newsletter-kit-core.git
cd llm-newsletter-kit-core
```

### 3. Add Upstream Remote
```bash
git remote add upstream https://github.com/heripo-lab/llm-newsletter-kit-core.git
git remote -v  # Verify: origin (your fork), upstream (original repo)
```

### 4. Create a Branch
```bash
git checkout -b feat/your-feature-name
# or: fix/bug-description, docs/update-readme, etc.
```

Branch naming: `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`

### 5. Make Changes & Test Locally
```bash
# Install dependencies
npm ci

# Make your changes, then verify:
npm run lint
npm run typecheck
npm run build
npm test

# Keep 100% coverage!
npm run test:coverage
```

### 6. Commit Your Changes
```bash
git add .
git commit -m "feat: add amazing feature"
```

Commit messages: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)

### 7. Push to Your Fork
```bash
git push origin feat/your-feature-name
```

### 8. Create Pull Request
1. Go to your fork on GitHub: `https://github.com/YOUR_USERNAME/llm-newsletter-kit-core`
2. Click "Compare & pull request" button
3. Base repository: `heripo-lab/llm-newsletter-kit-core` base: `main`
4. Head repository: `YOUR_USERNAME/llm-newsletter-kit-core` compare: `feat/your-feature-name`
5. Fill in PR template with description of changes
6. Submit!

### 9. Respond to Review Feedback
```bash
# Make requested changes
git add .
git commit -m "fix: address review feedback"
git push origin feat/your-feature-name

# PR will auto-update
```

### 10. Keep Your Fork Updated
```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

## PR Checklist
- [ ] Forked repo and created feature branch
- [ ] Add unit tests for features/fixes; keep coverage at 100%
- [ ] Pass locally: `npm run lint` `npm run typecheck` `npm run build` `npm test`
- [ ] Update README/docs if needed
- [ ] No external side-effect calls (use mocks)
- [ ] Add meaningful logging/error handling where appropriate
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains what/why/how

## Release (Maintainers)
- Version/Publish: `npm version {patch|minor|major}` → `npm publish --access public`
  - Scripts: `release:*` (auto build via `prepublishOnly`/`preversion`), `postversion` pushes tags
- Distribution artifacts: `dist` directory (exports: ESM/CJS/types)

## CI
- Location: `.github/workflows/ci.yml`
- Triggers: Pull Request, manual
- Steps: Lint → Typecheck → Build → Test (coverage) → upload dist/coverage artifacts
- Node version: 24.x

## Issues / Questions
- Please open GitHub Issues for bug reports/feature requests.
- Include reproduction steps, expected/actual results, logs/screenshots to speed up review.