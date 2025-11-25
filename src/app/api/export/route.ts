import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/authOptions';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { from, to } = await req.json().catch(() => ({ from: '', to: '' }));
  const start = from ? new Date(from) : new Date(0);
  const end = to ? new Date(to) : new Date('2999-01-01');
  const appointments = await prisma.appointment.findMany({
    where: { startsAt: { gte: start, lte: end } },
  });
  const rows = [
    ['ref', 'name', 'email', 'service', 'startsAt', 'status'],
    ...appointments.map((a: any) => [a.ref, a.name, a.email, a.service, a.startsAt.toISOString(), a.status]),
  ];
  const csv = rows.map((r) => r.join(',')).join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="appointments.csv"',
    },
  });
}
