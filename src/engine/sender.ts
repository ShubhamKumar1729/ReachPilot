import nodemailer from "nodemailer";
import { config, isSmtpConfigured } from "./../lib/config";

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachmentPath: string;
  attachmentName: string;
}

export function assertSmtpReady() {
  if (!isSmtpConfigured()) {
    throw new Error(
      "Gmail credentials missing. Set GMAIL_ID and GMAIL_APP_PASSWORD in the .env file."
    );
  }
}

/** Send the submission email via Gmail SMTP (app-password auth). CC/BCC from env, skipped when empty. */
export async function sendEmail(args: SendArgs): Promise<void> {
  assertSmtpReady();
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.gmailId,
      pass: config.gmailAppPassword,
    },
  });

  await transporter.sendMail({
    from: `${config.candidate.name} <${config.gmailId}>`,
    to: args.to,
    ...(config.ccEmails.length > 0 ? { cc: config.ccEmails.join(", ") } : {}),
    ...(config.bccEmails.length > 0 ? { bcc: config.bccEmails.join(", ") } : {}),
    subject: args.subject,
    text: args.text,
    html: args.html,
    attachments: [
      {
        filename: args.attachmentName,
        path: args.attachmentPath,
      },
    ],
  });
  transporter.close();
}
