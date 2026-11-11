/**
 * Markdown <-> Quill Delta conversion.
 *
 * Documents are stored as Quill Deltas (JSON), not HTML. Deltas are the editor's
 * native format, so formatting round-trips exactly and there is no stored-HTML
 * XSS surface to sanitise. Markdown is only used at the import/export boundary.
 */

const INLINE_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

function safeLink(url) {
  const value = String(url ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

function inlineOps(text) {
  const ops = [];
  let last = 0;

  for (const match of String(text).matchAll(INLINE_RE)) {
    if (match.index > last) ops.push({ insert: text.slice(last, match.index) });
    const token = match[0];
    let attributes = null;
    let value = token;

    if (token.startsWith('**')) {
      attributes = { bold: true };
      value = token.slice(2, -2);
    } else if (token.startsWith('__')) {
      attributes = { bold: true };
      value = token.slice(2, -2);
    } else if (token.startsWith('*')) {
      attributes = { italic: true };
      value = token.slice(1, -1);
    } else if (token.startsWith('_')) {
      attributes = { italic: true };
      value = token.slice(1, -1);
    } else if (token.startsWith('`')) {
      attributes = { code: true };
      value = token.slice(1, -1);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link ? safeLink(link[2]) : null;
      if (href) {
        attributes = { link: href };
        value = link[1];
      }
    }

    if (value) ops.push(attributes ? { insert: value, attributes } : { insert: value });
    last = match.index + token.length;
  }

  if (last < text.length) ops.push({ insert: text.slice(last) });
  return ops;
}

/** Convert basic Markdown (headings, lists, quotes, bold/italic/code/links) into a Delta. */
export function markdownToDelta(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const ops = [];
  let inCode = false;
  let codeLines = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        ops.push({ insert: `${codeLines.join('\n')}\n`, attributes: { 'code-block': true } });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(raw);
      continue;
    }

    if (!line.trim()) continue;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      ops.push(...inlineOps(heading[2]));
      ops.push({ insert: '\n', attributes: { header: heading[1].length } });
      continue;
    }

    if (/^\s*([-*_]){3,}\s*$/.test(line)) {
      ops.push({ insert: '\n', attributes: { divider: true } });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      ops.push(...inlineOps(bullet[1]));
      ops.push({ insert: '\n', attributes: { list: 'bullet' } });
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      ops.push(...inlineOps(ordered[1]));
      ops.push({ insert: '\n', attributes: { list: 'ordered' } });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      ops.push(...inlineOps(quote[1]));
      ops.push({ insert: '\n', attributes: { blockquote: true } });
      continue;
    }

    ops.push(...inlineOps(line));
    ops.push({ insert: '\n' });
  }

  if (inCode && codeLines.length) {
    ops.push({ insert: `${codeLines.join('\n')}\n`, attributes: { 'code-block': true } });
  }
  if (ops.length === 0) ops.push({ insert: '\n' });

  return { ops };
}

/** Convert a plain text file into one paragraph per line. */
export function plainTextToDelta(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n');
  const ops = [];

  for (const line of lines) {
    ops.push({ insert: line });
    ops.push({ insert: '\n' });
  }
  if (ops.length === 0) ops.push({ insert: '\n' });

  return { ops };
}

/** Plain-text preview used by document lists. */
export function deltaToText(content) {
  const ops = content && Array.isArray(content.ops) ? content.ops : [];
  let text = '';
  for (const op of ops) {
    if (typeof op.insert === 'string') text += op.insert;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function formatInline(text, attributes) {
  let out = text;
  if (attributes.code) out = `\`${out}\``;
  if (attributes.italic) out = `*${out}*`;
  if (attributes.bold) out = `**${out}**`;
  if (attributes.underline) out = `<u>${out}</u>`;
  if (attributes.strike) out = `~~${out}~~`;
  if (attributes.link) out = `[${out}](${attributes.link})`;
  return out;
}

/** Export a Delta as Markdown (headings, lists, quotes, bold/italic/underline/links). */
export function deltaToMarkdown(content) {
  const ops = content && Array.isArray(content.ops) ? content.ops : [];
  let out = '';
  let line = '';
  let orderedCount = 0;

  for (const op of ops) {
    if (typeof op.insert !== 'string') continue;
    const attributes = op.attributes || {};
    const chunks = op.insert.split('\n');

    for (let i = 0; i < chunks.length; i += 1) {
      if (chunks[i]) line += formatInline(chunks[i], attributes);
      if (i >= chunks.length - 1) continue;

      if (attributes.divider) {
        out += '---\n';
        line = '';
        orderedCount = 0;
        continue;
      }

      let prefix = '';
      if (attributes.header) {
        prefix = `${'#'.repeat(Math.min(attributes.header, 6))} `;
        orderedCount = 0;
      } else if (attributes.list === 'bullet') {
        prefix = '- ';
        orderedCount = 0;
      } else if (attributes.list === 'ordered') {
        orderedCount += 1;
        prefix = `${orderedCount}. `;
      } else if (attributes.blockquote) {
        prefix = '> ';
        orderedCount = 0;
      } else if (attributes['code-block']) {
        prefix = '    ';
        orderedCount = 0;
      } else {
        orderedCount = 0;
      }

      out += prefix + line + '\n';
      line = '';
    }
  }

  if (line) out += `${line}\n`;
  return `${out.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
