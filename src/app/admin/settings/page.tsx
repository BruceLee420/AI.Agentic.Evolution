import { getServerSession } from 'next-auth';
import { authOptions } from '../../api/auth/[...nextauth]/authOptions';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/admin');
  const config = await prisma.serviceConfig.findFirst();
  async function update(formData: FormData) {
    'use server';
    const accept = formData.get('accept') === 'on';
    const basic = Number(formData.get('basic'));
    const premium = Number(formData.get('premium'));
    const luxury = Number(formData.get('luxury'));
    await prisma.serviceConfig.upsert({
      where: { id: 1 },
      update: { acceptBookings: accept, basicPrice: basic, premiumPrice: premium, luxuryPrice: luxury },
      create: { acceptBookings: accept, basicPrice: basic, premiumPrice: premium, luxuryPrice: luxury },
    });
  }
  return (
    <form action={update} className="p-8 space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="accept" defaultChecked={config?.acceptBookings} /> Accept new bookings
      </label>
      <input name="basic" defaultValue={config?.basicPrice} className="p-2 text-black" />
      <input name="premium" defaultValue={config?.premiumPrice} className="p-2 text-black" />
      <input name="luxury" defaultValue={config?.luxuryPrice} className="p-2 text-black" />
      <button className="bg-gold text-black px-4 py-2">Save</button>
    </form>
  );
}
