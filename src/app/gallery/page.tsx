'use client';
import Image from 'next/image';
import { useState } from 'react';

const images = Array.from({ length: 6 }).map((_, i) => `/gallery/${i + 1}.jpg`);

export default function GalleryPage() {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className="p-8">
      <h1 className="text-3xl mb-4">Gallery</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {images.map((src) => (
          <button key={src} onClick={() => setActive(src)}>
            <Image src={src} alt="detail" width={300} height={200} className="object-cover" />
          </button>
        ))}
      </div>
      {active && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center"
          onClick={() => setActive(null)}
        >
          <Image src={active} alt="detail" width={800} height={600} />
        </div>
      )}
    </div>
  );
}
