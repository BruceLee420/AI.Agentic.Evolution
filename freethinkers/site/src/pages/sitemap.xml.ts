/**
 * Sitemap. Certificate pages are included deliberately: they're what QR scans
 * land on, and they should be findable on their own.
 */
import pieces from '../data/pieces.json';

const SITE = 'https://freethinkers.ai';

export const GET = () => {
  const urls = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/vault`, priority: '0.4' },
    ...(pieces as any[]).flatMap((p) => [
      { loc: `${SITE}/art/${p.id}`, priority: '0.9' },
      { loc: `${SITE}/a/${p.id}`, priority: '0.6' },
    ]),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'content-type': 'application/xml' } });
};
