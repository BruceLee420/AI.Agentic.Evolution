#!/usr/bin/env node
/**
 * CURATE — a local drag-and-drop board for arranging the collection.
 *
 * You can't judge colour flow in a spreadsheet. This serves a page on
 * localhost showing every piece as a thumbnail; drag them into the order you
 * want, hit Save, and it writes the `order` column back to catalog.csv. Rerun
 * ingest and the site follows.
 *
 *   node curate.mjs                    # then open http://localhost:4321
 *   node curate.mjs --port 5000
 *
 * This runs only on your machine and is never deployed — it writes to your
 * local CSV, which is exactly why it isn't part of the published site.
 *
 * "Sort by score" reorders by the auto visual-impact ranking as a starting
 * point. Your dragging always beats it; nothing overwrites what you place.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const PORT = Number(opt('--port', 4321));
const CATALOG = resolve(opt('--catalog', './catalog.csv'));
const PREVIEWS = resolve(opt('--previews', './out/previews'));

/* ---------------- csv ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false; else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function loadCatalog() {
  const rows = parseCSV(await readFile(CATALOG, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  return { header, records: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Curate — Freethinkers</title>
<style>
  :root{--bg:#0d0d0f;--panel:#17181c;--line:#2a2b31;--paper:#f6f4ef;--dim:#9a9aa2;--accent:#ff4d00}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--paper);font-family:ui-sans-serif,system-ui,sans-serif}
  header{position:sticky;top:0;z-index:10;display:flex;gap:1rem;align-items:center;flex-wrap:wrap;
    padding:.9rem 1.25rem;background:rgba(13,13,15,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  h1{font-size:1rem;margin:0;letter-spacing:.08em}
  button{font:inherit;border-radius:3px;cursor:pointer;padding:.5rem .9rem;border:1px solid var(--line);
    background:transparent;color:var(--paper)}
  button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:700}
  button:disabled{opacity:.5;cursor:default}
  #status{margin-left:auto;color:var(--dim);font-size:.85rem}
  .grid{display:grid;gap:.6rem;padding:1.25rem;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
  .card{position:relative;border:1px solid var(--line);border-radius:3px;overflow:hidden;cursor:grab;
    background:var(--panel);user-select:none}
  .card.dragging{opacity:.35}
  .card.over{outline:2px solid var(--accent);outline-offset:1px}
  .card img{width:100%;aspect-ratio:1;object-fit:cover;display:block;pointer-events:none}
  .meta{padding:.4rem .5rem;font-size:.68rem;line-height:1.35}
  .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .s{color:var(--dim);display:flex;justify-content:space-between}
  .pos{position:absolute;top:.3rem;left:.3rem;background:rgba(0,0,0,.75);border-radius:2px;
    padding:.05rem .35rem;font-size:.65rem;font-variant-numeric:tabular-nums}
  .score{color:var(--accent)}
</style></head><body>
<header>
  <h1>CURATE</h1>
  <button id="by-score">Sort by score</button>
  <button id="by-day">Sort by day</button>
  <button id="reverse">Reverse</button>
  <button id="save" class="primary">Save order</button>
  <span id="status">Drag to arrange. Nothing is written until you save.</span>
</header>
<div class="grid" id="grid"></div>
<script>
let items = [];
const grid = document.getElementById('grid');
const status = document.getElementById('status');

function draw() {
  grid.innerHTML = '';
  items.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'card'; d.draggable = true; d.dataset.id = p.id;
    d.innerHTML = \`<span class="pos">\${i + 1}</span>
      <img src="/thumb/\${p.id}" alt="" loading="lazy">
      <div class="meta"><div class="t">\${p.title || p.id}</div>
      <div class="s"><span>Day \${p.day || '—'}</span><span class="score">\${p.score || ''}</span></div></div>\`;
    grid.appendChild(d);
  });
}

let dragId = null;
grid.addEventListener('dragstart', (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  dragId = c.dataset.id; c.classList.add('dragging');
});
grid.addEventListener('dragend', (e) => {
  e.target.closest('.card')?.classList.remove('dragging');
  grid.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
});
grid.addEventListener('dragover', (e) => {
  e.preventDefault();
  const c = e.target.closest('.card'); if (!c) return;
  grid.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
  c.classList.add('over');
});
grid.addEventListener('drop', (e) => {
  e.preventDefault();
  const c = e.target.closest('.card'); if (!c || !dragId) return;
  const from = items.findIndex((p) => p.id === dragId);
  const to = items.findIndex((p) => p.id === c.dataset.id);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  dragId = null;
  draw();
  status.textContent = 'Unsaved changes.';
});

document.getElementById('by-score').onclick = () => {
  items.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)); draw();
  status.textContent = 'Sorted by visual impact — rearrange as you like, then save.';
};
document.getElementById('by-day').onclick = () => {
  items.sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0)); draw();
  status.textContent = 'Sorted by day.';
};
document.getElementById('reverse').onclick = () => { items.reverse(); draw(); status.textContent = 'Reversed.'; };

document.getElementById('save').onclick = async () => {
  const btn = document.getElementById('save');
  btn.disabled = true; status.textContent = 'Saving…';
  const r = await fetch('/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: items.map((p) => p.id) }),
  });
  status.textContent = r.ok ? 'Saved to catalog.csv. Run ingest to publish.' : 'Save failed — see terminal.';
  btn.disabled = false;
};

fetch('/data').then((r) => r.json()).then((d) => { items = d; draw(); });
</script></body></html>`;

/* ---------------- server ---------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (url.pathname === '/data') {
    const { records } = await loadCatalog();
    const sorted = [...records].sort((a, b) => {
      const ao = a.order === '' ? Infinity : Number(a.order);
      const bo = b.order === '' ? Infinity : Number(b.order);
      if (ao !== bo) return ao - bo;
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(sorted.map((r) => ({
      id: r.id, title: r.title, day: r.day, score: r.score,
    }))));
  }

  if (url.pathname.startsWith('/thumb/')) {
    const id = url.pathname.slice('/thumb/'.length).replace(/[^\w.-]/g, '');
    try {
      const buf = await readFile(join(PREVIEWS, `${id}.png`));
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=300' });
      return res.end(buf);
    } catch {
      res.writeHead(404); return res.end();
    }
  }

  if (url.pathname === '/save' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { order } = JSON.parse(body);
      const { header, records } = await loadCatalog();
      const rank = new Map(order.map((id, i) => [id, (i + 1) * 10]));
      for (const r of records) if (rank.has(r.id)) r.order = String(rank.get(r.id));
      const cols = header.includes('order') ? header : [...header, 'order'];
      await writeFile(
        CATALOG,
        [cols.join(','), ...records.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
      );
      console.log(`✔ saved order for ${order.length} pieces → ${CATALOG}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    } catch (e) {
      console.error('save failed:', e.message);
      res.writeHead(500); return res.end('{"ok":false}');
    }
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`
CURATE running → http://localhost:${PORT}

  catalog:  ${CATALOG}
  previews: ${PREVIEWS}

Drag pieces into the order you want, hit Save, then rerun ingest.mjs to
publish. Ctrl-C to stop. Nothing here is deployed — it writes your local CSV.
`);
});
