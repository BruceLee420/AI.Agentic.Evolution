import Link from 'next/link';
import { prisma } from '@/lib/prisma';

export default async function HomePage() {
  const config = await prisma.serviceConfig.findFirst();
  const prices = {
    BASIC: config?.basicPrice ?? 100,
    PREMIUM: config?.premiumPrice ?? 200,
    LUXURY: config?.luxuryPrice ?? 300,
  } as Record<string, number>;
  return (
    <div>
      <section className="text-center py-20">
        <h1 className="text-5xl font-bold mb-4">Tesla Detailing</h1>
        <p className="mb-6 text-teal">Premium care for your Tesla</p>
        <Link className="px-6 py-3 bg-gold text-black rounded" href="/book">
          Book Now
        </Link>
      </section>
      <section className="py-10 max-w-4xl mx-auto">
        <h2 className="text-2xl mb-4">Services</h2>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(prices).map(([tier, price]) => (
            <li key={tier} className="border p-4 rounded">
              <h3 className="text-xl mb-2">{tier}</h3>
              <p>${price}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="py-10 text-center">
        <h2 className="text-2xl mb-4">Testimonials</h2>
        <p>Coming soon...</p>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: 'Tesla Detailing',
          }),
        }}
      />
    </div>
  );
}
