const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const router = express.Router();

// Multer config for banner images
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// Helper: get admin role for a user in a community
function getCommunityAdmin(userId, communityId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM community_admins WHERE user_id = ? AND community_id = ?').get(userId, communityId) || null;
}

// Safe sort mapping (fixes SQL interpolation)
const SORT_MAP = {
  'new': 'p.created_at DESC',
  'top': 'p.score DESC',
  'hot': '(p.score / MAX(1.0, (julianday("now") - julianday(p.created_at)) * 24.0)) DESC',
  'controversial': 'ABS(p.score) ASC, comment_count DESC',
};

// ============================================
// IMPORTANT: /c/new MUST come BEFORE /c/:id
// ============================================

// Create community form
router.get('/c/new', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  res.render('create-community', { error: null, pageTitle: 'مجتمع جديد' });
});

// Create community
router.post('/c/new', upload.single('banner'), (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const { name, description, icon, accent_color, rules } = req.body;

  if (!name || !name.trim()) {
    return res.render('create-community', { error: 'اسم المجتمع مطلوب', pageTitle: 'مجتمع جديد' });
  }

  if (name.trim().length > 50) {
    return res.render('create-community', { error: 'اسم المجتمع طويل جداً (الحد الأقصى 50 حرف)', pageTitle: 'مجتمع جديد' });
  }

  const arabicRegex = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s\d]+$/;
  if (!arabicRegex.test(name.trim())) {
    return res.render('create-community', { error: 'اسم المجتمع يجب أن يكون بالعربية', pageTitle: 'مجتمع جديد' });
  }

  const existing = db.prepare('SELECT id FROM communities WHERE name = ?').get(name.trim());
  if (existing) {
    return res.render('create-community', { error: 'يوجد مجتمع بهذا الاسم بالفعل', pageTitle: 'مجتمع جديد' });
  }

  let bannerUrl = null;
  if (req.file) {
    bannerUrl = '/uploads/' + req.file.filename;
  }

  const communityIcon = (icon && icon.trim()) ? icon.trim() : '🕌';
  const color = (accent_color && accent_color.trim()) ? accent_color.trim() : '#e94560';
  const communityRules = rules ? rules.substring(0, 2000) : null;

  const result = db.prepare(
    'INSERT INTO communities (name, description, icon, accent_color, banner_url, created_by, rules) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), description ? description.substring(0, 500) : null, communityIcon, color, bannerUrl, res.locals.currentUser.id, communityRules);

  const communityId = result.lastInsertRowid;

  db.prepare('INSERT INTO community_admins (community_id, user_id, role) VALUES (?, ?, ?)').run(communityId, res.locals.currentUser.id, 'creator');
  db.prepare('INSERT INTO community_follows (user_id, community_id) VALUES (?, ?)').run(res.locals.currentUser.id, communityId);

  res.redirect('/c/' + communityId);
});

// Community settings page
router.get('/c/:id/settings', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole) return res.status(403).render('error', { message: 'ليس لديك صلاحية الوصول', pageTitle: 'خطأ' });

  const admins = db.prepare(`
    SELECT ca.*, u.username FROM community_admins ca
    JOIN users u ON ca.user_id = u.id
    WHERE ca.community_id = ?
  `).all(community.id);

  // Get pending reports for this community
  const reports = db.prepare(`
    SELECT r.*, u.username as reporter_name
    FROM reports r
    JOIN users u ON r.reporter_id = u.id
    WHERE r.status = 'pending' AND (
      (r.reportable_type = 'post' AND r.reportable_id IN (SELECT id FROM posts WHERE community_id = ?))
      OR (r.reportable_type = 'comment' AND r.reportable_id IN (SELECT cm.id FROM comments cm JOIN posts p ON cm.post_id = p.id WHERE p.community_id = ?))
    )
    ORDER BY r.created_at DESC
    LIMIT 20
  `).all(community.id, community.id);

  res.render('community-settings', { community, adminRole, admins, reports, error: null, success: null, pageTitle: `إعدادات ${community.name}` });
});

// Update community settings
router.post('/c/:id/settings', upload.single('banner'), (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole) return res.status(403).render('error', { message: 'ليس لديك صلاحية الوصول', pageTitle: 'خطأ' });

  const { description, icon, accent_color, rules } = req.body;

  let bannerUrl = community.banner_url;
  if (req.file) {
    bannerUrl = '/uploads/' + req.file.filename;
  }

  const communityIcon = (icon && icon.trim()) ? icon.trim() : community.icon;
  const color = (accent_color && accent_color.trim()) ? accent_color.trim() : community.accent_color;

  db.prepare('UPDATE communities SET description = ?, icon = ?, accent_color = ?, banner_url = ?, rules = ? WHERE id = ?')
    .run(description ? description.substring(0, 500) : null, communityIcon, color, bannerUrl, rules ? rules.substring(0, 2000) : null, community.id);

  const admins = db.prepare(`
    SELECT ca.*, u.username FROM community_admins ca
    JOIN users u ON ca.user_id = u.id
    WHERE ca.community_id = ?
  `).all(community.id);

  const updatedCommunity = db.prepare('SELECT * FROM communities WHERE id = ?').get(community.id);
  const reports = [];
  res.render('community-settings', { community: updatedCommunity, adminRole, admins, reports, error: null, success: 'تم تحديث الإعدادات بنجاح', pageTitle: `إعدادات ${updatedCommunity.name}` });
});

// Add admin (creator only)
router.post('/c/:id/admin/add', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole || adminRole.role !== 'creator') return res.status(403).render('error', { message: 'فقط منشئ المجتمع يمكنه إضافة مشرفين', pageTitle: 'خطأ' });

  const { username } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) {
    const admins = db.prepare('SELECT ca.*, u.username FROM community_admins ca JOIN users u ON ca.user_id = u.id WHERE ca.community_id = ?').all(community.id);
    return res.render('community-settings', { community, adminRole, admins, reports: [], error: 'المستخدم غير موجود', success: null, pageTitle: `إعدادات ${community.name}` });
  }

  const existingAdmin = getCommunityAdmin(user.id, community.id);
  if (existingAdmin) {
    const admins = db.prepare('SELECT ca.*, u.username FROM community_admins ca JOIN users u ON ca.user_id = u.id WHERE ca.community_id = ?').all(community.id);
    return res.render('community-settings', { community, adminRole, admins, reports: [], error: 'المستخدم مشرف بالفعل', success: null, pageTitle: `إعدادات ${community.name}` });
  }

  db.prepare('INSERT INTO community_admins (community_id, user_id, role) VALUES (?, ?, ?)').run(community.id, user.id, 'admin');

  res.redirect('/c/' + community.id + '/settings');
});

// Remove admin (creator only)
router.post('/c/:id/admin/remove', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole || adminRole.role !== 'creator') return res.status(403).render('error', { message: 'فقط منشئ المجتمع يمكنه إزالة مشرفين', pageTitle: 'خطأ' });

  const userId = parseInt(req.body.user_id);
  if (userId === res.locals.currentUser.id) {
    return res.redirect('/c/' + community.id + '/settings');
  }

  db.prepare('DELETE FROM community_admins WHERE community_id = ? AND user_id = ?').run(community.id, userId);

  res.redirect('/c/' + community.id + '/settings');
});

// Delete post from community (admin only)
router.post('/c/:id/post/:postId/delete', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole) return res.status(403).render('error', { message: 'ليس لديك صلاحية الحذف', pageTitle: 'خطأ' });

  const postId = parseInt(req.params.postId);
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND community_id = ?').get(postId, community.id);
  if (post) {
    db.prepare('DELETE FROM comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM votes WHERE votable_type = ? AND votable_id = ?').run('post', postId);
    db.prepare('DELETE FROM bookmarks WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
  }

  res.redirect('/c/' + community.id);
});

// Resolve report (admin only)
router.post('/c/:id/report/:reportId/resolve', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.redirect('/');

  const adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  if (!adminRole) return res.redirect('/');

  db.prepare('UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('resolved', res.locals.currentUser.id, parseInt(req.params.reportId));

  res.redirect('/c/' + community.id + '/settings');
});

// Community page
router.get('/c/:id', (req, res) => {
  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });

  const followerCount = db.prepare('SELECT COUNT(*) as count FROM community_follows WHERE community_id = ?').get(community.id).count;

  let isFollowing = false;
  let adminRole = null;
  if (res.locals.currentUser) {
    isFollowing = !!db.prepare('SELECT 1 FROM community_follows WHERE user_id = ? AND community_id = ?').get(res.locals.currentUser.id, community.id);
    adminRole = getCommunityAdmin(res.locals.currentUser.id, community.id);
  }

  const admins = db.prepare(`
    SELECT ca.*, u.username FROM community_admins ca
    JOIN users u ON ca.user_id = u.id
    WHERE ca.community_id = ?
  `).all(community.id);

  const sort = req.query.sort || 'new';
  const orderBy = SORT_MAP[sort] || SORT_MAP['new'];

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;

  const totalPosts = db.prepare('SELECT COUNT(*) as c FROM posts WHERE community_id = ?').get(community.id).c;

  const posts = db.prepare(`
    SELECT p.*, u.username,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.community_id = ?
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(community.id, perPage, offset);

  const totalPages = Math.ceil(totalPosts / perPage);

  res.render('community', {
    community, posts, followerCount, isFollowing, sort, adminRole, admins,
    page, totalPages,
    pageTitle: community.name,
    pageDescription: community.description || `مجتمع ${community.name} في راية الفرسان`
  });
});

// Follow/unfollow community
router.post('/c/:id/follow', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const communityId = parseInt(req.params.id);
  const userId = res.locals.currentUser.id;

  const existing = db.prepare('SELECT 1 FROM community_follows WHERE user_id = ? AND community_id = ?').get(userId, communityId);

  if (existing) {
    db.prepare('DELETE FROM community_follows WHERE user_id = ? AND community_id = ?').run(userId, communityId);
  } else {
    db.prepare('INSERT INTO community_follows (user_id, community_id) VALUES (?, ?)').run(userId, communityId);
  }

  res.redirect('/c/' + communityId);
});

// Community RSS feed
router.get('/c/:id/feed.xml', (req, res) => {
  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).send('Not found');

  const posts = db.prepare(`
    SELECT p.*, u.username FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.community_id = ?
    ORDER BY p.created_at DESC LIMIT 50
  `).all(community.id);

  function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(community.name)}</title>
    <description>${escapeXml(community.description || '')}</description>
    <link>${req.protocol}://${req.get('host')}/c/${community.id}</link>
    <language>ar</language>
    ${posts.map(p => `
    <item>
      <title>${escapeXml(p.title)}</title>
      <description>${escapeXml((p.body || '').substring(0, 500))}</description>
      <link>${req.protocol}://${req.get('host')}/p/${p.id}</link>
      <author>${escapeXml(p.username)}</author>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <guid>${req.protocol}://${req.get('host')}/p/${p.id}</guid>
    </item>`).join('')}
  </channel>
</rss>`);
});

module.exports = router;
