import type { ReactNode } from "react";

function inlineRich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\[\[kind:(?:task|event|bill|idea)\]\][^[]+\[\[\/kind\]\])/g).filter(Boolean);
  return parts.map((part, index) => {
    const kindChip = part.match(/^\[\[kind:(task|event|bill|idea)\]\]([^[]+)\[\[\/kind\]\]$/);
    if (kindChip) return <i key={index} className={`chat-kind-chip is-${kindChip[1]}`}>{kindChip[2]}</i>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/|mailto:)([^)\s]+)\)$/);
    if (link) {
      const href = `${link[2]}${link[3]}`;
      return <a key={index} href={href} target="_blank" rel="noreferrer">{link[1]}</a>;
    }
    return <span key={index}>{part}</span>;
  });
}

function tableFrom(lines: string[], key: number): ReactNode {
  const cells = (line: string) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return (
    <table key={key}>
      <thead><tr>{header.map((cell, index) => <th key={index}>{inlineRich(cell)}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineRich(cell)}</td>)}</tr>)}</tbody>
    </table>
  );
}

/**
 * A deliberately small markdown surface for model replies. React owns every
 * node and only https/mailto links are emitted, so model text cannot inject
 * HTML or arbitrary URI schemes.
 */
export function renderChatMarkdown(content: string): ReactNode {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; tasks: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;
  let fence: { language: string; lines: string[] } | null = null;

  const flushList = () => {
    if (!list?.items.length) return;
    const items = list.items.map((item, index) => {
      const task = item.match(/^\[( |x|X|-)\]\s+(.*)$/);
      const label = task ? task[2] : item;
      return (
        <li key={index} className={task ? "chat-task" + (task[1].toLowerCase() === "x" ? " is-done" : "") : undefined}>
          {task && <i aria-hidden="true" />}{inlineRich(label)}
        </li>
      );
    });
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  const flushQuote = () => {
    if (!quote?.length) return;
    blocks.push(<blockquote key={blocks.length}>{renderChatMarkdown(quote.join("\n"))}</blockquote>);
    quote = null;
  };
  const flushFence = () => {
    if (!fence) return;
    blocks.push(<pre key={blocks.length} data-language={fence.language || undefined}><code>{fence.lines.join("\n")}</code></pre>);
    fence = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (fence) {
      if (/^```\s*$/.test(raw.trim())) flushFence();
      else fence.lines.push(raw);
      continue;
    }
    const fenceOpen = raw.trim().match(/^```(\S*)\s*$/);
    if (fenceOpen) { flushList(); flushQuote(); fence = { language: fenceOpen[1], lines: [] }; continue; }

    const quoteLine = raw.match(/^\s*>\s?(.*)$/);
    if (quoteLine) {
      flushList();
      (quote ??= []).push(quoteLine[1]);
      continue;
    }
    flushQuote();

    const line = raw.trim();
    if (!line) { flushList(); continue; }
    if (/^(?:[-*_]\s*){3,}$/.test(line)) { flushList(); blocks.push(<hr key={blocks.length} />); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      blocks.push(<h4 key={blocks.length} data-level={String(heading[1].length)}>{inlineRich(heading[2])}</h4>);
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, tasks: false, items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, tasks: false, items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      flushList();
      let tableEnd = index + 2;
      while (tableEnd < lines.length && lines[tableEnd].includes("|") && lines[tableEnd].trim()) tableEnd += 1;
      blocks.push(tableFrom(lines.slice(index, tableEnd), blocks.length));
      index = tableEnd - 1;
      continue;
    }
    flushList();
    blocks.push(<p key={blocks.length}>{inlineRich(line)}</p>);
  }
  flushList();
  flushQuote();
  flushFence();
  return blocks;
}
