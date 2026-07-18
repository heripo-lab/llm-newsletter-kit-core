# Stage Playgrounds Design

## Goal

Provide an isolated playground for each LLM stage in the newsletter pipeline so custom prompts can be tested under conditions that closely match real `PromptProvider` injection.

The four playgrounds are:

1. `classifyTags`
2. `analyzeImages`
3. `determineImportance`
4. `generateNewsletter`

## Design Principles

- Each stage runs its production LLM query class directly.
- Each stage has its own JSON input file containing model configuration and stage input data.
- Custom prompts use typed TypeScript `PromptBuilder` functions, matching the public package API.
- Custom prompt functions receive the same context objects as production execution.
- A missing prompt file or omitted `system`/`user` function falls back to the built-in prompt for that part.
- A supplied prompt replaces the corresponding built-in prompt entirely.
- The playground does not introduce a JSON interpolation language because that would differ from the production API.

## File Layout

```text
playground/
├── _shared.ts
├── classify-tags.ts
├── analyze-images.ts
├── determine-importance.ts
├── generate-newsletter.ts
├── data/
│   ├── classify-tags.json
│   ├── analyze-images.json
│   ├── determine-importance.json
│   ├── generate-newsletter.json
│   └── prompts/
│       ├── classify-tags.ts
│       ├── analyze-images.ts
│       ├── determine-importance.ts
│       └── generate-newsletter.ts
└── data-examples/
    ├── classify-tags.example.json
    ├── analyze-images.example.json
    ├── determine-importance.example.json
    ├── generate-newsletter.example.json
    └── prompts/
        ├── classify-tags.example.ts
        ├── analyze-images.example.ts
        ├── determine-importance.example.ts
        └── generate-newsletter.example.ts
```

Generated files remain under `playground/output/`.

## Input Contracts

Every stage JSON contains a shared model section:

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4o-mini",
  "outputLanguage": "Korean",
  "expertField": ["AI"],
  "maxRetries": 3
}
```

Stage-specific fields are kept in the same file:

- `classify-tags.json`: `articles`, `existTags`
- `analyze-images.json`: `articles`
- `determine-importance.json`: `articles`, publication dates, optional `minimumImportanceScoreRules`
- `generate-newsletter.json`: `articles`, publication dates, brand and content options, generation options, and `templatePath`

The example JSON files contain complete runnable shapes with example credentials and representative articles. `templatePath` is resolved from the repository root and points to the existing HTML template file.

## Prompt Injection

Each prompt module exports the exact builder type used by the target query. For example:

```ts
import type {
  DetermineImportancePromptContext,
  PromptBuilder,
} from '@llm-newsletter-kit/core';

const prompt: PromptBuilder<DetermineImportancePromptContext> = {
  system: (context) => `...${context.expertFields.join(', ')}...`,
  user: (context) => `...${context.targetArticle.title}...`,
};

export default prompt;
```

The runner dynamically loads only its matching prompt module and passes it to the production query as `promptBuilder`. Prompt modules are optional. Partial overrides remain valid: supplying only `user` preserves the built-in `system` prompt, and vice versa.

## Execution Flow

For each script:

1. Load and validate the matching stage JSON.
2. Create the configured AI SDK model.
3. Load the optional typed prompt module for that stage.
4. Construct production dependencies such as `LoggingExecutor` and `DateService`.
5. Instantiate the production LLM query class directly.
6. Execute each input article, or the article collection for newsletter generation.
7. Print the active prompt mode and token usage.
8. Save a stage-specific result under `playground/output/`.

Package scripts expose one command per stage:

```text
npm run playground:classify-tags
npm run playground:analyze-images
npm run playground:determine-importance
npm run playground:generate-newsletter
```

## Outputs

- `classify-tags.json`: article identifiers and three assigned tags
- `analyze-images.json`: article identifiers and image context or a skipped result
- `determine-importance.json`: article identifiers and numeric scores
- `newsletter.md`, `newsletter.html`, and `usage.json`: final content and usage details

Machine-readable JSON is preferred for analysis-stage results so output from one stage can be reused in later experiments. Human-readable console summaries remain available during execution.

## Error Handling

- A missing stage JSON produces a message naming the exact example file to copy.
- Unsupported providers fail before an LLM request.
- Invalid JSON or missing required fields produces a stage-specific validation error.
- A missing optional prompt module uses built-in prompts and logs that choice.
- A malformed prompt module fails clearly instead of silently falling back.
- Image analysis reports skipped articles when no usable image is present.
- LLM and output-validation errors retain production query retry behavior.

## Verification

- Unit tests cover shared input validation and prompt module loading, including default and partial overrides.
- Playground entrypoints stay thin; behavior that can be tested without real API calls lives in shared helpers.
- Type-checking includes all playground TypeScript files and typed prompt examples.
- JSON examples are parsed during verification.
- Formatting and the repository test suite run before completion.
- Real API execution is optional because it requires user credentials and incurs external cost.

## Scope

This change does not alter public provider interfaces, production prompt behavior, crawling behavior, or the full pipeline orchestration. It only adds and documents isolated development runners around existing production query classes.
