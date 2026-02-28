import { Resend } from 'resend';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'noreply@muxvo.com';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (resend) return resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  resend = new Resend(apiKey);
  return resend;
}

const PURPOSE_LABELS: Record<string, { subject: string; heading: string }> = {
  login: { subject: 'Muxvo 登录验证码', heading: 'Muxvo 登录验证码' },
  register: { subject: 'Muxvo 注册验证码', heading: 'Muxvo 注册验证码' },
  'reset-password': { subject: 'Muxvo 重置密码验证码', heading: 'Muxvo 重置密码验证码' },
};

export async function sendVerificationEmail(
  to: string,
  code: string,
  purpose: 'login' | 'register' | 'reset-password' = 'login',
): Promise<void> {
  const client = getResend();
  const labels = PURPOSE_LABELS[purpose] ?? PURPOSE_LABELS.login;

  if (!client) {
    // Dev mode fallback: log to console
    console.log(`[email-dev] Verification code for ${to} (${purpose}): ${code}`);
    return;
  }

  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: labels.subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin-bottom: 16px;">${labels.heading}</h2>
        <p style="font-size: 16px; color: #333;">Your verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111; margin: 24px 0;">${code}</p>
        <p style="font-size: 14px; color: #666;">Valid for 5 minutes. If you did not request this code, please ignore this email.</p>
      </div>
    `,
  });
}
