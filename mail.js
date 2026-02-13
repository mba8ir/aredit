const nodemailer = require('nodemailer');

let transporter = null;

// Only create transporter if SMTP is configured
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetEmail(toEmail, code) {
  if (!transporter) {
    console.log(`[Password Reset] SMTP not configured. Code for ${toEmail}: ${code}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@rayatalfursan.com',
      to: toEmail,
      subject: 'راية الفرسان - رمز إعادة تعيين كلمة المرور',
      html: `
        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #e94560; text-align: center;">راية الفرسان</h2>
          <p>مرحباً،</p>
          <p>لقد طلبت إعادة تعيين كلمة المرور الخاصة بك. استخدم الرمز التالي:</p>
          <div style="background: #1a1a2e; color: #e94560; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>هذا الرمز صالح لمدة <strong>15 دقيقة</strong> فقط.</p>
          <p>إذا لم تطلب إعادة تعيين كلمة المرور، تجاهل هذا البريد.</p>
          <hr style="border: none; border-top: 1px solid #333; margin: 20px 0;">
          <p style="color: #888; font-size: 12px; text-align: center;">راية الفرسان - منتدى عربي للنقاشات والمجتمعات</p>
        </div>
      `,
    });
    console.log(`[Password Reset] Email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`[Password Reset] Failed to send email to ${toEmail}:`, err.message);
    console.log(`[Password Reset] Fallback - Code for ${toEmail}: ${code}`);
    return false;
  }
}

async function sendVerificationEmail(toEmail, code) {
  if (!transporter) {
    console.log(`[Email Verify] SMTP not configured. Code for ${toEmail}: ${code}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@rayatalfursan.com',
      to: toEmail,
      subject: 'راية الفرسان - رمز التحقق من البريد الإلكتروني',
      html: `
        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #e94560; text-align: center;">راية الفرسان</h2>
          <p>مرحباً،</p>
          <p>شكراً لتسجيلك في راية الفرسان! استخدم الرمز التالي للتحقق من بريدك الإلكتروني:</p>
          <div style="background: #1a1a2e; color: #e94560; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>هذا الرمز صالح لمدة <strong>15 دقيقة</strong> فقط.</p>
          <hr style="border: none; border-top: 1px solid #333; margin: 20px 0;">
          <p style="color: #888; font-size: 12px; text-align: center;">راية الفرسان - منتدى عربي للنقاشات والمجتمعات</p>
        </div>
      `,
    });
    console.log(`[Email Verify] Email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error(`[Email Verify] Failed to send email to ${toEmail}:`, err.message);
    console.log(`[Email Verify] Fallback - Code for ${toEmail}: ${code}`);
    return false;
  }
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };
