import { prisma } from '../src/lib/prisma';

async function main() {
  await prisma.serviceConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      basicPrice: 100,
      premiumPrice: 200,
      luxuryPrice: 300,
    },
  });
  await prisma.appointment.createMany({
    data: [
      {
        ref: 'A1',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '123456789',
        vehicle: 'Model 3',
        service: 'BASIC',
        startsAt: new Date(),
      },
      {
        ref: 'B2',
        name: 'Bob',
        email: 'bob@example.com',
        phone: '987654321',
        vehicle: 'Model Y',
        service: 'PREMIUM',
        startsAt: new Date(),
      },
      {
        ref: 'C3',
        name: 'Carol',
        email: 'carol@example.com',
        phone: '555555555',
        vehicle: 'Model S',
        service: 'LUXURY',
        startsAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});
