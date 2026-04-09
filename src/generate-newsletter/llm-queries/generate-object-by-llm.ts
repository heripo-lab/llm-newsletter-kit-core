import type { FinishReason, LanguageModelUsage } from 'ai';

import { Output, generateText } from 'ai';

type GenerateTextParams = Parameters<typeof generateText>[0];

type GenerateObjectByLLMParams<OBJECT> = Omit<
  GenerateTextParams,
  'output' | 'providerOptions'
> & {
  schema: Parameters<typeof Output.object<OBJECT>>[0]['schema'];
};

type GenerateObjectByLLMResult<OBJECT> = {
  output: OBJECT;
  usage: LanguageModelUsage;
  finishReason: FinishReason;
};

export async function generateObjectByLLM<OBJECT>({
  schema,
  ...rest
}: GenerateObjectByLLMParams<OBJECT>): Promise<
  GenerateObjectByLLMResult<OBJECT>
> {
  const result = await generateText({
    ...(rest as GenerateTextParams),
    output: Output.object({ schema }),
    // Anthropic truncates structured output when it contains quotation marks.
    // Using 'jsonTool' mode avoids this issue.
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'jsonTool',
      },
    },
  });

  return {
    output: result.output as OBJECT,
    usage: result.usage,
    finishReason: result.finishReason,
  };
}
