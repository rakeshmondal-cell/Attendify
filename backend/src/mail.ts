import nodemailer from "nodemailer";

const host = process.env.MAIL_HOST ?? "smtp.gmail.com";
const port = Number(process.env.MAIL_PORT ?? 587);
const user = process.env.MAIL_USERNAME ?? "";
const pass = process.env.MAIL_PASSWORD ?? "";
const from = process.env.MAIL_FROM ?? user;
const enabled = Boolean(user && pass);

const transporter = enabled
  ? nodemailer.createTransport({
      host,
      port,
      secure: process.env.MAIL_SMTP_SSL === "true" || port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: process.env.MAIL_TLS_REJECT_UNAUTHORIZED !== "false",
      },
    })
  : null;

export function mailConfigured(): boolean {
  return enabled;
}

function purposeTitle(purpose: string): string {
  switch (purpose) {
    case "ACTIVATION":
      return "Verify your Attendify work email";
    case "PASSCODE_RECOVERY":
      return "Attendify passcode recovery code";
    case "LOGIN":
      return "Your Attendify sign-in code";
    case "RECOVERY":
      return "Attendify device recovery";
    case "WEB":
      return "Attendify HR sign-in code";
    default:
      return "Your Attendify verification code";
  }
}

function purposeBody(purpose: string, code: string): string {
  const minutes = 5;
  const lines = [
    `Your Attendify verification code is ${code}.`,
    `It expires in ${minutes} minutes.`,
    "",
  ];
  if (purpose === "ACTIVATION") {
    lines.push("Use this code in the Attendify employee app to verify your work email, then set up fingerprint.");
  } else if (purpose === "PASSCODE_RECOVERY") {
    lines.push("Use this code to reset your Attendify app passcode. The app will stay locked until you enter the new passcode we email next.");
  } else if (purpose === "LOGIN") {
    lines.push("This sign-in method is no longer used. Update the Attendify app.");
  } else if (purpose === "RECOVERY") {
    lines.push("Confirm this email, then complete phone setup in Attendify.");
  } else if (purpose === "WEB") {
    lines.push("Use this code to sign in to the Attendify HR portal.");
  }
  lines.push("", "If you did not request this code, you can ignore this email.");
  return lines.join("\n");
}

export async function sendOtpEmail(to: string, purpose: string, code: string): Promise<void> {
  if (!transporter || !from) {
    throw new Error("SMTP is not configured. Set MAIL_USERNAME and MAIL_PASSWORD.");
  }
  await transporter.sendMail({
    from: `Attendify <${from}>`,
    to,
    subject: purposeTitle(purpose),
    text: purposeBody(purpose, code),
    html: `<p>${purposeBody(purpose, code).replaceAll("\n", "<br/>")}</p>`,
  });
}

export async function sendAppPasscodeEmail(to: string, passcode: string, reason: "setup" | "reset"): Promise<void> {
  if (!transporter || !from) {
    throw new Error("SMTP is not configured. Set MAIL_USERNAME and MAIL_PASSWORD.");
  }
  const subject =
    reason === "setup"
      ? "Your Attendify app passcode"
      : "Your new Attendify app passcode";
  const body = [
    reason === "setup"
      ? "Your Attendify phone is set up. Keep this app passcode safe — you need it if fingerprint unlock fails."
      : "Your Attendify app passcode was reset. Enter this new passcode in the app to unlock. Your previous passcode no longer works.",
    "",
    `App passcode: ${passcode}`,
    "",
    "Do not share this passcode. Attendify never asks for your phone screen-lock PIN.",
    "",
    "If you did not request this, contact HR.",
  ].join("\n");
  await transporter.sendMail({
    from: `Attendify <${from}>`,
    to,
    subject,
    text: body,
    html: `<p>${body.replaceAll("\n", "<br/>")}</p>`,
  });
}

export async function sendPasscodeChangedEmail(to: string): Promise<void> {
  if (!transporter || !from) {
    throw new Error("SMTP is not configured. Set MAIL_USERNAME and MAIL_PASSWORD.");
  }
  const body = [
    "Your Attendify app passcode was changed on your registered phone.",
    "",
    "If you made this change, no further action is needed. Your previous passcode no longer works.",
    "",
    "If you did not change it, contact HR and use Forgot passcode on the lock screen.",
    "",
    "Attendify never emails your new chosen passcode.",
  ].join("\n");
  await transporter.sendMail({
    from: `Attendify <${from}>`,
    to,
    subject: "Attendify app passcode changed",
    text: body,
    html: `<p>${body.replaceAll("\n", "<br/>")}</p>`,
  });
}

export async function sendHrAlertEmail(to: string[], subject: string, body: string): Promise<void> {
  if (!transporter || !from) {
    throw new Error("SMTP is not configured. Set MAIL_USERNAME and MAIL_PASSWORD.");
  }
  const recipients = [...new Set(to.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return;
  await transporter.sendMail({
    from: `Attendify <${from}>`,
    to: recipients.join(", "),
    subject,
    text: body,
    html: `<p>${body.replaceAll("\n", "<br/>")}</p>`,
  });
}
