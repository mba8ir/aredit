const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const router = express.Router();

// Rate limiters for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'عدد المحاولات كثير جداً، حاول مرة أخرى بعد 15 دقيقة',
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'عدد المحاولات كثير جداً، حاول مرة أخرى لاحقاً',
});

// Avatar upload config
const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const uniqueName = 'avatar-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// Password complexity check
function isPasswordStrong(password) {
  if (password.length < 8) return false;
  if (!/[a-zA-Z\u0600-\u06FF]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

// Register page
router.get('/register', (req, res) => {
  res.render('register', { error: null, pageTitle: 'تسجيل' });
});

// Register handler
router.post('/register', authLimiter, async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password) {
    return res.render('register', { error: 'اسم المستخدم وكلمة المرور مطلوبان', pageTitle: 'تسجيل' });
  }

  if (username.length > 30) {
    return res.render('register', { error: 'اسم المستخدم طويل جداً (الحد الأقصى 30 حرف)', pageTitle: 'تسجيل' });
  }

  // Check Arabic letters and underscore only
  const arabicRegex = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF_]+$/;
  if (!arabicRegex.test(username)) {
    return res.render('register', { error: 'اسم المستخدم يجب أن يحتوي على حروف عربية وشرطة سفلية فقط (بدون مسافات أو أرقام أو رموز)', pageTitle: 'تسجيل' });
  }

  // Block inappropriate words
  const blockedWords = [
    'كلب', 'حمار', 'غبي', 'أحمق', 'منيك', 'زنا', 'عاهرة', 'شرموطة', 'قحبة',
    'لعنة', 'ابن_الكلب', 'خنزير', 'وسخ', 'نيك', 'طيز', 'زب', 'كس', 'متناك',
    'خول', 'ديوث', 'فاجر', 'فاسق', 'عرص', 'معرص', 'منيوك', 'مومس', 'ساقطة',
    'لوطي', 'زاني', 'سافل', 'وقح', 'نجس'
  ];
  const usernameLower = username.replace(/_/g, '');
  if (blockedWords.some(w => usernameLower.includes(w))) {
    return res.render('register', { error: 'اسم المستخدم يحتوي على كلمات غير مسموح بها', pageTitle: 'تسجيل' });
  }

  // Password strength
  if (!isPasswordStrong(password)) {
    return res.render('register', { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام', pageTitle: 'تسجيل' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.render('register', { error: 'اسم المستخدم مستخدم بالفعل', pageTitle: 'تسجيل' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)').run(username, hash, email || null);
    req.session.userId = result.lastInsertRowid;
    res.redirect('/');
  } catch (err) {
    res.render('register', { error: 'حدث خطأ، حاول مرة أخرى', pageTitle: 'تسجيل' });
  }
});

// Login page
router.get('/login', (req, res) => {
  res.render('login', { error: null, success: null, pageTitle: 'دخول' });
});

// Login handler
router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', success: null, pageTitle: 'دخول' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', success: null, pageTitle: 'دخول' });
  }

  req.session.userId = user.id;
  res.redirect('/');
});

// Logout (POST for CSRF safety)
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Keep GET logout as redirect for backwards compat
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { error: null, success: null, pageTitle: 'استعادة كلمة المرور' });
});

// Forgot password handler
router.post('/forgot-password', resetLimiter, (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.render('forgot-password', { error: 'البريد الإلكتروني مطلوب', success: null, pageTitle: 'استعادة كلمة المرور' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Always show success to prevent user enumeration
  if (!user) {
    return res.render('forgot-password', {
      error: null,
      success: 'إذا كان هذا البريد مسجلاً، سيتم إرسال رمز التحقق',
      pageTitle: 'استعادة كلمة المرور'
    });
  }

  // Invalidate previous tokens
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);

  // Generate cryptographically secure token and code
  const token = crypto.randomBytes(32).toString('hex');
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO password_resets (user_id, token, code, expires_at) VALUES (?, ?, ?, ?)').run(user.id, token, code, expiresAt);

  // In production, send email. For now, log to console.
  console.log(`[Password Reset] Code for ${email}: ${code}`);

  res.redirect(`/verify-code/${token}`);
});

// Verify code page
router.get('/verify-code/:token', (req, res) => {
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(req.params.token);

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return res.render('error', { message: 'رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية', pageTitle: 'خطأ' });
  }

  res.render('verify-code', { token: req.params.token, error: null, pageTitle: 'رمز التحقق' });
});

// Verify code handler with attempt limiting
router.post('/verify-code/:token', resetLimiter, (req, res) => {
  const { code } = req.body;
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(req.params.token);

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return res.render('error', { message: 'رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية', pageTitle: 'خطأ' });
  }

  // Check attempt count
  if (reset.attempts >= 5) {
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
    return res.render('error', { message: 'تم تجاوز عدد المحاولات المسموح بها. أعد طلب رمز جديد', pageTitle: 'خطأ' });
  }

  // Increment attempts
  db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);

  if (!code || code.trim() !== reset.code) {
    return res.render('verify-code', { token: req.params.token, error: 'رمز التحقق غير صحيح', pageTitle: 'رمز التحقق' });
  }

  db.prepare('UPDATE password_resets SET verified = 1 WHERE id = ?').run(reset.id);
  res.redirect(`/reset-password/${req.params.token}`);
});

// Reset password page
router.get('/reset-password/:token', (req, res) => {
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(req.params.token);

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return res.render('error', { message: 'رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية', pageTitle: 'خطأ' });
  }

  if (!reset.verified) {
    return res.redirect(`/verify-code/${req.params.token}`);
  }

  res.render('reset-password', { token: req.params.token, error: null, pageTitle: 'إعادة تعيين كلمة المرور' });
});

// Reset password handler
router.post('/reset-password/:token', resetLimiter, async (req, res) => {
  const { password, password_confirm } = req.body;

  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(req.params.token);

  if (!reset || new Date(reset.expires_at) < new Date()) {
    return res.render('error', { message: 'رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية', pageTitle: 'خطأ' });
  }

  if (!reset.verified) {
    return res.redirect(`/verify-code/${req.params.token}`);
  }

  if (!isPasswordStrong(password)) {
    return res.render('reset-password', { token: req.params.token, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حروف وأرقام', pageTitle: 'إعادة تعيين كلمة المرور' });
  }

  if (password !== password_confirm) {
    return res.render('reset-password', { token: req.params.token, error: 'كلمتا المرور غير متطابقتين', pageTitle: 'إعادة تعيين كلمة المرور' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
    res.render('login', { error: null, success: 'تم تغيير كلمة المرور بنجاح. سجل دخولك الآن', pageTitle: 'دخول' });
  } catch (err) {
    res.render('reset-password', { token: req.params.token, error: 'حدث خطأ، حاول مرة أخرى', pageTitle: 'إعادة تعيين كلمة المرور' });
  }
});

// Profile page
router.get('/u/:username', (req, res) => {
  const user = db.prepare('SELECT id, username, email, email_verified, avatar_url, bio, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).render('error', { message: 'المستخدم غير موجود', pageTitle: '404' });

  const posts = db.prepare(`
    SELECT p.*, c.name as community_name,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN communities c ON p.community_id = c.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(user.id);

  const comments = db.prepare(`
    SELECT cm.*, p.title as post_title, p.id as post_id
    FROM comments cm
    JOIN posts p ON cm.post_id = p.id
    WHERE cm.user_id = ?
    ORDER BY cm.created_at DESC
    LIMIT 20
  `).all(user.id);

  const followedCommunities = db.prepare(`
    SELECT c.* FROM communities c
    JOIN community_follows cf ON c.id = cf.community_id
    WHERE cf.user_id = ?
  `).all(user.id);

  // Karma
  const postKarma = db.prepare('SELECT COALESCE(SUM(score), 0) as total FROM posts WHERE user_id = ?').get(user.id).total;
  const commentKarma = db.prepare('SELECT COALESCE(SUM(score), 0) as total FROM comments WHERE user_id = ?').get(user.id).total;

  res.render('profile', {
    profileUser: user, posts, comments, followedCommunities,
    postKarma, commentKarma,
    pageTitle: user.username,
    pageDescription: `الملف الشخصي لـ ${user.username} في راية الفرسان`
  });
});

// Edit profile page
router.get('/settings', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  const user = db.prepare('SELECT id, username, email, email_verified, avatar_url, bio FROM users WHERE id = ?').get(res.locals.currentUser.id);
  res.render('settings', { profileUser: user, error: null, success: null, pageTitle: 'الإعدادات' });
});

// Update profile
router.post('/settings', avatarUpload.single('avatar'), (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const { bio } = req.body;
  const userId = res.locals.currentUser.id;

  let avatarUrl = res.locals.currentUser.avatar_url;
  if (req.file) {
    avatarUrl = '/uploads/' + req.file.filename;
  }

  db.prepare('UPDATE users SET bio = ?, avatar_url = ? WHERE id = ?').run(
    bio ? bio.substring(0, 500) : null,
    avatarUrl,
    userId
  );

  const user = db.prepare('SELECT id, username, email, email_verified, avatar_url, bio FROM users WHERE id = ?').get(userId);
  res.render('settings', { profileUser: user, error: null, success: 'تم تحديث الملف الشخصي', pageTitle: 'الإعدادات' });
});

// Notifications
router.get('/notifications', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const notifications = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(res.locals.currentUser.id);

  // Mark all as read
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(res.locals.currentUser.id);

  res.render('notifications', { notifications, pageTitle: 'الإشعارات' });
});

module.exports = router;
