'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { appointmentSchema } from '@/lib/validation';
import { z } from 'zod';
import { useState } from 'react';

export default function BookPage() {
  const [ref, setRef] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof appointmentSchema>>({
    resolver: zodResolver(appointmentSchema),
  });
  const onSubmit = handleSubmit(async (data) => {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    setRef(json.ref);
  });
  return (
    <div className="p-8 max-w-xl mx-auto">
      <h1 className="text-3xl mb-4">Book a Detailing</h1>
      {ref ? (
        <p>Your booking reference: {ref}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <input placeholder="Name" {...register('name')} className="w-full p-2 text-black" />
          {errors.name && <p>{errors.name.message}</p>}
          <input placeholder="Email" {...register('email')} className="w-full p-2 text-black" />
          {errors.email && <p>{errors.email.message}</p>}
          <input placeholder="Phone" {...register('phone')} className="w-full p-2 text-black" />
          <input placeholder="Vehicle" {...register('vehicle')} className="w-full p-2 text-black" />
          <select {...register('serviceTier')} className="w-full p-2 text-black">
            <option value="BASIC">Basic</option>
            <option value="PREMIUM">Premium</option>
            <option value="LUXURY">Luxury</option>
          </select>
          <input type="date" {...register('preferredDate')} className="w-full p-2 text-black" />
          <input type="time" {...register('preferredTime')} className="w-full p-2 text-black" />
          <input placeholder="Location" {...register('location')} className="w-full p-2 text-black" />
          <textarea placeholder="Notes" {...register('notes')} className="w-full p-2 text-black" />
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('acceptTerms')} /> Accept terms
          </label>
          <button disabled={isSubmitting} className="px-4 py-2 bg-gold text-black">
            Submit
          </button>
        </form>
      )}
    </div>
  );
}
