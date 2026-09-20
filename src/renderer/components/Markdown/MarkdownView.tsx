import React, { useMemo } from 'react';
import { BlockNode, InlineNode, parseMarkdown } from './markdown';
import './MarkdownView.css';

interface MarkdownViewProps {
  source: string;
  className?: string;
}

/** Only these schemes are ever handed to the shell. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // Bare domains like example.com are treated as https.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function renderInline(nodes: InlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.kind) {
      case 'text':
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'strike':
        return <del key={key}>{renderInline(node.children, key)}</del>;
      case 'code':
        return (
          <code key={key} className="md-code-inline">
            {node.value}
          </code>
        );
      case 'break':
        return <br key={key} />;
      case 'link': {
        const href = safeHref(node.href);
        if (!href) {
          return <React.Fragment key={key}>{renderInline(node.children, key)}</React.Fragment>;
        }
        return (
          <a
            key={key}
            className="md-link"
            href={href}
            title={href}
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openInChrome(href);
            }}
          >
            {renderInline(node.children, key)}
          </a>
        );
      }
    }
  });
}

function renderBlocks(blocks: BlockNode[], keyPrefix: string): React.ReactNode[] {
  return blocks.map((block, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (block.kind) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1';
        return (
          <Tag key={key} className={`md-heading md-heading--${block.level}`}>
            {renderInline(block.children, key)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="md-paragraph">
            {renderInline(block.children, key)}
          </p>
        );
      case 'code':
        return (
          <pre key={key} className="md-code-block" data-lang={block.lang || undefined}>
            <code>{block.value}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={key} className="md-quote">
            {renderBlocks(block.blocks, key)}
          </blockquote>
        );
      case 'rule':
        return <hr key={key} className="md-rule" />;
      case 'list': {
        const isTaskList = block.items.some((item) => item.checked !== null);
        const items = block.items.map((item, index) => (
          <li
            key={`${key}-${index}`}
            className={`md-list-item ${item.checked !== null ? 'md-list-item--task' : ''}`}
          >
            {item.checked !== null && (
              <input type="checkbox" className="md-task-checkbox" checked={item.checked} readOnly />
            )}
            <div className="md-list-item-body">{renderBlocks(item.blocks, `${key}-${index}`)}</div>
          </li>
        ));

        return block.ordered ? (
          <ol key={key} className="md-list md-list--ordered" start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={key} className={`md-list ${isTaskList ? 'md-list--task' : ''}`}>
            {items}
          </ul>
        );
      }
      case 'table':
        return (
          <div key={key} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {block.head.map((cell, c) => (
                    <th key={c} style={{ textAlign: block.align[c] || undefined }}>
                      {renderInline(cell, `${key}-h-${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={{ textAlign: block.align[c] || undefined }}>
                        {renderInline(cell, `${key}-${r}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

function MarkdownView({ source, className }: MarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  if (!source.trim()) {
    return <div className={`md-view md-view--empty ${className || ''}`}>Nothing to preview yet.</div>;
  }

  return <div className={`md-view ${className || ''}`}>{renderBlocks(blocks, 'b')}</div>;
}

export default MarkdownView;
