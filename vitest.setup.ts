import analysisChainMock from 'test/analysis-chain.mock';
import contentGenerateChainMock from 'test/content-generate-chain.mock';
import crawlingChainMock from 'test/crawling-chain.mock';
import { loggingExecutorMock } from 'test/logging-executor.mock';

vi.mock('ai');
vi.mock('@langchain/core/runnables');
vi.mock('~/generate-newsletter/chains/analysis.chain', () => analysisChainMock);
vi.mock(
  '~/generate-newsletter/chains/content-generate.chain',
  () => contentGenerateChainMock,
);
vi.mock('~/generate-newsletter/chains/crawling.chain', () => crawlingChainMock);
vi.mock('~/logging/logging-executor', () => loggingExecutorMock);
vi.mock('~/utils/string', async () => {
  return await vi.importActual('./src/utils/string');
});
vi.mock('~/utils/markdown-to-html', async () => ({
  default: vi.fn((s: string) => s),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
