# Tesla Detailing

Cross-platform booking app and marketing site built with Next.js 14.

## Features
- Next.js App Router with TypeScript
- Tailwind CSS + shadcn/ui styling
- Prisma ORM with SQLite (switchable to Postgres)
- PWA with `next-pwa`
- Email via Resend or SMTP with iCalendar attachment
- Authentication with next-auth credentials for admin dashboard
- Capacitor config for mobile builds
- Unit tests with Vitest

## Development

```bash
pnpm install
pnpm prisma db push
pnpm seed
pnpm dev
```

## Switch to Postgres
Set `DATABASE_URL` in `.env` to a Postgres connection string and run `pnpm prisma db push`.

## Deploy
Deploy on [Vercel](https://vercel.com). Ensure environment variables from `.env.example` are set.

## PWA
The site is installable as a PWA. Icons and manifest are in `public/`.

## Capacitor
Wrap the built app for mobile:
```bash
pnpm build && pnpm export
npx cap init
npx cap add ios && npx cap add android
npx cap copy
```

## Testing
`pnpm test`
