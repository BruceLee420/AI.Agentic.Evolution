import { NextRequest, NextResponse } from 'next/server';
import { appointmentUpdateSchema } from '@/lib/validation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/authOptions';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const json = await req.json();
  const parsed = appointmentUpdateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const appointment = await prisma.appointment.update({
    where: { id: params.id },
    data: parsed.data,
  });
  return NextResponse.json(appointment);
}
