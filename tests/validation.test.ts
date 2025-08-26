import { describe, it, expect } from 'vitest';
import { appointmentSchema } from '@/lib/validation';

describe('appointmentSchema', () => {
  it('fails on missing fields', () => {
    const result = appointmentSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
