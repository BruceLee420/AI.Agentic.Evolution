import nodemailer from 'nodemailer';
import { Resend } from 'resend';

export async function sendEmail({
  to,
  subject,
  html,
  text,
  ics,
}: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  ics: string;
}) {
  const provider = process.env.EMAIL_PROVIDER || 'console';
  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.OWNER_EMAIL!,
      to,
      subject,
      html,
      text,
      attachments: [
        { filename: 'booking.ics', content: ics, contentType: 'text/calendar' },
      ],
    });
  } else if (provider === 'smtp') {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
    await transporter.sendMail({
      from: process.env.OWNER_EMAIL!,
      to,
      subject,
      html,
      text,
      alternatives: [
        { content: ics, contentType: 'text/calendar', filename: 'booking.ics' },
      ],
    });
  } else {
    console.log('Email to', to, subject, text);
    return ics;
  }
}
