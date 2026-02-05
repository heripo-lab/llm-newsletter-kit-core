import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown) as string;

  const window = new JSDOM('').window;
  const purify = DOMPurify(window);
  const sanitized = purify.sanitize(html);
  const withCorrectedUrls = correctMalformedUrls(sanitized);
  const withTargetBlank = addTargetBlankToAnchors(withCorrectedUrls);
  const withDelReplaced = replaceDelTagsWithTilde(withTargetBlank);
  return correctUnconvertedBoldSyntax(withDelReplaced);
}

export default markdownToHtml;

function addTargetBlankToAnchors(htmlString: string): string {
  // DOMPurify removes target attributes, so we can safely add target="_blank" to all anchors
  return htmlString.replace(/<a\s+([^>]*)>/gi, (_match, attributes) => {
    return `<a ${attributes} target="_blank">`;
  });
}

function replaceDelTagsWithTilde(htmlString: string): string {
  // Replace opening and closing del tags with tilde (~)
  return htmlString.replace(/<del>/gi, '~').replace(/<\/del>/gi, '~');
}

function correctUnconvertedBoldSyntax(htmlString: string): string {
  // Replace unconverted "**text**" markdown syntax with <b> tags
  // Matches "**" followed by one or more non-asterisk characters, followed by "**"
  return htmlString.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

function correctMalformedUrls(htmlString: string): string {
  // Pattern matches anchors with `)` followed by optional closing markup (</b> or **) and URL-encoded characters
  // Capture groups:
  // 1: attributes before href
  // 2: URL base (before `)`)
  // 3: closing markup (</b> or ** or empty)
  // 4: URL-encoded part (starts with %)
  // 5: attributes after href
  // 6: link text base (before `)`)
  // 7: text after `)` in link text (may include **)
  const regex =
    /<a\s+([^>]*?)href="([^"]*?)\)((?:<\/b>|\*\*)?)(%[0-9A-Fa-f]{2}[^"]*?)"([^>]*?)>([^<]*?)\)((?:\*\*)?[^<]*?)<\/a>/g;

  return htmlString.replace(
    regex,
    (
      _match,
      beforeHref,
      urlBase,
      closingMarkup,
      _encodedPart,
      afterHref,
      textBase,
      textAfterClosingParen,
    ) => {
      // Remove leading ** from textAfterClosingParen since it's already captured as closingMarkup (</b>)
      const cleanedText = textAfterClosingParen.replace(/^\*\*/, '');
      return `<a ${beforeHref}href="${urlBase}"${afterHref}>${textBase}</a>${closingMarkup})${cleanedText}`;
    },
  );
}
