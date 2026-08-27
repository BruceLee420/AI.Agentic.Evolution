/**
 * Sitemap. Every concept detail page is a potential entry point from search,
 * so they all belong in here — that's the whole reason /c/[id] exists.
 */
import concepts from '../data/concepts.json';

const SITE = 'https://ftwlabs.ai';

export const GET = () => {
  const urls = [
    { loc: `${SITE}/`, priority: '1.0' },
    ...(concepts as any[]).map((c) => ({ loc: `${SITE}/c/${c.id}`, priority: '0.7' })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'content-type': 'application/xml' } });
};
