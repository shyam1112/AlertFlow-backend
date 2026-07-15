import express from 'express';
import nodemailer from 'nodemailer';
import logger from '../../common/logger';

const router = express.Router();

const ALERTFLOW_EMAIL = 'alertflow00@gmail.com';

const TYPE_LABELS = {
  bug: 'Bug Report',
  data: 'Data Issue',
  custom: 'Custom Setup Request',
  feature: 'Feature Request',
  other: 'General Enquiry',
};

router.post('/', async (req, res, next) => {
  try {
    const { from_email, subject, type, message } = req.body;

    if (!from_email || !subject || !message) {
      return res.status(400).json({ message: 'from_email, subject, and message are required' });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      logger.warn('EMAIL_USER/EMAIL_PASS not set — cannot send contact email');
      return res.status(503).json({ message: 'Email service not configured on server' });
    }

    const typeLabel = TYPE_LABELS[type] || 'General Enquiry';
    const shopName = req.shopName || 'unknown';

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"AlertFlow App" <${process.env.EMAIL_USER}>`,
      to: ALERTFLOW_EMAIL,
      replyTo: from_email,
      subject: `[AlertFlow] ${typeLabel}: ${subject}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <div style="background:#1d4ed8;padding:16px 24px;">
            <h1 style="color:#fff;margin:0;font-size:18px;">AlertFlow — ${typeLabel}</h1>
          </div>
          <div style="padding:24px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr><td style="padding:8px 0;color:#6b7280;width:140px;">From</td><td style="padding:8px 0;font-weight:600;">${from_email}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Shop</td><td style="padding:8px 0;">${shopName}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Type</td><td style="padding:8px 0;">${typeLabel}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Subject</td><td style="padding:8px 0;">${subject}</td></tr>
            </table>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;">
              <p style="margin:0;white-space:pre-wrap;font-size:14px;line-height:1.6;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
            </div>
            <p style="margin-top:20px;font-size:12px;color:#9ca3af;">Reply directly to this email to respond to ${from_email}</p>
          </div>
        </div>
      `,
    });

    logger.info(`Contact email sent from ${from_email} (${shopName}): [${typeLabel}] ${subject}`);
    res.json({ message: 'Message sent successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
