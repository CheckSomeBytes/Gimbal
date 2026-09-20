import React, { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownView from './MarkdownView';
import './MarkdownEditor.css';

type Mode = 'edit' | 'preview';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra controls rendered at the right of the tab strip. */
  actions?: React.ReactNode;
}

interface ToolbarAction {
  label: string;
  title: string;
  /** Wraps the selection, e.g. ** for bold. */
  wrap?: string;
  /** Prefixes each selected line, e.g. "- " for a bullet list. */
  linePrefix?: string;
  /** Inserts a literal block at the cursor. */
  insert?: string;
  className?: string;
}

const TOOLBAR: (ToolbarAction | 'divider')[] = [
  { label: 'B', title: 'Bold (Ctrl+B)', wrap: '**', className: 'md-tool--bold' },
  { label: 'I', title: 'Italic (Ctrl+I)', wrap: '*', className: 'md-tool--italic' },
  { label: 'S', title: 'Strikethrough', wrap: '~~', className: 'md-tool--strike' },
  { label: '<>', title: 'Inline code', wrap: '`' },
  'divider',
  { label: 'H1', title: 'Heading 1', linePrefix: '# ' },
  { label: 'H2', title: 'Heading 2', linePrefix: '## ' },
  { label: 'H3', title: 'Heading 3', linePrefix: '### ' },
  'divider',
  { label: '•', title: 'Bullet list', linePrefix: '- ' },
  { label: '1.', title: 'Numbered list', linePrefix: '1. ' },
  { label: '☑', title: 'Task list', linePrefix: '- [ ] ' },
  { label: '"', title: 'Blockquote', linePrefix: '> ' },
  'divider',
  { label: '🔗', title: 'Link (Ctrl+K)', wrap: 'LINK' },
  { label: '▤', title: 'Code block', insert: '\n```\ncode\n```\n' },
  { label: '⊞', title: 'Table', insert: '\n| Column | Column |\n| --- | --- |\n| Value | Value |\n' },
  { label: '—', title: 'Horizontal rule', insert: '\n---\n' },
];

function MarkdownEditor({ value, onChange, placeholder, autoFocus, actions }: MarkdownEditorProps) {
  const [mode, setMode] = useState<Mode>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && mode === 'edit') {
      textareaRef.current?.focus();
    }
  }, [autoFocus, mode]);

  /** Replaces the current selection and restores a sensible cursor position. */
  const applyEdit = useCallback(
    (next: string, selStart: number, selEnd: number) => {
      onChange(next);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(selStart, selEnd);
      });
    },
    [onChange]
  );

  const runAction = useCallback(
    (action: ToolbarAction) => {
      const el = textareaRef.current;
      if (!el) return;

      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = value.slice(start, end);

      if (action.insert) {
        const next = value.slice(0, end) + action.insert + value.slice(end);
        const caret = end + action.insert.length;
        applyEdit(next, caret, caret);
        return;
      }

      if (action.wrap === 'LINK') {
        const label = selected || 'link text';
        const snippet = `[${label}](https://)`;
        const next = value.slice(0, start) + snippet + value.slice(end);
        // Drop the cursor inside the URL so the user can type it straight away.
        const urlStart = start + label.length + 3;
        applyEdit(next, urlStart + 8, urlStart + 8);
        return;
      }

      if (action.wrap) {
        const marker = action.wrap;
        const before = value.slice(start - marker.length, start);
        const after = value.slice(end, end + marker.length);

        // Toggle off when the selection is already wrapped.
        if (before === marker && after === marker) {
          const next =
            value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
          applyEdit(next, start - marker.length, end - marker.length);
          return;
        }

        const body = selected || 'text';
        const next = value.slice(0, start) + marker + body + marker + value.slice(end);
        applyEdit(next, start + marker.length, start + marker.length + body.length);
        return;
      }

      if (action.linePrefix) {
        const prefix = action.linePrefix;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEndIndex = value.indexOf('\n', end);
        const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

        const block = value.slice(lineStart, lineEnd);
        const lines = block.split('\n');
        // Ordered lists renumber; everything else uses a constant prefix.
        const isOrdered = /^\d+\.\s$/.test(prefix);
        const allPrefixed = lines.every((line) =>
          isOrdered ? /^\d+\.\s/.test(line) : line.startsWith(prefix)
        );

        const updated = lines
          .map((line, i) => {
            if (allPrefixed) {
              return isOrdered ? line.replace(/^\d+\.\s/, '') : line.slice(prefix.length);
            }
            // Replace any existing block marker before applying the new one.
            const bare = line.replace(/^(#{1,6}\s|>\s|-\s\[[ xX]\]\s|[-*+]\s|\d+\.\s)/, '');
            return isOrdered ? `${i + 1}. ${bare}` : prefix + bare;
          })
          .join('\n');

        const next = value.slice(0, lineStart) + updated + value.slice(lineEnd);
        applyEdit(next, lineStart, lineStart + updated.length);
      }
    },
    [value, applyEdit]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      const shortcut: Record<string, ToolbarAction> = {
        b: { label: 'B', title: '', wrap: '**' },
        i: { label: 'I', title: '', wrap: '*' },
        k: { label: 'link', title: '', wrap: 'LINK' },
      };
      if (shortcut[key]) {
        e.preventDefault();
        // Stop the global Ctrl+K search shortcut from firing too.
        e.stopPropagation();
        runAction(shortcut[key]);
        return;
      }
    }

    // Tab indents rather than moving focus out of the editor.
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;

      if (start !== end) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const block = value.slice(lineStart, end);
        const updated = e.shiftKey
          ? block.split('\n').map((l) => l.replace(/^(\t| {1,2})/, '')).join('\n')
          : block.split('\n').map((l) => '\t' + l).join('\n');
        const next = value.slice(0, lineStart) + updated + value.slice(end);
        applyEdit(next, lineStart, lineStart + updated.length);
        return;
      }

      const next = value.slice(0, start) + '\t' + value.slice(end);
      applyEdit(next, start + 1, start + 1);
      return;
    }

    // Enter continues the current list.
    if (e.key === 'Enter' && !e.shiftKey) {
      const start = el.selectionStart;
      if (start !== el.selectionEnd) return;

      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const match = /^(\s*)(-\s\[[ xX]\]\s|[-*+]\s|(\d+)\.\s)/.exec(line);
      if (!match) return;

      const [, indent, marker, num] = match;
      const content = line.slice(match[0].length);

      e.preventDefault();

      // Empty list item: break out of the list instead of adding another bullet.
      if (!content.trim()) {
        const next = value.slice(0, lineStart) + indent + value.slice(start);
        const caret = lineStart + indent.length;
        applyEdit(next, caret, caret);
        return;
      }

      let nextMarker = marker;
      if (num) nextMarker = `${parseInt(num, 10) + 1}. `;
      else if (/^-\s\[[ xX]\]\s$/.test(marker)) nextMarker = '- [ ] ';

      const insertion = '\n' + indent + nextMarker;
      const next = value.slice(0, start) + insertion + value.slice(start);
      const caret = start + insertion.length;
      applyEdit(next, caret, caret);
    }
  };

  return (
    <div className="md-editor">
      <div className="md-editor-tabs">
        <div className="md-editor-tab-group">
          <button
            type="button"
            className={`md-editor-tab ${mode === 'edit' ? 'md-editor-tab--active' : ''}`}
            onClick={() => setMode('edit')}
          >
            EDIT
          </button>
          <button
            type="button"
            className={`md-editor-tab ${mode === 'preview' ? 'md-editor-tab--active' : ''}`}
            onClick={() => setMode('preview')}
          >
            PREVIEW
          </button>
        </div>
        {actions && <div className="md-editor-tab-actions">{actions}</div>}
      </div>

      {mode === 'edit' && (
        <div className="md-toolbar">
          {TOOLBAR.map((item, i) =>
            item === 'divider' ? (
              <span key={`d-${i}`} className="md-toolbar-divider" />
            ) : (
              <button
                key={item.title}
                type="button"
                className={`md-toolbar-btn ${item.className || ''}`}
                title={item.title}
                // Keep the textarea selection intact when the button is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runAction(item)}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}

      <div className="md-editor-body">
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            className="md-editor-textarea"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck
          />
        ) : (
          <div className="md-editor-preview">
            <MarkdownView source={value} />
          </div>
        )}
      </div>
    </div>
  );
}

export default MarkdownEditor;
