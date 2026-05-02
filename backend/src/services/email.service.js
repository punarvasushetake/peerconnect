const fromEmail = process.env.EMAIL_FROM || 'Peer Connect <onboarding@resend.dev>';

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sendEmail = async ({ to, subject, html, text }) => {
  if (!to) {
    return { sent: false, reason: 'missing_recipient' };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log('[email:dev]', { to, subject, text });
    return { sent: false, reason: 'email_provider_not_configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to send email: ${detail}`);
  }

  return { sent: true };
};

const sendPeerSessionRequestEmail = async ({
  to,
  recipientName,
  requesterName,
  topic,
  acceptUrl,
}) => {
  const safeRecipient = recipientName || 'there';
  const safeRequester = requesterName || 'A peer';
  const safeTopic = topic || 'a learning session';
  const htmlRecipient = escapeHtml(safeRecipient);
  const htmlRequester = escapeHtml(safeRequester);
  const htmlTopic = escapeHtml(safeTopic);
  const htmlAcceptUrl = escapeHtml(acceptUrl);

  return sendEmail({
    to,
    subject: `${safeRequester} requested a Peer Connect video session`,
    text: `${safeRecipient}, ${safeRequester} requested a video session about "${safeTopic}". Accept and start the session here: ${acceptUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
        <p>Hi ${htmlRecipient},</p>
        <p><strong>${htmlRequester}</strong> requested a video session about <strong>${htmlTopic}</strong>.</p>
        <p>
          <a href="${htmlAcceptUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">
            Accept and start video session
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${htmlAcceptUrl}">${htmlAcceptUrl}</a></p>
      </div>
    `,
  });
};

const sendPeerSessionUpdateEmail = async ({
  to,
  recipientName,
  peerName,
  topic,
  status,
  sessionUrl,
}) => {
  const safeRecipient = recipientName || 'there';
  const safePeer = peerName || 'Your peer';
  const safeTopic = topic || 'your learning session';
  const actionText = status === 'accepted'
    ? `${safePeer} accepted your video session request. You can join now.`
    : `${safePeer} declined your video session request. You can request another peer.`;
  const htmlActionText = escapeHtml(actionText);
  const htmlRecipient = escapeHtml(safeRecipient);
  const htmlTopic = escapeHtml(safeTopic);
  const htmlSessionUrl = escapeHtml(sessionUrl);

  return sendEmail({
    to,
    subject: status === 'accepted'
      ? `${safePeer} accepted your Peer Connect session`
      : `${safePeer} declined your Peer Connect session`,
    text: `${safeRecipient}, ${actionText} Topic: ${safeTopic}. Open Peer Connect: ${sessionUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">
        <p>Hi ${htmlRecipient},</p>
        <p>${htmlActionText}</p>
        <p>Topic: <strong>${htmlTopic}</strong></p>
        <p>
          <a href="${htmlSessionUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;">
            Open Peer Connect
          </a>
        </p>
      </div>
    `,
  });
};

module.exports = {
  sendPeerSessionRequestEmail,
  sendPeerSessionUpdateEmail,
};
