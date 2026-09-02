/**
 * Mock Printful + Printify — a local stand-in for both provider APIs so the
 * whole syndication pipeline can be exercised end-to-end without an account,
 * a key, or a single real listing.
 *
 * One server speaks both dialects (their paths never collide). It also
 * misbehaves on purpose:
 *   - the FIRST product creation on Printful answers 429 with Retry-After: 1
 *   - the FIRST image upload on Printify answers 500
 * so a green test run proves the retry/backoff layer, not just the happy path.
 *
 * Standalone:  node mock-provider-server.mjs [port]
 * In-process:  const { port, hits, close } = await startMock();
 */

import { createServer } from 'node:http';

// Catalog fixtures mirror the real shapes the adapters parse. Sizes use the
// providers' own formatting (″ and ×) to prove the normalizers earn their keep.
const PF_PRODUCTS = {
  1: {
    product: { id: 1, title: 'Enhanced Matte Paper Poster' },
    variants: [
      { id: 1101, size: '12″×16″', color: null },
      { id: 1102, size: '18″×24″', color: null },
      { id: 1103, size: '24″×36″', color: null },
    ],
  },
  2: {
    product: { id: 2, title: 'Enhanced Matte Paper Framed Poster' },
    variants: [
      { id: 2101, size: '12″×16″', color: 'Black' },
      { id: 2102, size: '18″×24″', color: 'Black' },
    ],
  },
  146: {
    product: { id: 146, title: 'Unisex Heavy Blend Hoodie' },
    variants: [
      { id: 14601, size: 'S', color: 'Black' },
      { id: 14602, size: 'M', color: 'Black' },
      { id: 14603, size: 'L', color: 'Black' },
      { id: 14604, size: 'XL', color: 'Black' },
      { id: 14605, size: '2XL', color: 'Black' },
      { id: 14611, size: 'S', color: 'White' }, // must be excluded by color filter
      { id: 14612, size: 'M', color: 'White' },
    ],
  },
};

const PF_PRINTFILES = {
  1: { placement: 'default', width: 3600, height: 4800 },
  2: { placement: 'default', width: 3600, height: 4800 },
  146: { placement: 'front', width: 3600, height: 4800 },
};

const PY_BLUEPRINTS = [
  // The themed decoy has a LONGER title — findBlueprint must pick id 6.
  { id: 6, title: 'Unisex Jersey Short Sleeve Tee', brand: 'Bella+Canvas', model: '3001' },
  { id: 999, title: 'Bella Canvas 3001 Glow In The Dark Themed Special Edition Tee', brand: 'Bella+Canvas', model: '3001' },
];

const PY_VARIANTS = [];
{
  let id = 61;
  for (const color of ['Black', 'White']) {
    for (const size of ['XS', 'S', 'M', 'L', 'XL', '2XL']) { // XS must NOT match a requested "S"
      PY_VARIANTS.push({
        id: id++,
        title: `${color} / ${size}`,
        placeholders: [{ position: 'front', width: 3852, height: 4398 }],
      });
    }
  }
}

export function startMock(port = 0) {
  const hits = { pf429: 0, py500: 0, pfProducts: [], pyProducts: [], pyUploads: [], pfMockupTasks: 0 };
  let pfProductSeq = 9000;
  let pyProductSeq = 0;
  let uploadSeq = 0;
  let taskSeq = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : null;
    const send = (code, obj, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(obj));
    };

    /* ---- Printful ---- */
    if (path === '/store') return send(200, { result: { name: 'Mock Printful Store', id: 1 } });

    let m;
    if ((m = path.match(/^\/products\/(\d+)$/))) {
      const p = PF_PRODUCTS[m[1]];
      return p ? send(200, { result: p }) : send(404, { error: 'no such product' });
    }
    if ((m = path.match(/^\/mockup-generator\/printfiles\/(\d+)$/))) {
      const pf = PF_PRINTFILES[m[1]];
      if (!pf) return send(404, { error: 'no printfiles' });
      return send(200, {
        result: {
          printfiles: [{ printfile_id: 10, width: pf.width, height: pf.height, dpi: 300 }],
          variant_printfiles: [{ variant_id: 0, placements: { [pf.placement]: 10 } }],
        },
      });
    }
    if (path === '/store/products' && req.method === 'POST') {
      if (hits.pf429 === 0) { // prove the 429 + Retry-After path
        hits.pf429++;
        return send(429, { error: 'rate limited' }, { 'retry-after': '1' });
      }
      hits.pfProducts.push(json);
      return send(200, { result: { id: ++pfProductSeq } });
    }
    if ((m = path.match(/^\/mockup-generator\/create-task\/(\d+)$/)) && req.method === 'POST') {
      hits.pfMockupTasks++;
      return send(200, { result: { task_key: `task_${++taskSeq}:${m[1]}` } });
    }
    if (path === '/mockup-generator/task') {
      const key = url.searchParams.get('task_key') ?? '';
      return send(200, {
        result: {
          status: 'completed',
          mockups: [{ placement: 'default', mockup_url: `https://mock.printful/${key}.jpg`, variant_ids: [1101] }],
        },
      });
    }
    if (path === '/orders' && req.method === 'POST') {
      return send(200, { result: { id: 5001, status: json?.confirm ? 'pending' : 'draft' } });
    }

    /* ---- Printify ---- */
    if (path === '/shops.json') return send(200, [{ id: 777, title: 'Mock Printify Shop', sales_channel: 'api' }]);
    if (path === '/catalog/blueprints.json') return send(200, PY_BLUEPRINTS);
    if ((m = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\.json$/))) {
      return send(200, [{ id: 29, title: 'Monster Digital' }]);
    }
    if ((m = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\/(\d+)\/variants\.json$/))) {
      return send(200, { variants: PY_VARIANTS });
    }
    if (path === '/uploads/images.json' && req.method === 'POST') {
      if (hits.py500 === 0) { // prove the 5xx retry path
        hits.py500++;
        return send(500, { error: 'internal, try again' });
      }
      hits.pyUploads.push(json);
      return send(200, { id: `img_${++uploadSeq}`, width: 3600, height: 4260 });
    }
    if ((m = path.match(/^\/shops\/(\d+)\/products\.json$/)) && req.method === 'POST') {
      hits.pyProducts.push(json);
      const id = `pyprod_${++pyProductSeq}`;
      return send(200, {
        id,
        images: [{ src: `https://mock.printify/${id}.png`, variant_ids: json.variants.map((v) => v.id), is_default: true }],
      });
    }
    if (/^\/shops\/\d+\/products\/[^/]+\/publish\.json$/.test(path) && req.method === 'POST') {
      return send(200, {});
    }
    if (/^\/shops\/\d+\/orders\.json$/.test(path) && req.method === 'POST') {
      return send(200, { id: 'pyorder_1', status: 'pending' });
    }

    send(404, { error: `mock has no route for ${req.method} ${path}` });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        hits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Standalone mode for poking at it by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMock(Number(process.argv[2] ?? 8787));
  console.log(`mock providers listening on http://127.0.0.1:${port}`);
}
