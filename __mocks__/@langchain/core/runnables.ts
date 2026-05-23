// Manual mock for @langchain/core/runnables used across tests
// It merges behaviors needed by both generate-newsletter and crawling-chain tests.

// Internal state for assertions/control
const assignCalls: Array<Record<string, any>> = [];
const fromCalls: Array<any[]> = [];
let sequenceInvokeImpl: () => Promise<any> = async () =>
  'SEQUENCE_RESULT' as any;

// Utility to build a pipeline step from a mapping
// Each mapping entry is a function that receives the current context and returns a value for that key
// The step returns a new context with those computed keys
function makeStep(mapping: Record<string, (ctx: Record<string, any>) => any>) {
  return async (ctx: Record<string, any>) => {
    const out: Record<string, any> = { ...ctx };
    for (const [k, fn] of Object.entries(mapping)) {
      // If fn is a function, call with current out; otherwise assign value directly
      out[k] = typeof fn === 'function' ? await (fn as any)(out) : fn;
    }
    return out;
  };
}

// RunnablePassthrough.assign mock
function assign(mapping: Record<string, any>) {
  assignCalls.push(mapping);

  // steps start with initial mapping application
  const steps: Array<
    (ctx: Record<string, any>) => Promise<Record<string, any>>
  > = [makeStep(mapping as any)];

  const pipeline: any = {
    // Expose mapping keys directly so callers can access functions like top['group-1']()
    ...mapping,
    pipe(next: any) {
      // Support both passing a plain mapping object and another runnable pipeline
      if (next && typeof next.invoke === 'function') {
        steps.push(async (ctx: Record<string, any>) => {
          return await next.invoke(ctx);
        });
      } else {
        steps.push(
          makeStep(next as Record<string, (ctx: Record<string, any>) => any>),
        );
      }
      return pipeline;
    },
    withRetry() {
      // No-op for tests; just return the pipeline for chaining
      return pipeline;
    },
    async batch(inputs: Array<Record<string, any>>) {
      const results: Array<Record<string, any>> = [];
      for (const input of inputs) {
        let ctx: Record<string, any> = { ...input };
        for (const step of steps) {
          ctx = await step(ctx);
        }
        results.push(ctx);
      }
      return results;
    },
    // For tests that call invoke on assign result (generate-newsletter)
    async invoke(input: Record<string, any>) {
      let ctx: Record<string, any> = { ...(input || {}) };
      for (const step of steps) {
        ctx = await step(ctx);
      }
      return ctx;
    },
  };

  return pipeline;
}

// RunnableSequence.from mock
function from(steps: any[]) {
  fromCalls.push(steps);
  return {
    kind: 'sequence',
    steps,
    invoke: (_input: any) => sequenceInvokeImpl(),
  } as any;
}

// Testing helpers (named with __ to avoid conflicts)
export const __setSequenceInvoke = (impl: () => Promise<any>) => {
  sequenceInvokeImpl = impl;
};
export const __getAssignCalls = () => assignCalls;
export const __getFromCalls = () => fromCalls;
export const __resetRunnables = () => {
  assignCalls.length = 0;
  fromCalls.length = 0;
  sequenceInvokeImpl = async () => 'SEQUENCE_RESULT' as any;
};

// Public API of the mocked module
export const RunnablePassthrough = { assign };
export const RunnableSequence = { from };

export default {} as any;
