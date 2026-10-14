import { createOpenAI } from '@ai-sdk/openai';

import { extractArticleDeadlines } from './extract-article-deadlines';

// Exercise the installed SDK and OpenAI adapter. Only HTTP transport is mocked;
// no real API credentials or network requests are needed.
vi.unmock('ai');

const deadline = {
  type: 'deadline',
  title: 'Conference registration',
  kind: 'registration',
  date: '2026-11-13',
  time: null,
  endDate: null,
  endTime: null,
  timeZone: null,
  status: 'active',
  evidence: 'Registration closes 2026-11-13.',
};
const event = {
  ...deadline,
  type: 'event',
  title: 'Conference',
  kind: 'attendance',
  date: '2026-11-21',
  endDate: '2026-11-22',
  evidence: 'Conference: November 21–22, 2026.',
};
const article = {
  title: 'Conference',
  detailContent: `${deadline.evidence}\n${event.evidence}`,
};

test.each([false, true])(
  'OpenAI requests require all response keys with event opt-in %s',
  async (includeEvents) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (_url, init) => {
        const request = JSON.parse(init!.body as string);
        const format = request.text.format;
        expect(format.strict).toBe(true);
        const item = format.schema.properties.deadlines.items;
        expect([...item.required].sort()).toEqual(
          Object.keys(item.properties).sort(),
        );
        expect(item.required).toEqual(
          expect.arrayContaining(['type', 'endDate', 'endTime']),
        );
        expect(item.properties.endDate.anyOf).toContainEqual({ type: 'null' });
        expect(item.properties.endTime.anyOf).toContainEqual({ type: 'null' });
        return Response.json({
          id: 'test-response',
          status: 'completed',
          model: 'gpt-4o-mini',
          output: [
            {
              id: 'test-message',
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ deadlines: [deadline, event] }),
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        });
      });
    const model = createOpenAI({ apiKey: 'test-key', fetch })('gpt-4o-mini');
    const result = await extractArticleDeadlines({
      model,
      article,
      outputLanguage: 'English',
      includeEvents,
      maxRetries: 0,
    });
    const legacy = {
      title: deadline.title,
      kind: deadline.kind,
      date: deadline.date,
      time: null,
      timeZone: null,
      status: deadline.status,
      evidence: deadline.evidence,
    };
    expect(result.deadlines).toEqual(
      includeEvents ? [deadline, event] : [legacy],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
