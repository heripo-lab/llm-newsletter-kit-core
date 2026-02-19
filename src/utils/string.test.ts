import { ensureHrBeforeH2, ensureStringArray } from './string';

describe('ensureStringArray', () => {
  test('wraps a non-empty string into an array with that string', () => {
    const input = 'hello';
    const result = ensureStringArray(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['hello']);
  });

  test('wraps an empty string into an array with empty string', () => {
    const input = '';
    const result = ensureStringArray(input);
    expect(result).toEqual(['']);
  });

  test('returns the same reference when given an array with values', () => {
    const arr = ['a', 'b'];
    const result = ensureStringArray(arr);
    expect(result).toBe(arr);
    expect(result).toEqual(['a', 'b']);
  });

  test('returns the same reference when given an empty array', () => {
    const arr: string[] = [];
    const result = ensureStringArray(arr);
    expect(result).toBe(arr);
    expect(result.length).toBe(0);
  });
});

describe('ensureHrBeforeH2', () => {
  test('inserts --- before ## when content exists before it', () => {
    const input = 'Hello\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('Hello\n---\n## Section');
  });

  test('does not duplicate --- when already present', () => {
    const input = 'Hello\n---\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('Hello\n---\n## Section');
  });

  test('does not insert --- before ## at the start of document', () => {
    const input = '## First Section\nContent';
    expect(ensureHrBeforeH2(input)).toBe('## First Section\nContent');
  });

  test('does not insert --- when only empty lines precede ##', () => {
    const input = '\n\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('\n\n## Section');
  });

  test('does not duplicate --- when --- is followed by empty lines before ##', () => {
    const input = 'Hello\n---\n\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('Hello\n---\n\n## Section');
  });

  test('handles multiple ## headings', () => {
    const input = '# Title\nIntro\n## A\nContent A\n## B\nContent B';
    expect(ensureHrBeforeH2(input)).toBe(
      '# Title\nIntro\n---\n## A\nContent A\n---\n## B\nContent B',
    );
  });

  test('returns unchanged text when no ## present', () => {
    const input = '# Title\nSome paragraph\n### Sub';
    expect(ensureHrBeforeH2(input)).toBe(input);
  });

  test('returns empty string unchanged', () => {
    expect(ensureHrBeforeH2('')).toBe('');
  });

  test('does not duplicate --- when <br> is between --- and ##', () => {
    const input = 'Hello\n---\n<br>\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('Hello\n---\n<br>\n## Section');
  });

  test('does not treat <br> as content for hasContentBefore', () => {
    const input = '<br>\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('<br>\n## Section');
  });

  test('handles <br/> and <br /> variants', () => {
    const input = 'Hello\n---\n<br/>\n## A\nBody\n---\n<BR />\n## B';
    expect(ensureHrBeforeH2(input)).toBe(
      'Hello\n---\n<br/>\n## A\nBody\n---\n<BR />\n## B',
    );
  });

  test('inserts --- before ## when <br> follows real content without ---', () => {
    const input = 'Hello\n<br>\n## Section';
    expect(ensureHrBeforeH2(input)).toBe('Hello\n<br>\n---\n## Section');
  });
});
