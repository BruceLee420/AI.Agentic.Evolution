import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/appointments/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: { create: vi.fn().mockResolvedValue({ id: '1' }) },
  },
}));
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }));

process.env.OWNER_EMAIL = 'owner@example.com';

describe('POST /api/appointments', () => {
  it('creates appointment and returns ref', async () => {
    const body = {
      name: 'Test',
      email: 'test@example.com',
      phone: '1234567',
      vehicle: 'Model 3',
      serviceTier: 'BASIC',
      preferredDate: '2024-01-01',
      preferredTime: '10:00',
      acceptTerms: true,
    } as any;
    const req = new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
