import React, { useCallback, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

const COPY_TIMEOUT = 2000;

function CodeBlock({ language, content }: { language?: string; content: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_TIMEOUT);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_TIMEOUT);
    }
  }, [content]);

  return (
    <div className="relative group my-2">
      <div className="flex items-center justify-between rounded-t-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-1.5">
        <span className="text-[var(--muted-foreground)] text-[11px] font-mono">{language || 'code'}</span>
        <button onClick={handleCopy} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-[11px] transition">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="rounded-b-md border-x border-b border-[var(--border)] bg-[var(--background)] overflow-x-auto">
        <SyntaxHighlighter
          language={language || 'text'}
          style={oneLight}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '12px',
            background: 'transparent',
            fontSize: '12px',
            lineHeight: 1.65,
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            },
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="bg-[var(--muted)] text-[var(--foreground)]/70 px-1.5 py-0.5 rounded text-[13px] font-mono break-all">
      {children}
    </code>
  );
}

// Simple markdown parser supporting: **bold**, `code`, ```code blocks```, tables, lists, headings
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 0 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function splitTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function parseMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — trim whitespace before checking
    if (/^\s*```/.test(line)) {
      const trimmed = line.trim();
      const langMatch = /^\s*```(\w*)/.exec(trimmed);
      const lang = langMatch?.[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // closing ```
      nodes.push(<CodeBlock key={key++} language={lang || undefined} content={codeLines.join('\n')} />);
      continue;
    }

    // Table
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerLine = line;
      const headers = splitTableCells(headerLine);
      const dataLines: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        dataLines.push(splitTableCells(lines[i]));
        i++;
      }
      nodes.push(
        <div key={key++} className="overflow-x-auto my-2">
          <table className="doc-table">
            <thead>
              <tr>{headers.map((h, hi) => <th key={hi}>{parseInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {dataLines.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{parseInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      if (level === 1) nodes.push(<h1 key={key++} className="text-lg font-bold my-2">{parseInline(content)}</h1>);
      else if (level === 2) nodes.push(<h2 key={key++} className="text-base font-bold my-2">{parseInline(content)}</h2>);
      else nodes.push(<h3 key={key++} className="text-sm font-bold my-1.5">{parseInline(content)}</h3>);
      i++;
      continue;
    }

    // Blockquote
    if (/^> /.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      nodes.push(
        <blockquote key={key++} className="border-l-3 border-gray-300 pl-3 my-2 text-gray-500 italic">
          {quoteLines.map((ql, qi) => <p key={qi} className="my-1">{parseInline(ql)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      nodes.push(
        <ol key={key++} className="list-decimal pl-5 my-2 space-y-1">
          {items.map((item, ii) => <li key={ii}>{parseInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Unordered list
    if (/^[\-\*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*]\s/, ''));
        i++;
      }
      nodes.push(
        <ul key={key++} className="list-disc pl-5 my-2 space-y-1">
          {items.map((item, ii) => <li key={ii}>{parseInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      nodes.push(<hr key={key++} className="my-3 border-gray-200" />);
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>\s|\d+\.\s|[\-\*]\s)/.test(lines[i])) {
      if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      nodes.push(
        <p key={key++} className="my-1.5 leading-relaxed">
          {paraLines.map((pl, pi) => (
            <React.Fragment key={pi}>
              {pi > 0 && <br />}
              {parseInline(pl)}
            </React.Fragment>
          ))}
        </p>
      );
    } else {
      nodes.push(<p key={key++} className="my-1.5 leading-relaxed">{parseInline(line)}</p>);
      i++;
    }
  }

  return nodes;
}

function parseInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let remaining = text;
  let kid = 0;

  while (remaining.length > 0) {
    // Inline code: `...`
    const codeMatch = /`([^`]+)`/.exec(remaining);
    // Bold: **...**
    const boldMatch = /\*\*(.+?)\*\*/.exec(remaining);
    // Link: [text](url)
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(remaining);

    const matches = [
      { idx: codeMatch?.index ?? Infinity, match: codeMatch, handler: () => { result.push(<InlineCode key={kid++}>{codeMatch![1]}</InlineCode>); remaining = remaining.slice(codeMatch!.index! + codeMatch![0].length); } },
      { idx: boldMatch?.index ?? Infinity, match: boldMatch, handler: () => { result.push(<strong key={kid++} className="font-bold">{boldMatch![1]}</strong>); remaining = remaining.slice(boldMatch!.index! + boldMatch![0].length); } },
      { idx: linkMatch?.index ?? Infinity, match: linkMatch, handler: () => { result.push(<a key={kid++} href={linkMatch![2]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline hover:opacity-80">{linkMatch![1]}</a>); remaining = remaining.slice(linkMatch!.index! + linkMatch![0].length); } },
    ];

    const earliest = matches.reduce((a, b) => a.idx < b.idx ? a : b);

    if (earliest.idx === Infinity) {
      result.push(remaining);
      break;
    }

    if (earliest.idx > 0) {
      result.push(remaining.slice(0, earliest.idx));
    }

    earliest.handler();
  }

  return result;
}

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  const rendered = useMemo(() => parseMarkdown(content), [content]);
  return <>{rendered}</>;
}
