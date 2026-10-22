import nodemailer from "nodemailer";

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

async function sendViaBrevo(payload: MailPayload): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("BREVO_API_KEY belum dikonfigurasi");
  }

  // Must be a verified sender in Brevo (check /v3/senders).
  // noreply@amscorp.co.id is NOT verified → Brevo API 201 but event=error, inbox kosong.
  const fromEmail =
    process.env.BREVO_FROM_EMAIL?.trim() || "layarbaru1@gmail.com";
  const fromName = process.env.BREVO_FROM_NAME?.trim() || "E-Lelang";

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: payload.to }],
      subject: payload.subject,
      htmlContent: payload.html,
      textContent: payload.text,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] Brevo failed ${res.status}: ${text}`);
    throw new Error(`Gagal kirim email OTP via Brevo (${res.status})`);
  }
}

async function sendViaSmtp(payload: MailPayload): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    (user ? `E-Lelang <${user}>` : undefined);

  if (!host || !user || !pass || !from) {
    throw new Error("SMTP belum dikonfigurasi lengkap");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
}

export async function sendOtpEmail(
  to: string,
  otp: string,
  purpose: string,
): Promise<void> {
  const subject =
    purpose === "reset" ? "OTP Reset Password E-Lelang" : "OTP Registrasi E-Lelang";
  const html = `<p>Kode OTP Anda: <strong>${otp}</strong></p><p>Berlaku 10 menit. Jangan bagikan kode ini.</p>`;
  const text = `Kode OTP Anda: ${otp}\nBerlaku 10 menit. Jangan bagikan kode ini.`;
  const payload: MailPayload = { to, subject, html, text };

  const preferSmtp =
    process.env.EMAIL_PROVIDER?.trim().toLowerCase() === "smtp" ||
    (!!process.env.SMTP_HOST?.trim() && !process.env.BREVO_API_KEY?.trim());

  try {
    if (preferSmtp) {
      await sendViaSmtp(payload);
      return;
    }
    if (process.env.BREVO_API_KEY?.trim()) {
      await sendViaBrevo(payload);
      return;
    }
    if (process.env.SMTP_HOST?.trim()) {
      await sendViaSmtp(payload);
      return;
    }
  } catch (err) {
    // If Brevo fails and SMTP is available, fall back once.
    if (!preferSmtp && process.env.SMTP_HOST?.trim()) {
      console.warn("[email] Brevo failed, falling back to SMTP", err);
      await sendViaSmtp(payload);
      return;
    }
    throw err;
  }

  if (process.env.ALLOW_OTP_CONSOLE === "1") {
    console.warn(`[email] no provider — OTP for ${to}: ${otp}`);
    return;
  }

  throw new Error(
    "Email provider belum dikonfigurasi (BREVO_API_KEY atau SMTP_*)",
  );
}
