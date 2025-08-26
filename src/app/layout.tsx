import './globals.css';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Tesla Detailing',
  description: 'Premium detailing for Tesla vehicles',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={cn(inter.className, 'min-h-screen flex flex-col')}>
        <header className="p-4 flex items-center gap-4 border-b border-gray-800">
          <img src="/logo.jpg" alt="logo" className="w-8 h-8" />
          <a href="/" className="font-bold">Tesla Detailing</a>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="p-4 text-center border-t border-gray-800">
          <img src="/logo.jpg" alt="logo" className="w-6 h-6 mx-auto mb-2" />
          <p>© {new Date().getFullYear()} Tesla Detailing</p>
        </footer>
      </body>
    </html>
  );
}
