// Shows docs/user-manual.md inside the app, with a table of contents at the top (every chapter and
// its parts, a tap away) and a Contents button that comes back once you have scrolled down.
// docs/user-manual.md is the one copy of the manual: every change the user can see updates it.
import { ChevronRight, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import manual from '../../docs/user-manual.md?raw';

/** **bold** and `code` inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

const plain = (s: string) => s.replace(/\*|`/g, '');

interface Heading {
  id: string;
  level: 2 | 3;
  text: string;
}

/** A small Markdown reader: # ## ### headings, paragraphs, - and 1. lists, > notes. Returns the headings for the contents. */
function render(md: string): { nodes: ReactNode[]; headings: Heading[] } {
  const nodes: ReactNode[] = [];
  const headings: Heading[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      const id = `ch-${key}`;
      if (level > 1) headings.push({ id, level: level as 2 | 3, text: plain(h[2]) });
      const Tag = (['h1', 'h2', 'h3'] as const)[level - 1];
      nodes.push(
        <Tag key={key++} id={id} className="scroll-mt-4">
          {inline(h[2])}
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const r = lines[i++].trim();
        if (/^\|[\s|:-]+\|$/.test(r)) continue;
        rows.push(r.slice(1, -1).split('|').map((c) => c.trim()));
      }
      const [head, ...body] = rows;
      nodes.push(
        <table key={key++}>
          <thead>
            <tr>{head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, n) => (
              <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const list = line.match(/^(-|\d+\.)\s+/);
    if (list) {
      const ordered = list[1] !== '-';
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^(-|\d+\.)\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      nodes.push(
        <Tag key={key++}>
          {items.map((t, n) => (
            <li key={n}>{inline(t)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) parts.push(lines[i++].replace(/^>\s?/, ''));
      nodes.push(<blockquote key={key++}>{inline(parts.join(' '))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|-\s|\d+\.\s|>|\|)/.test(lines[i])) para.push(lines[i++]);
    nodes.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return { nodes, headings };
}

const { nodes, headings } = render(manual);

function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Contents() {
  // chapters (##) with their parts (###) under them
  const chapters: { h: Heading; parts: Heading[] }[] = [];
  for (const h of headings) {
    if (h.level === 2) chapters.push({ h, parts: [] });
    else chapters[chapters.length - 1]?.parts.push(h);
  }
  return (
    <nav id="contents" aria-label="Contents" className="card mb-6 scroll-mt-4 p-2">
      <h2 className="px-3 pt-2 pb-1 text-base font-semibold">Contents</h2>
      <ol className="divide-y divide-line">
        {chapters.map(({ h, parts }, n) => (
          <li key={h.id}>
            <button type="button" onClick={() => goTo(h.id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left font-medium hover:bg-page active:bg-accent-soft">
              <span className="num w-5 shrink-0 text-sm text-muted">{n + 1}</span>
              <span className="flex-1">{h.text}</span>
              <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
            </button>
            {parts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-2.5 pl-11">
                {parts.map((p) => (
                  <button key={p.id} type="button" onClick={() => goTo(p.id)} className="chip min-h-8 px-2.5 text-[13px] active:bg-accent-soft">
                    {p.text}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Comes into view once the contents have scrolled off the screen. */
function ContentsButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const scroller = document.getElementById('page-scroll');
    const target = document.getElementById('contents');
    if (!scroller || !target) return;
    const onScroll = () => setShow(target.getBoundingClientRect().bottom < 0);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => goTo('contents')}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-30 flex min-h-11 items-center gap-2 rounded-full bg-choc px-4 text-sm font-semibold text-white shadow-lg active:bg-ink"
    >
      <List size={18} aria-hidden /> Contents
    </button>
  );
}

export function ManualPage() {
  const [title, ...rest] = nodes;
  return (
    <>
      <article className="manual text-[15px]">
        {title}
        {rest.slice(0, 2)}
      </article>
      <Contents />
      <article className="manual text-[15px]">{rest.slice(2)}</article>
      <ContentsButton />
    </>
  );
}
