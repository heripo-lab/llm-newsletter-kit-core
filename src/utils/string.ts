export const ensureStringArray = (value: string | string[]): string[] => {
  return typeof value === 'string' ? [value] : value;
};

const isBrTag = (value: string): boolean => /^<br\s*\/?>$/i.test(value);

export const ensureHrBeforeH2 = (markdown: string): string => {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let hasContentBefore = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (line.startsWith('## ') && hasContentBefore) {
      let alreadyHasHr = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const prev = result[i].trim();
        if (prev !== '' && !isBrTag(prev)) {
          alreadyHasHr = prev === '---';
          break;
        }
      }
      if (!alreadyHasHr) {
        result.push('---');
      }
    } else if (trimmed !== '' && trimmed !== '---' && !isBrTag(trimmed)) {
      hasContentBefore = true;
    }

    result.push(line);
  }

  return result.join('\n');
};
