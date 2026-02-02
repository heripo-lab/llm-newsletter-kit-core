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
  // Regular expression to find '<a>' tags
  // This regex matches '<a>' tags that contain 'href' attribute and optionally other attributes
  // Excludes 'target="[^"]*"' to check if target attribute already exists
  const regex = /<a(\s+[^>]*?)?(?<!target="[^"]*")>/gi;

  // Use regex to find '<a>' tags and add 'target="_blank"'
  return htmlString.replace(regex, (_match, attributes) => {
    // Handle undefined attributes as empty string
    const currentAttributes = attributes || '';

    // Double check if target attribute exists (safety check for regex limitations)
    if (currentAttributes.includes('target=')) {
      return `<a${currentAttributes}>`; // If target attribute exists, return without modification
    } else {
      // Add target="_blank" attribute
      return `<a${currentAttributes} target="_blank">`;
    }
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
  // Pattern matches anchors with `)` followed by URL-encoded characters
  // Capture groups:
  // 1: attributes before href
  // 2: URL base (before `)`)
  // 3: URL-encoded part (starts with %)
  // 4: attributes after href
  // 5: link text base (before `)`)
  // 6: decoded text after `)` in link text
  const regex =
    /<a\s+([^>]*?)href="([^"]*?)\)(%[0-9A-Fa-f]{2}[^"]*?)"([^>]*?)>([^<]*?)\)([^<]*?)<\/a>/g;

  return htmlString.replace(
    regex,
    (
      _match,
      beforeHref,
      urlBase,
      _encodedPart,
      afterHref,
      textBase,
      decodedTextInLink,
    ) => {
      // The decoded text is already in the link text (decodedTextInLink)
      // We just need to move it outside the anchor along with the `)`
      return `<a ${beforeHref}href="${urlBase}"${afterHref}>${textBase}</a>)${decodedTextInLink}`;
    },
  );
}
