// Minimal CommonMark-ish parser for lab notes.
//
// Renders to React elements rather than HTML strings, so there is no
// dangerouslySetInnerHTML anywhere and no sanitizer to keep in sync.

export type InlineNode =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] }
  | { kind: 'strike'; children: InlineNode[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: InlineNode[] }
  | { kind: 'break' };

export type BlockNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: 'paragraph'; children: InlineNode[] }
  | { kind: 'code'; lang: string; value: string }
  | { kind: 'quote'; blocks: BlockNode[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; head: InlineNode[][]; align: ColumnAlign[]; rows: InlineNode[][][] }
  | { kind: 'rule' };

export interface ListItem {
  /** null when the item is not a task-list item. */
  checked: boolean | null;
  blocks: BlockNode[];
}

export type ColumnAlign = 'left' | 'center' | 'right' | null;

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

const ESCAPABLE = '\\`*_{}[]()#+-.!>~|';

/**
 * Parses inline markdown. Emphasis is matched by scanning for a closing
 * delimiter rather than by regex, so nested spans behave sensibly.
 */
export function parseInline(src: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = '';

  const flush = () => {
    if (text) {
      nodes.push({ kind: 'text', value: text });
      text = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Backslash escape
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    // Hard line break: two trailing spaces, or a bare newline inside a paragraph
    if (ch === '\n') {
      flush();
      nodes.push({ kind: 'break' });
      i += 1;
      continue;
    }

    // Inline code: longest matching run of backticks wins
    if (ch === '`') {
      let fence = 0;
      while (src[i + fence] === '`') fence += 1;
      const marker = '`'.repeat(fence);
      const end = src.indexOf(marker, i + fence);
      if (end !== -1) {
        flush();
        nodes.push({ kind: 'code', value: src.slice(i + fence, end).trim() });
        i = end + fence;
        continue;
      }
    }

    // Link: [label](href) — also bare autolinks <https://...>
    if (ch === '[') {
      const parsed = parseLink(src, i);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        i = parsed.next;
        continue;
      }
    }

    if (ch === '<') {
      const close = src.indexOf('>', i + 1);
      if (close !== -1) {
        const inner = src.slice(i + 1, close);
        if (/^(https?:\/\/|mailto:)\S+$/i.test(inner)) {
          flush();
          nodes.push({ kind: 'link', href: inner, children: [{ kind: 'text', value: inner }] });
          i = close + 1;
          continue;
        }
      }
    }

    // Emphasis
    const emphasis = parseEmphasis(src, i);
    if (emphasis) {
      flush();
      nodes.push(emphasis.node);
      i = emphasis.next;
      continue;
    }

    text += ch;
    i += 1;
  }

  flush();
  return nodes;
}

function parseLink(src: string, start: number): { node: InlineNode; next: number } | null {
  // Find the matching ] allowing one level of nesting for [x] style labels.
  let depth = 0;
  let labelEnd = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
  }
  if (labelEnd === -1 || src[labelEnd + 1] !== '(') return null;

  const hrefEnd = src.indexOf(')', labelEnd + 2);
  if (hrefEnd === -1) return null;

  const label = src.slice(start + 1, labelEnd);
  // Strip an optional "title" and keep only the URL.
  const href = src.slice(labelEnd + 2, hrefEnd).trim().split(/\s+/)[0] || '';

  return {
    node: { kind: 'link', href, children: parseInline(label) },
    next: hrefEnd + 1,
  };
}

const EMPHASIS: { marker: string; kind: 'strong' | 'em' | 'strike' }[] = [
  { marker: '***', kind: 'strong' }, // handled as strong wrapping em below
  { marker: '___', kind: 'strong' },
  { marker: '**', kind: 'strong' },
  { marker: '__', kind: 'strong' },
  { marker: '~~', kind: 'strike' },
  { marker: '*', kind: 'em' },
  { marker: '_', kind: 'em' },
];

function parseEmphasis(src: string, start: number): { node: InlineNode; next: number } | null {
  for (const { marker, kind } of EMPHASIS) {
    if (!src.startsWith(marker, start)) continue;

    // An underscore mid-word (snake_case, file_name_here) is not emphasis.
    if (marker[0] === '_' && start > 0 && /\w/.test(src[start - 1])) continue;

    const close = findClosing(src, start + marker.length, marker);
    if (close === -1) continue;

    const inner = src.slice(start + marker.length, close);
    if (!inner.trim()) continue;

    // *** => strong + em
    if (marker.length === 3) {
      return {
        node: { kind: 'strong', children: [{ kind: 'em', children: parseInline(inner) }] },
        next: close + marker.length,
      };
    }

    return { node: { kind, children: parseInline(inner) }, next: close + marker.length };
  }
  return null;
}

function findClosing(src: string, from: number, marker: string): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    // Don't match a delimiter inside inline code.
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (src.startsWith(marker, i)) {
      // For single-char markers, require the previous char to be non-space
      // so that "a * b * c" isn't read as emphasis.
      if (marker.length === 1 && /\s/.test(src[i - 1])) continue;
      if (marker[0] === '_' && marker.length === 1 && /\w/.test(src[i + 1] || '')) continue;
      return i;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

export function parseMarkdown(src: string): BlockNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence (or run off the end, which is fine)
      blocks.push({ kind: 'code', lang, value: body.join('\n') });
      continue;
    }

    // ATX heading
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    // Setext heading (=== / --- under a line of text)
    const next = lines[i + 1];
    if (next && /^\s{0,3}(=+|-+)\s*$/.test(next) && line.trim() && !BULLET_RE.test(line)) {
      blocks.push({
        kind: 'heading',
        level: next.trim().startsWith('=') ? 1 : 2,
        children: parseInline(line.trim()),
      });
      i += 2;
      continue;
    }

    // Thematic break
    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    // Blockquote
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (lines[i].trim() && body.length))) {
        if (!/^\s{0,3}>/.test(lines[i]) && !lines[i].trim()) break;
        body.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(body) });
      continue;
    }

    // Table
    if (next && isTableDivider(next) && line.includes('|')) {
      const table = parseTable(lines, i);
      if (table) {
        blocks.push(table.node);
        i = table.next;
        continue;
      }
    }

    // List
    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const list = parseList(lines, i);
      blocks.push(list.node);
      i = list.next;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsNewBlock(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) {
      blocks.push({ kind: 'paragraph', children: parseInline(para.join('\n')) });
    } else {
      i += 1; // safety: never stall
    }
  }

  return blocks;
}

function startsNewBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  if (/^\s*(```|~~~)/.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s/.test(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) return true;
  if (BULLET_RE.test(line) || ORDERED_RE.test(line)) return true;
  const next = lines[i + 1];
  if (next && isTableDivider(next) && line.includes('|')) return true;
  return false;
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
      continue;
    }
    if (body[i] === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += body[i];
  }
  cells.push(cell.trim());
  return cells;
}

function parseTable(lines: string[], start: number): { node: BlockNode; next: number } | null {
  const head = splitRow(lines[start]);
  const align: ColumnAlign[] = splitRow(lines[start + 1]).map((spec) => {
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
  if (head.length !== align.length) return null;

  const rows: InlineNode[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const cells = splitRow(lines[i]);
    // Pad or trim so every row matches the header width.
    while (cells.length < head.length) cells.push('');
    rows.push(cells.slice(0, head.length).map(parseInline));
    i += 1;
  }

  return {
    node: { kind: 'table', head: head.map(parseInline), align, rows },
    next: i,
  };
}

function parseList(lines: string[], start: number): { node: BlockNode; next: number } {
  const first = BULLET_RE.exec(lines[start]) || ORDERED_RE.exec(lines[start]);
  const ordered = !BULLET_RE.test(lines[start]);
  const baseIndent = first![1].length;
  const startNum = ordered ? parseInt(first![2], 10) : 1;

  const items: ListItem[] = [];
  let buffer: string[] = [];
  let checked: boolean | null = null;
  let i = start;

  const commit = () => {
    if (!buffer.length) return;
    items.push({ checked, blocks: parseBlocks(buffer) });
    buffer = [];
    checked = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const following = lines[i + 1];
      const continues =
        following &&
        following.trim() &&
        (indentOf(following) > baseIndent || matchesMarker(following, baseIndent, ordered));
      if (!continues) break;
      buffer.push('');
      i += 1;
      continue;
    }

    const match = BULLET_RE.exec(line) || ORDERED_RE.exec(line);
    const indent = indentOf(line);

    if (match && indent === baseIndent) {
      commit();
      let content = match[3];
      const task = TASK_RE.exec(content);
      if (task) {
        checked = task[1].toLowerCase() === 'x';
        content = task[2];
      }
      buffer.push(content);
      i += 1;
      continue;
    }

    if (indent > baseIndent) {
      // Nested content: strip one level of indentation and recurse later.
      // Indent width is measured with tabs expanded, so strip by visual
      // columns rather than by raw character count.
      buffer.push(stripIndent(line, baseIndent + 2));
      i += 1;
      continue;
    }

    if (match && indent < baseIndent) break;

    // Lazy continuation of the current item's paragraph.
    if (buffer.length) {
      buffer.push(line.trim());
      i += 1;
      continue;
    }

    break;
  }

  commit();
  return { node: { kind: 'list', ordered, start: startNum, items }, next: i };
}

/** Removes up to `columns` of leading whitespace, counting a tab as 4 columns. */
function stripIndent(line: string, columns: number): string {
  let removed = 0;
  let i = 0;
  while (i < line.length && removed < columns) {
    if (line[i] === '\t') removed += 4;
    else if (line[i] === ' ') removed += 1;
    else break;
    i += 1;
  }
  return line.slice(i);
}

function indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].replace(/\t/g, '    ').length : 0;
}

function matchesMarker(line: string, indent: number, ordered: boolean): boolean {
  const match = ordered ? ORDERED_RE.exec(line) : BULLET_RE.exec(line);
  return !!match && indentOf(line) === indent;
}

/** Plain-text rendering, used for copy-to-clipboard and paste-to-window. */
export function markdownToPlainText(src: string): string {
  return blocksToText(parseMarkdown(src)).replace(/\n{3,}/g, '\n\n').trim();
}

function blocksToText(blocks: BlockNode[], depth = 0): string {
  const pad = '  '.repeat(depth);
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return pad + inlineToText(block.children);
        case 'paragraph':
          return pad + inlineToText(block.children);
        case 'code':
          return block.value
            .split('\n')
            .map((l) => pad + l)
            .join('\n');
        case 'quote':
          return blocksToText(block.blocks, depth)
            .split('\n')
            .map((l) => pad + '> ' + l)
            .join('\n');
        case 'rule':
          return pad + '---';
        case 'list':
          return block.items
            .map((item, index) => {
              const marker = block.ordered ? `${block.start + index}.` : '-';
              const box = item.checked === null ? '' : item.checked ? '[x] ' : '[ ] ';
              const body = blocksToText(item.blocks, depth + 1).trimStart();
              return `${pad}${marker} ${box}${body}`;
            })
            .join('\n');
        case 'table': {
          const rows = [block.head, ...block.rows];
          return rows.map((row) => pad + row.map(inlineToText).join('\t')).join('\n');
        }
      }
    })
    .join('\n\n');
}

function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        case 'break':
          return '\n';
        case 'link':
          return inlineToText(node.children) === node.href
            ? node.href
            : `${inlineToText(node.children)} (${node.href})`;
        default:
          return inlineToText(node.children);
      }
    })
    .join('');
}
