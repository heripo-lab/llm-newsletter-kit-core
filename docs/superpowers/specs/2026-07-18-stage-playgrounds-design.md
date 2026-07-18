# 단계별 플레이그라운드 설계

## 목표

뉴스레터 파이프라인의 각 LLM 단계를 독립적으로 실행하고, 실제 `PromptProvider` 주입 환경과 최대한 유사한 조건에서 커스텀 프롬프트를 테스트할 수 있는 플레이그라운드를 제공한다.

대상 플레이그라운드는 다음 네 가지다.

1. `classifyTags`
2. `analyzeImages`
3. `determineImportance`
4. `generateNewsletter`

## 설계 원칙

- 각 단계는 운영 코드에서 사용하는 LLM Query 클래스를 직접 실행한다.
- 각 단계는 모델 설정과 단계별 입력 데이터를 담은 독립 JSON 파일을 사용한다.
- 커스텀 프롬프트는 공개 패키지 API와 동일한 TypeScript `PromptBuilder` 함수를 사용한다.
- 커스텀 프롬프트 함수에는 운영 환경과 동일한 context 객체가 전달된다.
- 프롬프트 파일이 없거나 `system` 또는 `user` 함수가 생략되면 해당 프롬프트는 내장 기본값을 사용한다.
- 프롬프트를 주입하면 해당 내장 프롬프트를 완전히 대체한다.
- 운영 API와 다른 동작을 만들 수 있으므로 JSON 전용 템플릿 문법은 도입하지 않는다.

## 파일 구조

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

생성 결과는 기존과 동일하게 `playground/output/` 아래에 저장한다.

## 입력 규격

모든 단계별 JSON은 다음 공통 모델 설정을 포함한다.

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

단계별 필드는 같은 JSON 파일에 함께 둔다.

- `classify-tags.json`: `articles`, `existTags`
- `analyze-images.json`: `articles`
- `determine-importance.json`: `articles`, 발행일, 선택 항목인 `minimumImportanceScoreRules`
- `generate-newsletter.json`: `articles`, 발행일, 브랜드 및 콘텐츠 옵션, 생성 옵션, `templatePath`

예제 JSON 파일에는 예시 인증 정보와 대표 기사를 포함한 완전한 실행 형태를 제공한다. `templatePath`는 저장소 루트를 기준으로 해석하며 기존 HTML 템플릿 파일을 가리킨다.

## 프롬프트 주입

각 프롬프트 모듈은 대상 Query가 사용하는 것과 정확히 같은 builder 타입을 내보낸다. 예시는 다음과 같다.

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

실행기는 현재 단계에 해당하는 프롬프트 모듈만 동적으로 불러와 운영 Query의 `promptBuilder`로 전달한다. 프롬프트 모듈은 선택 사항이다. `user`만 주입하면 내장 `system` 프롬프트를 유지하고, `system`만 주입하면 내장 `user` 프롬프트를 유지하는 부분 재정의도 지원한다.

## 실행 흐름

각 스크립트는 다음 순서로 실행한다.

1. 현재 단계에 해당하는 JSON을 불러와 검증한다.
2. 설정된 AI SDK 모델을 생성한다.
3. 현재 단계의 선택적 타입 프롬프트 모듈을 불러온다.
4. `LoggingExecutor`, `DateService` 등 운영 의존성을 생성한다.
5. 운영 LLM Query 클래스를 직접 인스턴스화한다.
6. 분석 단계는 각 입력 기사를 실행하고, 뉴스레터 생성 단계는 전체 기사 목록을 실행한다.
7. 활성 프롬프트 종류와 토큰 사용량을 출력한다.
8. 단계별 결과를 `playground/output/`에 저장한다.

각 단계는 다음 package script로 실행한다.

```text
npm run playground:classify-tags
npm run playground:analyze-images
npm run playground:determine-importance
npm run playground:generate-newsletter
```

## 출력 결과

- `classify-tags.json`: 기사 식별자와 세 개의 분류 태그
- `analyze-images.json`: 기사 식별자와 이미지 맥락 또는 실행 생략 결과
- `determine-importance.json`: 기사 식별자와 숫자 중요도
- `newsletter.md`, `newsletter.html`, `usage.json`: 최종 콘텐츠와 토큰 사용량

분석 단계 결과는 다음 단계의 실험 입력으로 재사용할 수 있도록 기계가 읽을 수 있는 JSON을 사용한다. 실행 중에는 사람이 확인하기 쉬운 요약도 콘솔에 출력한다.

## 오류 처리

- 단계별 JSON이 없으면 복사해야 할 정확한 예제 파일명을 안내한다.
- 지원하지 않는 provider는 LLM 요청 전에 실패한다.
- JSON 형식이 잘못됐거나 필수 필드가 없으면 현재 단계를 명시한 검증 오류를 출력한다.
- 선택적인 프롬프트 모듈이 없으면 내장 프롬프트를 사용하고 그 사실을 로그로 남긴다.
- 프롬프트 모듈 형식이 잘못된 경우 조용히 기본값으로 전환하지 않고 명확히 실패한다.
- 이미지 분석에 사용할 이미지가 없으면 해당 기사가 생략됐음을 결과에 기록한다.
- LLM 및 출력 검증 오류에는 운영 Query의 재시도 동작을 그대로 적용한다.

## 검증

- 공통 입력 검증과 프롬프트 모듈 로딩을 단위 테스트로 검증한다. 기본 프롬프트와 부분 재정의도 포함한다.
- 플레이그라운드 진입점은 얇게 유지하고, 실제 API 호출 없이 검증할 수 있는 동작은 공통 helper로 분리한다.
- 모든 플레이그라운드 TypeScript 파일과 타입이 지정된 프롬프트 예제를 타입 검사에 포함한다.
- 검증 과정에서 모든 JSON 예제 파일을 파싱한다.
- 완료 전 포맷 검사와 저장소 전체 테스트를 실행한다.
- 실제 API 실행에는 사용자 인증 정보와 외부 비용이 필요하므로 필수 검증에서는 제외한다.

## 범위

공개 provider 인터페이스, 운영 프롬프트 동작, 크롤링 동작, 전체 파이프라인 오케스트레이션은 변경하지 않는다. 이번 변경은 기존 운영 Query 클래스를 독립적으로 실행하는 개발용 실행기와 관련 문서만 추가한다.
