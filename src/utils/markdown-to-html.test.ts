import markdownToHtml from './markdown-to-html';

describe('markdownToHtml', () => {
  test('should convert markdown to HTML and add target="_blank" to anchors', () => {
    const result = markdownToHtml('[example](https://example.com)');

    expect(result).toBe(
      '<p><a href="https://example.com" target="_blank">example</a></p>\n',
    );
  });

  test('should handle empty markdown string', () => {
    expect(markdownToHtml('')).toBe('');
  });

  test('should sanitize potentially malicious HTML', () => {
    const result = markdownToHtml('<script>alert("xss")</script>');

    expect(result).not.toContain('<script>');
  });

  test('should add target="_blank" to multiple anchors', () => {
    const result = markdownToHtml(
      '[link1](https://example1.com) [link2](https://example2.com)',
    );

    expect(result).toContain('target="_blank"');
    expect(result.match(/target="_blank"/g)).toHaveLength(2);
  });

  test('should handle anchors with multiple attributes', () => {
    const result = markdownToHtml('[link](https://example.com)');

    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
  });

  test('should handle HTML without anchors', () => {
    const result = markdownToHtml('# Heading\n\nParagraph text');

    expect(result).toContain('<h1>Heading</h1>');
    expect(result).toContain('<p>Paragraph text</p>');
  });

  test('should replace del tags with tilde', () => {
    const result = markdownToHtml('~~strikethrough text~~');

    expect(result).toBe('<p>~strikethrough text~</p>\n');
  });

  test('should replace multiple del tags with tildes', () => {
    const result = markdownToHtml('~~first~~ and ~~second~~');

    expect(result).toBe('<p>~first~ and ~second~</p>\n');
  });

  test('should handle mixed content with del tags and anchors', () => {
    const result = markdownToHtml(
      '[link](https://example.com) with ~~strikethrough~~',
    );

    expect(result).toContain('target="_blank"');
    expect(result).toContain('~strikethrough~');
  });

  test('should convert bold markdown syntax', () => {
    const result = markdownToHtml('**bold text**');

    expect(result).toContain('bold text');
  });

  test('should handle mixed bold and other elements', () => {
    const result = markdownToHtml(
      '**bold** [link](https://example.com) ~~strike~~',
    );

    expect(result).toContain('target="_blank"');
    expect(result).toContain('~strike~');
  });

  describe('correctMalformedUrls', () => {
    test('should fix URL with closing parenthesis and Korean text', () => {
      const result = markdownToHtml(
        "'무형유산지식새김'(https://iha.go.kr)으로 새 단장했습니다.",
      );

      expect(result).toBe(
        "<p>'무형유산지식새김'(<a href=\"https://iha.go.kr\" target=\"_blank\">https://iha.go.kr</a>)으로 새 단장했습니다.</p>\n",
      );
    });

    test('should fix multiple malformed URLs in same text', () => {
      const result = markdownToHtml(
        '(https://a.com)가 and (https://b.com)나',
      );

      expect(result).toContain(
        '<a href="https://a.com" target="_blank">https://a.com</a>)가',
      );
      expect(result).toContain(
        '<a href="https://b.com" target="_blank">https://b.com</a>)나',
      );
    });

    test('should not affect correctly formed URLs', () => {
      const result = markdownToHtml('text (https://example.com) more text');

      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('target="_blank"');
    });

    test('should handle URL with path followed by ) and non-ASCII text', () => {
      const result = markdownToHtml('(https://example.com/path)텍스트');

      expect(result).toContain(
        '<a href="https://example.com/path" target="_blank">https://example.com/path</a>)텍스트',
      );
    });

    test('should fix URL with closing parenthesis, bold markup and Korean text', () => {
      const result = markdownToHtml(
        '범부처통합연구지원시스템 **IRIS(http://www.iris.go.kr)**를 통해 접수·관리 시행',
      );

      expect(result).toBe(
        '<p>범부처통합연구지원시스템 <b>IRIS(<a href="http://www.iris.go.kr" target="_blank">http://www.iris.go.kr</a></b>)를 통해 접수·관리 시행</p>\n',
      );
    });
  });
});
