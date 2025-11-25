import { z } from 'zod';

export const appointmentSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  vehicle: z.string().min(1),
  serviceTier: z.enum(['BASIC', 'PREMIUM', 'LUXURY']),
  preferredDate: z.string(),
  preferredTime: z.string(),
  location: z.string().optional(),
  notes: z.string().optional(),
  acceptTerms: z.boolean(),
});

export const appointmentUpdateSchema = z.object({
  status: z.enum(['NEW', 'CONFIRMED', 'COMPLETED', 'CANCELED']).optional(),
  notes: z.string().optional(),
});
