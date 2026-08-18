/**
 * 커스텀 프롬프트(playground/data/prompts.ts)가 core 내장 기본 프롬프트와
 * 완전히 동일한 문자열을 만들어내는지 검증한다.
 *
 * LLM 을 호출하지 않고 렌더링된 프롬프트 문자열만 비교하므로 비용이 0 이다.
 *
 * heripo-research-radar 의 실제 두 가지 설정(일반 / KRAS)을 모두 재현해
 * 기본 프롬프트의 조건 분기(freeFormIntro, titleContext, minScore)를 전부 통과시킨다.
 *
 *   npm run playground:verify-prompts
 */
import { resolve } from 'node:path';

import AnalyzeImages from '~/generate-newsletter/llm-queries/analyze-images.llm';
import ClassifyTags from '~/generate-newsletter/llm-queries/classify-tags.llm';
import DetermineArticleImportance from '~/generate-newsletter/llm-queries/determine-article-importance.llm';
import GenerateNewsletter from '~/generate-newsletter/llm-queries/generate-newsletter.llm';
import type {
  ArticleForGenerateContent,
  UnscoredArticle,
} from '~/generate-newsletter/models/article';
import { LoggingExecutor } from '~/logging/logging-executor';

import {
  DATA_DIR,
  consoleLogger,
  createDateService,
  loadArticles,
  loadConfig,
  loadPromptProvider,
} from './_shared';

const KRAS_TARGET_URL = 'https://www.kras.or.kr/?r=kras&m=bbs&bid=notice';

/**
 * research-radar 가 core 로 넘기는 실제 설정 조합.
 * 기본 프롬프트의 모든 조건 분기를 덮도록 구성했다.
 */
const SCENARIOS = [
  {
    name: '일반 (문화유산 리서치 레이더)',
    expertField: ['문화유산'],
    freeFormIntro: undefined as boolean | undefined,
    titleContext: undefined as string | undefined,
    newsletterBrandName: '문화유산 리서치 레이더',
    subscribePageUrl: 'https://heripo.app/research-radar/subscribe',
    minimumImportanceScoreRules: [] as {
      targetUrl: string;
      minScore: number;
    }[],
    articleTargetUrl: 'https://www.khs.go.kr/notice',
  },
  {
    name: 'KRAS (한국고고학회 뉴스레터)',
    expertField: ['고고학 우선적 문화유산'],
    freeFormIntro: true,
    titleContext: '한국고고학회',
    newsletterBrandName: '한국고고학회 뉴스레터',
    subscribePageUrl: 'https://heripo.app/research-radar/subscribe',
    minimumImportanceScoreRules: [{ targetUrl: KRAS_TARGET_URL, minScore: 6 }],
    articleTargetUrl: KRAS_TARGET_URL,
  },
  {
    name: 'KRAS + minScore 미적용 기사 (HARD RULE 분기)',
    expertField: ['고고학 우선적 문화유산'],
    freeFormIntro: true,
    titleContext: '한국고고학회',
    newsletterBrandName: '한국고고학회 뉴스레터',
    subscribePageUrl: undefined as string | undefined,
    minimumImportanceScoreRules: [{ targetUrl: KRAS_TARGET_URL, minScore: 6 }],
    articleTargetUrl: 'https://www.kaah.kr/etc',
  },
];

type Case = { stage: string; kind: 'system' | 'user'; a: string; b: string };

function report(scenario: string, cases: Case[]): boolean {
  console.log(`\n▸ ${scenario}`);
  let allMatch = true;

  for (const { stage, kind, a, b } of cases) {
    const match = a === b;
    if (!match) allMatch = false;

    const label = `${stage} / ${kind}`.padEnd(36);
    console.log(
      `   ${match ? 'MATCH ' : 'DIFF  '} ${label} ${a.length} vs ${b.length}`,
    );

    if (!match) {
      const la = a.split('\n');
      const lb = b.split('\n');
      let shown = 0;
      for (let i = 0; i < Math.max(la.length, lb.length) && shown < 5; i++) {
        if (la[i] !== lb[i]) {
          console.log(
            `          L${i + 1} 기본  : ${JSON.stringify(la[i] ?? '(없음)')}`,
          );
          console.log(
            `          L${i + 1} 커스텀: ${JSON.stringify(lb[i] ?? '(없음)')}`,
          );
          shown++;
        }
      }
    }
  }

  return allMatch;
}

async function main() {
  const config = await loadConfig();
  const prompts = await loadPromptProvider();

  if (!prompts.analysis && !prompts.contentGenerate) {
    console.error(
      '\n[ERROR] playground/data/prompts.ts 가 없거나 비어 있습니다.\n' +
        '  cp playground/data-examples/prompts.example.ts playground/data/prompts.ts\n',
    );
    process.exit(1);
  }

  const articles = await loadArticles<UnscoredArticle[]>(
    resolve(DATA_DIR, 'articles.json'),
  );

  const taskId = 'verify-prompts';
  const loggingExecutor = new LoggingExecutor(consoleLogger, taskId);
  const dateService = createDateService(config.displayDate, config.isoDate);
  const existTags = config.existTags ?? ['발굴조사', '학술대회', '보존처리'];

  console.log(`\n기사 ${articles.length}건 / 발행일 ${config.isoDate}`);
  console.log(`existTags ${existTags.length}개`);
  console.log('='.repeat(70));

  let allPass = true;

  for (const s of SCENARIOS) {
    const article = {
      ...articles[0],
      targetUrl: s.articleTargetUrl,
    } as UnscoredArticle;

    const options = {
      content: {
        outputLanguage: config.outputLanguage,
        expertField: s.expertField,
        freeFormIntro: s.freeFormIntro,
        titleContext: s.titleContext,
      },
      llm: { maxRetries: config.maxRetries ?? 3 },
    };
    // model 은 프롬프트 렌더링에 관여하지 않으므로 더미로 충분하다
    const base = {
      model: {} as any,
      logger: consoleLogger,
      taskId,
      loggingExecutor,
      options,
    };

    const cases: Case[] = [];

    // ❶ classifyTags
    {
      const mk = (builder?: any) => {
        const q: any = new ClassifyTags({
          ...base,
          targetArticle: article,
          promptBuilder: builder,
        });
        q.existTags = existTags;
        return q;
      };
      const d = mk();
      const c = mk(prompts.analysis?.classifyTags);
      cases.push({
        stage: '❶ classifyTags',
        kind: 'system',
        a: d.systemPrompt,
        b: c.systemPrompt,
      });
      cases.push({
        stage: '❶ classifyTags',
        kind: 'user',
        a: d.userPrompt,
        b: c.userPrompt,
      });
    }

    // ❷ analyzeImages
    {
      const mk = (builder?: any) =>
        new AnalyzeImages({
          ...base,
          targetArticle: article,
          promptBuilder: builder,
        }) as any;
      const d = mk();
      const c = mk(prompts.analysis?.analyzeImages);
      cases.push({
        stage: '❷ analyzeImages',
        kind: 'system',
        a: d.systemPrompt,
        b: c.systemPrompt,
      });
      cases.push({
        stage: '❷ analyzeImages',
        kind: 'user',
        a: d.textMessage.text,
        b: c.textMessage.text,
      });
    }

    // ❸ determineImportance
    {
      const mk = (builder?: any) =>
        new DetermineArticleImportance({
          ...base,
          targetArticle: article,
          dateService,
          minimumImportanceScoreRules: s.minimumImportanceScoreRules,
          promptBuilder: builder,
        }) as any;
      const d = mk();
      const c = mk(prompts.analysis?.determineImportance);
      cases.push({
        stage: '❸ determineImportance',
        kind: 'system',
        a: d.systemPrompt,
        b: c.systemPrompt,
      });
      cases.push({
        stage: '❸ determineImportance',
        kind: 'user',
        a: d.userPrompt,
        b: c.userPrompt,
      });
    }

    // ❹ generateNewsletter
    {
      const mk = (builder?: any) =>
        new GenerateNewsletter({
          ...base,
          targetArticles: articles as ArticleForGenerateContent[],
          dateService,
          subscribePageUrl: s.subscribePageUrl as any,
          newsletterBrandName: s.newsletterBrandName,
          promptBuilder: builder,
        }) as any;
      const d = mk();
      const c = mk(prompts.contentGenerate?.generateNewsletter);
      cases.push({
        stage: '❹ generateNewsletter',
        kind: 'system',
        a: d.systemPrompt,
        b: c.systemPrompt,
      });
      cases.push({
        stage: '❹ generateNewsletter',
        kind: 'user',
        a: d.userPrompt,
        b: c.userPrompt,
      });
    }

    if (!report(s.name, cases)) allPass = false;
  }

  console.log('\n' + '='.repeat(70));
  console.log(
    allPass
      ? '전 시나리오 일치 — 커스텀 프롬프트가 기본 프롬프트와 완전히 동일합니다.\n'
      : '차이 있음 — 위 DIFF 항목을 확인하세요.\n',
  );
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
