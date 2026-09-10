const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendRecruiterEmail(input: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new Error("Recruiter email is not configured. Set RESEND_API_KEY and AUTH_EMAIL_FROM.");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return true;
}

export function verificationUrl(token: string): string {
  const base = process.env.RECRUITER_PORTAL_URL ?? "https://headsbaseinc.com";
  return `${base.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token: string): string {
  const base = process.env.RECRUITER_PORTAL_URL ?? "https://headsbaseinc.com";
  return `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}
