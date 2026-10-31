async function sendEmail({ to, subject, text, html }) {
  const { BREVO_API_KEY, EMAIL_FROM_EMAIL } = process.env;
  const senderName = process.env.EMAIL_FROM_NAME?.trim() || "CoinDash";
  if (!BREVO_API_KEY || !EMAIL_FROM_EMAIL) {
    const error = new Error("Email delivery is not configured.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: EMAIL_FROM_EMAIL },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = new Error("Email provider rejected the message.");
    error.code = "EMAIL_DELIVERY_FAILED";
    error.status = response.status;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function buildEmailHtml({ preheader, eyebrow, title, intro, action, details = [], note }) {
  const detailRows = details.map(({ label, value }) => `
                  <tr>
                    <td style="padding:8px 0;color:#8e8aa8;font-size:13px;line-height:20px;vertical-align:top;">${escapeHtml(label)}</td>
                    <td style="padding:8px 0 8px 18px;color:#f5f3ff;font-size:13px;font-weight:700;line-height:20px;text-align:right;vertical-align:top;">${escapeHtml(value)}</td>
                  </tr>`).join("");
  const detailsBlock = detailRows ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:collapse;border-top:1px solid #302b4d;border-bottom:1px solid #302b4d;">
                ${detailRows}
              </table>` : "";
  const actionBlock = action ? `
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 24px;">
                <tr>
                  <td style="border-radius:10px;background:#63e6ff;box-shadow:0 8px 24px rgba(99,230,255,.18);">
                    <a href="${escapeHtml(action.href)}" style="display:inline-block;padding:13px 22px;color:#100d1d;font-size:14px;font-weight:800;line-height:20px;text-decoration:none;">${escapeHtml(action.label)} &nbsp;&#8594;</a>
                  </td>
                </tr>
              </table>` : "";
  const noteBlock = note ? `
              <p style="margin:24px 0 0;padding:16px 18px;border-left:3px solid #8b5cf6;border-radius:0 8px 8px 0;background:#19152d;color:#b8b3ce;font-size:12px;line-height:19px;">${escapeHtml(note)}</p>` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0d0a18;color:#f5f3ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#0d0a18;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border:1px solid #302b4d;border-radius:16px;background:#141022;box-shadow:0 18px 60px rgba(0,0,0,.35);">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #302b4d;">
                <span style="color:#f5f3ff;font-size:20px;font-weight:800;letter-spacing:-.4px;">Coin<span style="color:#63e6ff;">Dash</span></span>
                <span style="float:right;padding-top:4px;color:#77718f;font-size:10px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;">Market intelligence</span>
              </td>
            </tr>
            <tr>
              <td style="padding:38px 32px 34px;">
                <p style="margin:0 0 12px;color:#63e6ff;font-size:11px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                <h1 style="margin:0 0 16px;color:#f5f3ff;font-size:28px;line-height:36px;letter-spacing:-.6px;">${escapeHtml(title)}</h1>
                <p style="margin:0;color:#b8b3ce;font-size:15px;line-height:24px;">${escapeHtml(intro)}</p>${detailsBlock}${actionBlock}${noteBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px;border-top:1px solid #302b4d;color:#77718f;font-size:11px;line-height:18px;">
                This is an automated account message from CoinDash. Please do not reply to this email.<br>
                &copy; CoinDash &middot; Track clearly. Decide confidently.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function sendWelcomeEmail(user) {
  const plainName = String(user.display_name || "there");
  return sendEmail({
    to: user.email,
    subject: "Welcome to CoinDash",
    text: `Hi ${plainName}, thank you for creating your CoinDash account. You can now track markets, build your watchlist, and manage price alerts.`,
    html: buildEmailHtml({
      preheader: "Your CoinDash account is ready.",
      eyebrow: "Welcome aboard",
      title: `Hi ${plainName}, your account is ready`,
      intro: "You now have one place to follow the market, save the assets you care about, and set alerts for meaningful price moves.",
      details: [
        { label: "Watchlists", value: "Save your market" },
        { label: "Price alerts", value: "Stay ahead of moves" },
        { label: "Market data", value: "Track with clarity" },
      ],
      note: "For your security, CoinDash will never ask you to send your password or verification codes by email.",
    }),
  });
}

function describeUserAgent(value) {
  const userAgent = typeof value === "string" ? value : "";
  let browser = "Unknown browser";
  if (/Edg\//.test(userAgent)) browser = "Microsoft Edge";
  else if (/OPR\//.test(userAgent)) browser = "Opera";
  else if (/Firefox\//.test(userAgent)) browser = "Firefox";
  else if (/Chrome\//.test(userAgent)) browser = "Chrome";
  else if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) browser = "Safari";

  let device = "Unknown device";
  if (/iPhone/.test(userAgent)) device = "iPhone";
  else if (/iPad/.test(userAgent)) device = "iPad";
  else if (/Android/.test(userAgent)) device = "Android device";
  else if (/Windows/.test(userAgent)) device = "Windows device";
  else if (/Macintosh|Mac OS X/.test(userAgent)) device = "Mac";
  else if (/Linux/.test(userAgent)) device = "Linux device";

  return `${browser} on ${device}`;
}

function getSecurityAction() {
  try {
    const url = new URL("/forgot-password", process.env.APP_BASE_URL);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return undefined;
    return { label: "Secure my account", href: url.href };
  } catch {
    return undefined;
  }
}

function sendLoginNotificationEmail(user, context = {}) {
  const plainName = String(user.display_name || "there");
  const signedInAt = context.signedInAt instanceof Date
    ? context.signedInAt
    : new Date(context.signedInAt || Date.now());
  const time = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(signedInAt);
  const device = describeUserAgent(context.userAgent);
  const ipAddress = String(context.ipAddress || "Unavailable");
  const action = getSecurityAction();
  const securityLink = action ? `\nSecure your account: ${action.href}` : "";

  return sendEmail({
    to: user.email,
    subject: "New sign-in to your CoinDash account",
    text: `Hi ${plainName},\n\nA successful sign-in to your CoinDash account was detected.\n\nTime: ${time}\nDevice: ${device}\nIP address: ${ipAddress}\n\nIf this was you, no action is needed. If you do not recognize this activity, reset your password immediately.${securityLink}`,
    html: buildEmailHtml({
      preheader: "A successful sign-in to your CoinDash account was detected.",
      eyebrow: "Account security",
      title: "New sign-in detected",
      intro: `Hi ${plainName}, we noticed a successful sign-in to your CoinDash account. Review the details below to confirm it was you.`,
      action,
      details: [
        { label: "Time", value: time },
        { label: "Device", value: device },
        { label: "IP address", value: ipAddress },
      ],
      note: "If this was you, no action is needed. If you do not recognize this activity, secure your account immediately by resetting your password.",
    }),
  });
}

module.exports = {
  buildEmailHtml,
  describeUserAgent,
  sendEmail,
  sendLoginNotificationEmail,
  sendWelcomeEmail,
};
