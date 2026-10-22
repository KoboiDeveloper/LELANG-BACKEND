export async function sendOtpEmail(to: string, otp: string, purpose: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.BREVO_FROM_EMAIL || "noreply@amscorp.co.id";
  const fromName = process.env.BREVO_FROM_NAME || "E-Lelang";

  const subject =
    purpose === "reset" ? "OTP Reset Password E-Lelang" : "OTP Registrasi E-Lelang";
  const html = `<p>Kode OTP Anda: <strong>${otp}</strong></p><p>Berlaku 10 menit. Jangan bagikan kode ini.</p>`;

  // Local/dev only: allow logging OTP when key is intentionally unset.
  if (!apiKey) {
    if (process.env.ALLOW_OTP_CONSOLE === "1") {
      console.warn(`[email] BREVO_API_KEY missing — OTP for ${to}: ${otp}`);
      return;
    }
    throw new Error(
      "BREVO_API_KEY belum dikonfigurasi di server — email OTP tidak bisa dikirim",
    );
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] Brevo failed ${res.status}: ${text}`);
    throw new Error(`Gagal kirim email OTP (${res.status})`);
  }
}
