import { Output, generateText } from 'ai';
import { z } from 'zod';

import { generateObjectByLLM } from './generate-object-by-llm';

const mockGenerateText = vi.mocked(generateText);

describe('generateObjectByLLM', () => {
  const schema = z.object({ title: z.string() });
  const model = {} as any;

  const mockResult = {
    output: { title: 'test' },
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    finishReason: 'stop' as const,
  };

  test('calls generateText with Output.object and anthropic providerOptions', async () => {
    mockGenerateText.mockResolvedValue(mockResult as any);

    const result = await generateObjectByLLM({
      model,
      schema,
      system: 'test system',
      prompt: 'test prompt',
      maxRetries: 3,
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        system: 'test system',
        prompt: 'test prompt',
        maxRetries: 3,
        output: Output.object({ schema }),
        providerOptions: {
          anthropic: {
            structuredOutputMode: 'jsonTool',
          },
        },
      }),
    );

    expect(result).toEqual({
      output: { title: 'test' },
      usage: mockResult.usage,
      finishReason: 'stop',
    });
  });

  test('separates schema from rest params and passes them correctly', async () => {
    mockGenerateText.mockResolvedValue(mockResult as any);

    await generateObjectByLLM({
      model,
      schema,
      prompt: 'test',
      temperature: 0.5,
      maxOutputTokens: 1000,
    });

    const calledWith = mockGenerateText.mock.calls[0][0] as any;

    expect(calledWith.schema).toBeUndefined();
    expect(calledWith.temperature).toBe(0.5);
    expect(calledWith.maxOutputTokens).toBe(1000);
  });
});
