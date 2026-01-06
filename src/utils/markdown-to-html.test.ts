import DOMPurifyFactory from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

import markdownToHtml from './markdown-to-html';

vi.mock('marked');
vi.mock('jsdom');
vi.mock('dompurify');

describe('markdownToHtml', () => {
  const mockWindow = {
    document: {},
  };
  const mockPurify = {
    sanitize: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(JSDOM).mockReturnValue({
      window: mockWindow,
    } as unknown as JSDOM);
    vi.mocked(DOMPurifyFactory).mockReturnValue(
      mockPurify as unknown as ReturnType<typeof DOMPurifyFactory>,
    );
  });

  test('should convert markdown to HTML and add target="_blank" to anchors', () => {
    const markdown = '[example](https://example.com)';
    const parsedHtml = '<a href="https://example.com">example</a>';
    const sanitizedHtml = '<a href="https://example.com">example</a>';

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(marked.parse).toHaveBeenCalledWith(markdown);
    expect(JSDOM).toHaveBeenCalledWith('');
    expect(DOMPurifyFactory).toHaveBeenCalledWith(mockWindow);
    expect(mockPurify.sanitize).toHaveBeenCalledWith(parsedHtml);
    expect(result).toBe(
      '<a href="https://example.com" target="_blank">example</a>',
    );
  });

  test('should handle empty markdown string', () => {
    const markdown = '';
    const parsedHtml = '';
    const sanitizedHtml = '';

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('');
  });

  test('should sanitize potentially malicious HTML', () => {
    const markdown = '<script>alert("xss")</script>';
    const parsedHtml = '<script>alert("xss")</script>';
    const sanitizedHtml = '';

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(mockPurify.sanitize).toHaveBeenCalledWith(parsedHtml);
    expect(result).toBe('');
  });

  test('should add target="_blank" to multiple anchors without target attribute', () => {
    const markdown =
      '[link1](https://example1.com) [link2](https://example2.com)';
    const parsedHtml =
      '<a href="https://example1.com">link1</a> <a href="https://example2.com">link2</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example1.com" target="_blank">link1</a> <a href="https://example2.com" target="_blank">link2</a>',
    );
  });

  test('should preserve existing target attribute', () => {
    const markdown = '[link](https://example.com)';
    const parsedHtml = '<a href="https://example.com" target="_self">link</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example.com" target="_self">link</a>',
    );
  });

  test('should handle anchors with multiple attributes', () => {
    const markdown = '[link](https://example.com)';
    const parsedHtml =
      '<a href="https://example.com" class="link" id="main-link">link</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example.com" class="link" id="main-link" target="_blank">link</a>',
    );
  });

  test('should handle anchors without attributes except href', () => {
    const markdown = '[link](https://example.com)';
    const parsedHtml = '<a>link</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<a target="_blank">link</a>');
  });

  test('should handle mixed anchors with and without target attribute', () => {
    const markdown =
      '[link1](https://example1.com) [link2](https://example2.com)';
    const parsedHtml =
      '<a href="https://example1.com">link1</a> <a href="https://example2.com" target="_parent">link2</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example1.com" target="_blank">link1</a> <a href="https://example2.com" target="_parent">link2</a>',
    );
  });

  test('should handle HTML without anchors', () => {
    const markdown = '# Heading\n\nParagraph text';
    const parsedHtml = '<h1>Heading</h1>\n<p>Paragraph text</p>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<h1>Heading</h1>\n<p>Paragraph text</p>');
  });

  test('should handle anchor with single-quoted target attribute (regex edge case)', () => {
    const markdown = '[link](https://example.com)';
    const parsedHtml =
      '<a href="https://example.com" target=\'_blank\'>link</a>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example.com" target=\'_blank\'>link</a>',
    );
  });

  test('should replace del tags with tilde', () => {
    const markdown = '~~strikethrough text~~';
    const parsedHtml = '<del>strikethrough text</del>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('~strikethrough text~');
  });

  test('should replace multiple del tags with tildes', () => {
    const markdown = '~~first~~ and ~~second~~';
    const parsedHtml = '<del>first</del> and <del>second</del>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('~first~ and ~second~');
  });

  test('should replace DEL tags with case-insensitive matching', () => {
    const markdown = '~~text~~';
    const parsedHtml = '<DEL>text</DEL>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('~text~');
  });

  test('should handle mixed content with del tags and anchors', () => {
    const markdown = '[link](https://example.com) with ~~strikethrough~~';
    const parsedHtml =
      '<a href="https://example.com">link</a> with <del>strikethrough</del>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<a href="https://example.com" target="_blank">link</a> with ~strikethrough~',
    );
  });

  test('should convert unconverted ** markdown syntax to <b> tags', () => {
    const markdown = '**bold text**';
    const parsedHtml = '**bold text**';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<b>bold text</b>');
  });

  test('should convert multiple unconverted ** markdown syntax to <b> tags', () => {
    const markdown = '**first** and **second**';
    const parsedHtml = '**first** and **second**';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<b>first</b> and <b>second</b>');
  });

  test('should handle mixed converted and unconverted bold syntax', () => {
    const markdown = '**unconverted** and <strong>converted</strong>';
    const parsedHtml = '**unconverted** and <strong>converted</strong>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<b>unconverted</b> and <strong>converted</strong>');
  });

  test('should handle unconverted bold syntax with anchors and del tags', () => {
    const markdown = '**bold** [link](https://example.com) ~~strike~~';
    const parsedHtml =
      '**bold** <a href="https://example.com">link</a> <del>strike</del>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe(
      '<b>bold</b> <a href="https://example.com" target="_blank">link</a> ~strike~',
    );
  });

  test('should handle text with single asterisks (not bold)', () => {
    const markdown = '*italic* text';
    const parsedHtml = '*italic* text';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('*italic* text');
  });

  test('should handle unconverted bold with special characters', () => {
    const markdown = '**hello-world_123**';
    const parsedHtml = '**hello-world_123**';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<b>hello-world_123</b>');
  });

  test('should handle unconverted bold with spaces', () => {
    const markdown = '**multiple word bold**';
    const parsedHtml = '**multiple word bold**';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<b>multiple word bold</b>');
  });

  test('should not convert incomplete bold syntax with only opening **', () => {
    const markdown = '**incomplete bold';
    const parsedHtml = '**incomplete bold';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('**incomplete bold');
  });

  test('should not convert incomplete bold syntax with only closing **', () => {
    const markdown = 'incomplete bold**';
    const parsedHtml = 'incomplete bold**';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('incomplete bold**');
  });

  test('should handle unconverted bold within HTML tags', () => {
    const markdown = '<p>**bold in paragraph**</p>';
    const parsedHtml = '<p>**bold in paragraph**</p>';
    const sanitizedHtml = parsedHtml;

    vi.mocked(marked.parse).mockReturnValue(parsedHtml);
    mockPurify.sanitize.mockReturnValue(sanitizedHtml);

    const result = markdownToHtml(markdown);

    expect(result).toBe('<p><b>bold in paragraph</b></p>');
  });
});
