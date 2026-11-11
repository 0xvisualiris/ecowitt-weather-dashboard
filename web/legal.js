// Imprint and privacy policy: texts the station's operator writes (config.yaml or the admin page),
// shown as their own pages. The text is plain text with a few conventions, turned into elements
// here, never into HTML: a blank line starts a paragraph, "# " / "## " starts a heading, "- " a list
// item, and web and email addresses become links.

import { $, el, getJson } from './lib.js';
import { tr, loc } from './i18n.js';

export const LEGAL_PAGES = ['imprint', 'privacy'];

let texts = null, shown = 0;

const LINK = /(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"])|([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;

// One line of text, with its web and email addresses as links.
function inline(line) {
  const out = [];
  let at = 0;
  for (const m of line.matchAll(LINK)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    const href = m[1] ? m[1] : `mailto:${m[2]}`;
    out.push(el('a', { href, rel: m[1] ? 'noopener noreferrer' : null }, m[0]));
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

// Lines joined with line breaks, as in an address.
const lines = (list) => list.flatMap((line, i) => (i ? [el('br'), ...inline(line)] : inline(line)));

export function render(text) {
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trimEnd())).filter((b) => b.some((l) => l.trim()));
  const out = [];
  for (let block of blocks) {
    while (block.length && /^#{1,3}\s/.test(block[0])) {
      const [, hashes, title] = /^(#{1,3})\s+(.*)$/.exec(block[0]);
      out.push(el(hashes.length === 1 ? 'h2' : 'h3', {}, ...inline(title)));
      block = block.slice(1);
    }
    if (!block.length) continue;
    if (block.every((l) => /^\s*[-*]\s/.test(l))) out.push(el('ul', {}, ...block.map((l) => el('li', {}, ...inline(l.replace(/^\s*[-*]\s+/, ''))))));
    else out.push(el('p', {}, ...lines(block)));
  }
  return out;
}

export async function enter(params) {
  const page = LEGAL_PAGES.includes(params.get('page')) ? params.get('page') : 'imprint';
  const root = $('legalRoot'), mine = ++shown;
  const head = el('div.page-head', {}, el('h1', {}, tr(`legal.${page}`)));
  if (!texts) {
    root.replaceChildren(head);
    try { texts = await getJson('/api/legal'); } catch {
      if (mine === shown) root.replaceChildren(head, el('p.sub', {}, tr('legal.error')));
      return;
    }
    if (mine !== shown) return;   // another legal page was opened meanwhile
  }
  const text = loc(texts[page]);
  root.replaceChildren(head, text ? el('div.legal-text', {}, ...render(text)) : el('p.sub', {}, tr('legal.missing')));
}
