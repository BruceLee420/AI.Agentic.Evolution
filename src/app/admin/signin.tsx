'use client';
import { signIn } from 'next-auth/react';
import { FormEvent } from 'react';

export default function SignInForm() {
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    await signIn('credentials', { email, password, callbackUrl: '/admin' });
  }
  return (
    <form onSubmit={handle} className="p-8 space-y-4">
      <input name="email" type="email" placeholder="Email" className="p-2 text-black" />
      <input name="password" type="password" placeholder="Password" className="p-2 text-black" />
      <button className="px-4 py-2 bg-gold text-black">Sign in</button>
    </form>
  );
}
