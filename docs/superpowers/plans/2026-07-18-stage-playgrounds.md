# 단계별 플레이그라운드 구현 계획

> **에이전트 작업자 필수 하위 스킬:** 이 계획을 작업 단위로 구현할 때 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`를 사용한다. 진행 상태는 체크박스(`- [ ]`)로 추적한다.

**목표:** 뉴스레터의 네 LLM 단계를 독립 JSON 입력과 실제 `PromptBuilder` 함수로 실행하고 결과를 재사용 가능한 파일로 저장한다.

**아키텍처:** `playground/_shared.ts`가 단계별 JSON 검증, 모델 생성, 선택적 프롬프트 모듈 로딩을 담당한다. 네 진입점은 운영 LLM Query 클래스를 직접 생성하며 분석 결과는 JSON, 뉴스레터 결과는 Markdown/HTML/JSON으로 저장한다.

**기술 스택:** TypeScript ESM, Node.js 24, Zod 4, Vitest 4, AI SDK 7, tsx

## 전역 제약

- 공개 provider 인터페이스와 운영 Query 동작을 변경하지 않는다.
- 프롬프트 함수에는 운영 환경과 같은 context 객체를 전달한다.
- 주입한 `system` 또는 `user`는 해당 내장 프롬프트를 완전히 대체한다.
- 프롬프트 파일이나 개별 함수가 없으면 해당 내장 프롬프트를 사용한다.
- JSON 전용 프롬프트 템플릿 문법은 추가하지 않는다.
- 분석 단계 출력은 JSON으로 저장한다.
- 실제 LLM API 호출은 인증 정보와 비용이 필요하므로 자동 검증에서 제외한다.

---

### Task 1: 공통 JSON 검증과 프롬프트 로더

**Files:**

- Modify: `playground/_shared.ts`
- Create: `playground/_shared.test.ts`
- Create: `tsconfig.playground.json`
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `loadStageConfig<T>(fileName: string, schema: ZodType<T>, dataDir?: string): Promise<T>`
- Produces: `loadPromptBuilder<TContext>(stageName: string, dataDir?: string): Promise<PromptBuilder<TContext> | undefined>`
- Produces: `createModel(config: ModelConfig): LanguageModel`
- Produces: `PlaygroundQueryOptions = { content: { outputLanguage: string; expertField: string[] }; llm: { maxRetries: number } }`
- Produces: `createQueryOptions(config: CommonStageConfig): PlaygroundQueryOptions`
- Produces: 단계별 Zod schema와 `z.infer` 기반 입력 타입

- [ ] **Step 1: 실패하는 공통 helper 테스트 작성**

```ts
test('단계 JSON을 schema로 검증해 반환한다', async () => {
  const input = await loadStageConfig(
    'classify-tags.json',
    classifyTagsConfigSchema,
    fixtureDir,
  );
  expect(input.articles).toHaveLength(1);
});

test('필수 필드가 없으면 파일명을 포함한 검증 오류를 던진다', async () => {
  await expect(
    loadStageConfig('classify-tags.json', classifyTagsConfigSchema, fixtureDir),
  ).rejects.toThrow('classify-tags.json');
});

test('프롬프트 파일이 없으면 undefined를 반환한다', async () => {
  await expect(
    loadPromptBuilder('classify-tags', fixtureDir),
  ).resolves.toBeUndefined();
});

test('부분 PromptBuilder 모듈을 그대로 반환한다', async () => {
  const builder = await loadPromptBuilder('classify-tags', fixtureDir);
  expect(builder?.system?.({} as never)).toBe('custom system');
  expect(builder?.user).toBeUndefined();
});

test('잘못된 프롬프트 모듈은 명확히 실패한다', async () => {
  await expect(loadPromptBuilder('classify-tags', fixtureDir)).rejects.toThrow(
    'classify-tags',
  );
});
```

- [ ] **Step 2: 테스트가 기능 부재로 실패하는지 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/_shared.test.ts`

Expected: FAIL. `loadStageConfig`, 단계 schema 또는 `loadPromptBuilder`가 없다는 오류가 발생한다.

- [ ] **Step 3: 최소 공통 구현 작성**

`playground/_shared.ts`에 다음 구조를 구현한다.

```ts
const commonStageConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'togetherai']),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  outputLanguage: z.string().min(1),
  expertField: z.array(z.string().min(1)).min(1),
  maxRetries: z.number().int().nonnegative().optional(),
});

export async function loadStageConfig<T>(
  fileName: string,
  schema: z.ZodType<T>,
  dataDir = DATA_DIR,
): Promise<T> {
  const filePath = resolve(dataDir, fileName);
  try {
    return schema.parse(await loadJson<unknown>(filePath));
  } catch (error) {
    throw new Error(`[Playground] Invalid input: ${fileName}`, {
      cause: error,
    });
  }
}

export async function loadPromptBuilder<TContext>(
  stageName: string,
  dataDir = DATA_DIR,
): Promise<PromptBuilder<TContext> | undefined> {
  const filePath = resolve(dataDir, 'prompts', `${stageName}.ts`);
  try {
    await access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  const module = await import(
    `${pathToFileURL(filePath).href}?t=${Date.now()}`
  );
  const builder = module.default;
  const valid =
    builder &&
    (builder.system === undefined || typeof builder.system === 'function') &&
    (builder.user === undefined || typeof builder.user === 'function');
  if (!valid)
    throw new Error(`[Playground] Invalid prompt module: ${stageName}`);
  return builder as PromptBuilder<TContext>;
}
```

`vitest.config.ts`의 include에 `playground/**/*.test.ts`를 추가한다. `tsconfig.playground.json`은 루트 설정을 확장하고 `playground/**/*.ts`를 include하며 `noEmit`, `declaration: false`, Node/Vitest types를 설정한다. `package.json`에는 `typecheck:playground`를 추가한다.

- [ ] **Step 4: 공통 테스트와 타입 검사 통과 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/_shared.test.ts`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck:playground`

Expected: PASS.

- [ ] **Step 5: Task 1 변경 커밋**

```bash
git add playground/_shared.ts playground/_shared.test.ts tsconfig.playground.json vitest.config.ts package.json
git commit -m "test: cover playground config and prompt loading"
```

### Task 2: 세 분석 단계 실행기와 예제 입력

**Files:**

- Modify: `playground/classify-tags.ts`
- Modify: `playground/analyze-images.ts`
- Modify: `playground/determine-importance.ts`
- Create: `playground/_outputs.ts`
- Create: `playground/data-examples/classify-tags.example.json`
- Create: `playground/data-examples/analyze-images.example.json`
- Create: `playground/data-examples/determine-importance.example.json`
- Create: `playground/data-examples/prompts/classify-tags.example.ts`
- Create: `playground/data-examples/prompts/analyze-images.example.ts`
- Create: `playground/data-examples/prompts/determine-importance.example.ts`
- Create: `playground/analysis-output.test.ts`

**Interfaces:**

- Consumes: Task 1의 단계 schema, `loadStageConfig`, `loadPromptBuilder`, `createModel`, `createQueryOptions`
- Produces: `playground/output/classify-tags.json`
- Produces: `playground/output/analyze-images.json`
- Produces: `playground/output/determine-importance.json`
- Produces: `_outputs.ts`의 `createClassifyTagsOutput`, `createAnalyzeImagesOutput`, `createImportanceOutput`

- [ ] **Step 1: 실패하는 분석 결과 직렬화 테스트 작성**

```ts
test('태그 결과를 재사용 가능한 JSON 구조로 만든다', () => {
  expect(createClassifyTagsOutput(article, result, usage)).toEqual({
    articleId: article.id,
    title: article.title,
    tags: [result.tag1, result.tag2, result.tag3],
    usage,
  });
});

test('이미지 없는 기사는 skipped JSON 결과로 만든다', () => {
  expect(createAnalyzeImagesOutput(article, null, usage)).toMatchObject({
    articleId: article.id,
    imageContext: null,
    skipped: true,
  });
});

test('중요도 결과에 1-10 점수를 보존한다', () => {
  expect(createImportanceOutput(article, 8, usage)).toMatchObject({
    articleId: article.id,
    importanceScore: 8,
  });
});
```

- [ ] **Step 2: 테스트가 결과 helper 부재로 실패하는지 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/analysis-output.test.ts`

Expected: FAIL. 세 결과 helper가 export되지 않았다는 오류가 발생한다.

- [ ] **Step 3: 분석 실행기와 JSON 출력 구현**

각 실행기는 단계 전용 JSON과 프롬프트를 불러오고 운영 Query를 직접 실행한다. 결과 직렬화 helper는 부작용 없는 `_outputs.ts`에 두어 테스트에서 실행기 `main()`을 호출하지 않고 검증한다.

```ts
const config = await loadStageConfig(
  'determine-importance.json',
  determineImportanceConfigSchema,
);
const promptBuilder = await loadPromptBuilder<DetermineImportancePromptContext>(
  'determine-importance',
);

const outputs = [];
for (const article of config.articles) {
  const query = new DetermineArticleImportance({
    model,
    logger: consoleLogger,
    taskId,
    loggingExecutor,
    options: createQueryOptions(config),
    targetArticle: article,
    dateService,
    minimumImportanceScoreRules: config.minimumImportanceScoreRules,
    promptBuilder,
  });
  const { result, usage } = await query.execute();
  outputs.push(createImportanceOutput(article, result, usage));
}
await writeJson(resolve(OUTPUT_DIR, 'determine-importance.json'), outputs);
```

태그와 이미지 단계도 같은 방식으로 해당 Query와 단계 schema를 사용한다. 예제 프롬프트 파일은 각각 정확한 `PromptBuilder<...PromptContext>` 타입을 선언하고 `system`과 `user` 함수를 모두 보여준다.

- [ ] **Step 4: 분석 테스트, JSON 파싱, 타입 검사 통과 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/analysis-output.test.ts`

Expected: PASS.

Run: `jq empty playground/data-examples/classify-tags.example.json playground/data-examples/analyze-images.example.json playground/data-examples/determine-importance.example.json`

Expected: exit code 0.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck:playground`

Expected: PASS.

- [ ] **Step 5: Task 2 변경 커밋**

```bash
git add playground/classify-tags.ts playground/analyze-images.ts playground/determine-importance.ts playground/_outputs.ts playground/analysis-output.test.ts playground/data-examples
git commit -m "feat: add isolated analysis playgrounds"
```

### Task 3: 뉴스레터 생성 실행기와 생성 옵션

**Files:**

- Modify: `playground/generate-newsletter.ts`
- Modify: `playground/_outputs.ts`
- Create: `playground/data-examples/generate-newsletter.example.json`
- Create: `playground/data-examples/prompts/generate-newsletter.example.ts`
- Create: `playground/generate-newsletter-output.test.ts`

**Interfaces:**

- Consumes: Task 1의 `generateNewsletterConfigSchema`, `loadStageConfig`, `loadPromptBuilder`, `createModel`
- Produces: `playground/output/newsletter.md`
- Produces: `playground/output/newsletter.html`
- Produces: `playground/output/usage.json`
- Produces: `_outputs.ts`의 `renderNewsletterOutput`, `createUsageOutput`

- [ ] **Step 1: 실패하는 뉴스레터 렌더링 테스트 작성**

```ts
test('생성 결과를 Markdown frontmatter와 HTML 템플릿에 적용한다', () => {
  const output = renderNewsletterOutput(
    { title: '주간 AI 뉴스레터 제목', content: '## 브리핑\n본문' },
    '<html><title>{{title}}</title><body>{{content}}</body></html>',
    { title: 'title', content: 'content' },
  );

  expect(output.markdown).toContain('title: "주간 AI 뉴스레터 제목"');
  expect(output.html).toContain('<title>주간 AI 뉴스레터 제목</title>');
  expect(output.html).toContain('<h2>브리핑</h2>');
});

test('토큰 사용량을 JSON으로 보존한다', () => {
  expect(createUsageOutput(config, usage)).toEqual({
    provider: config.provider,
    model: config.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });
});
```

- [ ] **Step 2: 테스트가 출력 helper 부재로 실패하는지 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/generate-newsletter-output.test.ts`

Expected: FAIL. `renderNewsletterOutput` 또는 `createUsageOutput`이 없다는 오류가 발생한다.

- [ ] **Step 3: 뉴스레터 실행기와 생성 옵션 전달 구현**

`generate-newsletter.json`에서 `maxOutputTokens`, `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`를 검증해 운영 Query 생성자에 그대로 전달한다.

```ts
const query = new GenerateNewsletter({
  model,
  logger: consoleLogger,
  taskId,
  loggingExecutor,
  options: createQueryOptions(config),
  maxOutputTokens: config.maxOutputTokens,
  temperature: config.temperature,
  topP: config.topP,
  topK: config.topK,
  presencePenalty: config.presencePenalty,
  frequencyPenalty: config.frequencyPenalty,
  targetArticles: config.articles,
  dateService,
  subscribePageUrl: config.subscribePageUrl,
  newsletterBrandName: config.newsletterBrandName,
  promptBuilder,
});
```

`templatePath`는 저장소 루트 기준으로 읽는다. 부작용 없는 `_outputs.ts`의 `renderNewsletterOutput`에서 Markdown 변환, 템플릿 marker 치환, CSS inline 처리를 수행한다. 결과와 토큰 사용량은 각각 정해진 파일에 저장한다.

- [ ] **Step 4: 뉴스레터 테스트, JSON 파싱, 타입 검사 통과 확인**

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run playground/generate-newsletter-output.test.ts`

Expected: PASS.

Run: `jq empty playground/data-examples/generate-newsletter.example.json`

Expected: exit code 0.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck:playground`

Expected: PASS.

- [ ] **Step 5: Task 3 변경 커밋**

```bash
git add playground/generate-newsletter.ts playground/_outputs.ts playground/generate-newsletter-output.test.ts playground/data-examples/generate-newsletter.example.json playground/data-examples/prompts/generate-newsletter.example.ts
git commit -m "feat: add newsletter generation playground"
```

### Task 4: 사용 문서와 전체 검증

**Files:**

- Modify: `README.md`
- Delete: `playground/data-examples/config.example.json`
- Delete: `playground/data-examples/articles.example.json`
- Delete: `playground/data-examples/prompts.example.ts`

**Interfaces:**

- Consumes: Tasks 1-3의 package scripts, 단계별 예제 파일, 출력 파일명
- Produces: 단계별 setup, prompt 주입, 실행, 출력 사용법

- [ ] **Step 1: README의 기존 공용 입력 안내가 새 파일 구조와 불일치하는지 확인**

Run: `rg -n "config\.example|articles\.example|prompts\.example|classify-tags\.md|usage\.md" README.md playground/data-examples`

Expected: 기존 공용 파일과 Markdown 분석 출력에 대한 참조가 검색된다.

- [ ] **Step 2: README를 단계별 파일 구조로 갱신**

README에 다음 setup 명령과 동작을 명시한다.

```bash
mkdir -p playground/data/prompts
cp playground/data-examples/classify-tags.example.json playground/data/classify-tags.json
cp playground/data-examples/analyze-images.example.json playground/data/analyze-images.json
cp playground/data-examples/determine-importance.example.json playground/data/determine-importance.json
cp playground/data-examples/generate-newsletter.example.json playground/data/generate-newsletter.json
cp playground/data-examples/prompts/*.example.ts playground/data/prompts/
```

복사된 prompt 파일은 `.example`을 제거한 이름이어야 하므로 실제 문서에서는 각 파일별 목적 경로를 명시한 `cp` 명령을 사용한다. 프롬프트 파일은 선택 사항이고, 함수가 생략된 부분은 기본 프롬프트를 사용하며, 주입된 함수는 기본 프롬프트를 완전히 대체한다고 설명한다. 기존 공용 예제 세 개는 삭제한다.

- [ ] **Step 3: 문서 참조와 정적 검증 확인**

Run: `rg -n "config\.example|articles\.example|prompts\.example|classify-tags\.md|usage\.md" README.md playground/data-examples`

Expected: exit code 1. 제거된 파일과 출력에 대한 참조가 없다.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck:playground`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run lint`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm test`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npm run build`

Expected: PASS.

Run: `source ~/.nvm/nvm.sh && nvm use 24 && npx prettier --check README.md package.json vitest.config.ts tsconfig.playground.json playground docs/superpowers`

Expected: PASS.

- [ ] **Step 4: Task 4 변경 커밋**

```bash
git add README.md playground/data-examples
git commit -m "docs: document stage-specific playgrounds"
```
