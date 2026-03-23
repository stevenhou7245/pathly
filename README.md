This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Email Local Testing

### Environment

Add these values in `.env.local`:

```bash
BREVO_API_KEY=
FROM_EMAIL=
FROM_NAME=Pathly
EMAIL_DELIVERY_MODE=auto
EMAIL_DEBUG_LOGGING=true
EMAIL_DEBUG_LOG_CONTENT=false
EMAIL_TEST_RECIPIENT_OVERRIDE=
EMAIL_AUTOMATION_KEY=
```

`EMAIL_DELIVERY_MODE` behavior:

- `auto`: in non-production, send via Brevo when `BREVO_API_KEY` and `FROM_EMAIL` are set; otherwise use development fallback.
- `simulate`: do not send externally, return development mode and log if enabled.
- `disabled`: skip sending.
- `brevo`: send via Brevo (requires `BREVO_API_KEY` + `FROM_EMAIL`).

In production, delivery is always strict Brevo mode.

### Manual Trigger Endpoint (Dev)

Use `POST /api/email/testing/trigger` with JSON body.

Examples:

```bash
# welcome
curl -X POST http://localhost:3000/api/email/testing/trigger \
  -H "Content-Type: application/json" \
  -d '{"type":"welcome","to_email":"test@example.com","username":"Tester"}'

# AI reminder preview for user
curl -X POST http://localhost:3000/api/email/testing/trigger \
  -H "Content-Type: application/json" \
  -d '{"type":"ai_reminder","user_id":"00000000-0000-0000-0000-000000000000","dry_run":true}'
```

For batch automation testing:

```bash
curl -X POST http://localhost:3000/api/email/automation/run \
  -H "Content-Type: application/json" \
  -H "x-automation-key: YOUR_EMAIL_AUTOMATION_KEY" \
  -d '{"dry_run": true, "max_users": 20}'
```
