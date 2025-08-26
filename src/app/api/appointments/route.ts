import { NextResponse, NextRequest } from 'next/server';
import { appointmentSchema } from '@/lib/validation';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rateLimit';
import { ulid } from 'ulid';
import { generateICS } from '@/lib/ics';
import { sendEmail } from '@/lib/email';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/authOptions';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const json = await req.json();
  const parsed = appointmentSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const data = parsed.data;
  const startsAt = new Date(`${data.preferredDate}T${data.preferredTime}:00`);
  const ref = ulid();
  const appointment = await prisma.appointment.create({
    data: {
      ref,
      name: data.name,
      email: data.email,
      phone: data.phone,
      vehicle: data.vehicle,
      service: data.serviceTier as any,
      startsAt,
      location: data.location,
      notes: data.notes,
    },
  });
  const summary = `Tesla Detailing - ${data.serviceTier}`;
  const description = `Ref ${ref}`;
  const ics = generateICS({ startsAt, summary, description });
  await sendEmail({
    to: [process.env.OWNER_EMAIL!, data.email],
    subject: `New booking ${ref}`,
    html: `<p>Booking ref ${ref}</p>`,
    text: `Booking ref ${ref}`,
    ics,
  });
  return NextResponse.json({ ref }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const search = req.nextUrl.searchParams;
  const page = Number(search.get('page') || '1');
  const size = Number(search.get('size') || '10');
  const data = await prisma.appointment.findMany({
    skip: (page - 1) * size,
    take: size,
    orderBy: { startsAt: 'desc' },
  });
  return NextResponse.json(data);
}
