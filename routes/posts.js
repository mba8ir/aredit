const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const router = express.Router();

// Multer config
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const maxSize = (parseInt(process.env.UPLOAD_MAX_SIZE_MB) || 10) * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: maxSize },
  fileFilter: (req, file, cb) => {
    const allowedImg = /jpeg|jpg|png|gif|webp/;
    const allowedVid = /mp4|webm|ogg/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype;
    const isImage = allowedImg.test(ext) && allowedImg.test(mime);
    const isVideo = allowedVid.test(ext) && (mime.startsWith('video/'));
    cb(null, isImage || isVideo);
  }
});

// New post form
router.get('/c/:id/new', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(req.params.id);
  if (!community) return res.status(404).render('error', { message: 'المجتمع غير موجود', pageTitle: '404' });
  res.render('create-post', { community, error: null, pageTitle: 'منشور جديد' });
});

// Create post
router.post('/c/:id/new', upload.single('media'), (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const { title, body } = req.body;
  const communityId = parseInt(req.params.id);

  if (!title || !title.trim()) {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(communityId);
    return res.render('create-post', { community, error: 'العنوان مطلوب', pageTitle: 'منشور جديد' });
  }

  if (title.trim().length > 300) {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(communityId);
    return res.render('create-post', { community, error: 'العنوان طويل جداً (الحد الأقصى 300 حرف)', pageTitle: 'منشور جديد' });
  }

  if (body && body.length > 40000) {
    const community = db.prepare('SELECT * FROM communities WHERE id = ?').get(communityId);
    return res.render('create-post', { community, error: 'المحتوى طويل جداً (الحد الأقصى 40000 حرف)', pageTitle: 'منشور جديد' });
  }

  let mediaType = null;
  let mediaUrl = null;

  if (req.file) {
    if (req.file.mimetype.startsWith('video/')) {
      mediaType = 'video';
    } else {
      mediaType = 'image';
    }
    mediaUrl = '/uploads/' + req.file.filename;
  }

  const result = db.prepare(
    'INSERT INTO posts (user_id, community_id, title, body, media_type, media_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(res.locals.currentUser.id, communityId, title.trim(), body || null, mediaType, mediaUrl);

  res.redirect('/p/' + result.lastInsertRowid);
});

// Edit post form
router.get('/p/:id/edit', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const post = db.prepare(`
    SELECT p.*, c.name as community_name, c.id as community_id
    FROM posts p JOIN communities c ON p.community_id = c.id WHERE p.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).render('error', { message: 'المنشور غير موجود', pageTitle: '404' });
  if (post.user_id !== res.locals.currentUser.id) {
    return res.status(403).render('error', { message: 'ليس لديك صلاحية التعديل', pageTitle: 'خطأ' });
  }

  res.render('edit-post', { post, error: null, pageTitle: 'تعديل المنشور' });
});

// Update post
router.post('/p/:id/edit', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).render('error', { message: 'المنشور غير موجود', pageTitle: '404' });
  if (post.user_id !== res.locals.currentUser.id) {
    return res.status(403).render('error', { message: 'ليس لديك صلاحية التعديل', pageTitle: 'خطأ' });
  }

  const { title, body } = req.body;

  if (!title || !title.trim()) {
    return res.render('edit-post', { post, error: 'العنوان مطلوب', pageTitle: 'تعديل المنشور' });
  }

  if (title.trim().length > 300) {
    return res.render('edit-post', { post, error: 'العنوان طويل جداً', pageTitle: 'تعديل المنشور' });
  }

  if (body && body.length > 40000) {
    return res.render('edit-post', { post, error: 'المحتوى طويل جداً', pageTitle: 'تعديل المنشور' });
  }

  db.prepare('UPDATE posts SET title = ?, body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(title.trim(), body || null, post.id);

  res.redirect('/p/' + post.id);
});

// Delete own post
router.post('/p/:id/delete', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).render('error', { message: 'المنشور غير موجود', pageTitle: '404' });
  if (post.user_id !== res.locals.currentUser.id) {
    return res.status(403).render('error', { message: 'ليس لديك صلاحية الحذف', pageTitle: 'خطأ' });
  }

  db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM votes WHERE votable_type = ? AND votable_id = ?').run('post', post.id);
  db.prepare('DELETE FROM bookmarks WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);

  res.redirect('/c/' + post.community_id);
});

// View post
router.get('/p/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.avatar_url as user_avatar, c.name as community_name, c.id as community_id
    FROM posts p
    JOIN users u ON p.user_id = u.id
    JOIN communities c ON p.community_id = c.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).render('error', { message: 'المنشور غير موجود', pageTitle: '404' });

  const allComments = db.prepare(`
    SELECT cm.*, u.username, u.avatar_url as user_avatar
    FROM comments cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.post_id = ?
    ORDER BY cm.created_at ASC
  `).all(post.id);

  // Build comment tree
  const commentMap = {};
  const rootComments = [];

  allComments.forEach(c => {
    c.children = [];
    commentMap[c.id] = c;
  });

  allComments.forEach(c => {
    if (c.parent_comment_id && commentMap[c.parent_comment_id]) {
      commentMap[c.parent_comment_id].children.push(c);
    } else {
      rootComments.push(c);
    }
  });

  // Get user's votes
  let userVotes = {};
  let isBookmarked = false;
  if (res.locals.currentUser) {
    const postVote = db.prepare('SELECT value FROM votes WHERE user_id = ? AND votable_type = ? AND votable_id = ?').get(res.locals.currentUser.id, 'post', post.id);
    if (postVote) userVotes['post_' + post.id] = postVote.value;

    const commentIds = allComments.map(c => c.id);
    if (commentIds.length > 0) {
      const placeholders = commentIds.map(() => '?').join(',');
      const commentVotes = db.prepare(`SELECT votable_id, value FROM votes WHERE user_id = ? AND votable_type = 'comment' AND votable_id IN (${placeholders})`).all(res.locals.currentUser.id, ...commentIds);
      commentVotes.forEach(v => {
        userVotes['comment_' + v.votable_id] = v.value;
      });
    }

    isBookmarked = !!db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(res.locals.currentUser.id, post.id);
  }

  res.render('post', {
    post, comments: rootComments, userVotes, isBookmarked,
    pageTitle: post.title,
    pageDescription: (post.body || '').substring(0, 200)
  });
});

// Vote on post
router.post('/p/:id/vote', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  const postId = parseInt(req.params.id);
  const value = parseInt(req.body.value);
  if (value !== 1 && value !== -1) return res.status(400).json({ error: 'قيمة غير صحيحة' });

  const userId = res.locals.currentUser.id;
  const existing = db.prepare('SELECT * FROM votes WHERE user_id = ? AND votable_type = ? AND votable_id = ?').get(userId, 'post', postId);

  if (existing) {
    if (existing.value === value) {
      db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
      db.prepare('UPDATE posts SET score = score - ? WHERE id = ?').run(value, postId);
    } else {
      db.prepare('UPDATE votes SET value = ? WHERE id = ?').run(value, existing.id);
      db.prepare('UPDATE posts SET score = score + ? WHERE id = ?').run(value * 2, postId);
    }
  } else {
    db.prepare('INSERT INTO votes (user_id, votable_type, votable_id, value) VALUES (?, ?, ?, ?)').run(userId, 'post', postId, value);
    db.prepare('UPDATE posts SET score = score + ? WHERE id = ?').run(value, postId);
  }

  const post = db.prepare('SELECT score FROM posts WHERE id = ?').get(postId);
  res.json({ score: post.score });
});

// Bookmark toggle
router.post('/p/:id/bookmark', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  const postId = parseInt(req.params.id);
  const userId = res.locals.currentUser.id;

  const existing = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(userId, postId);

  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(userId, postId);
    res.json({ bookmarked: false });
  } else {
    db.prepare('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)').run(userId, postId);
    res.json({ bookmarked: true });
  }
});

// Bookmarks page
router.get('/bookmarks', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const posts = db.prepare(`
    SELECT p.*, u.username, c.name as community_name, c.id as community_id,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM bookmarks b
    JOIN posts p ON b.post_id = p.id
    JOIN users u ON p.user_id = u.id
    JOIN communities c ON p.community_id = c.id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `).all(res.locals.currentUser.id);

  res.render('bookmarks', { posts, pageTitle: 'المحفوظات' });
});

// Report post
router.post('/p/:id/report', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  const postId = parseInt(req.params.id);
  const { reason } = req.body;

  if (!reason || !reason.trim() || reason.trim().length > 500) {
    return res.status(400).json({ error: 'سبب البلاغ مطلوب (حتى 500 حرف)' });
  }

  // Check if already reported
  const existing = db.prepare('SELECT 1 FROM reports WHERE reporter_id = ? AND reportable_type = ? AND reportable_id = ?')
    .get(res.locals.currentUser.id, 'post', postId);

  if (existing) {
    return res.json({ reported: true, message: 'تم الإبلاغ مسبقاً' });
  }

  db.prepare('INSERT INTO reports (reporter_id, reportable_type, reportable_id, reason) VALUES (?, ?, ?, ?)')
    .run(res.locals.currentUser.id, 'post', postId, reason.trim());

  res.json({ reported: true, message: 'تم إرسال البلاغ' });
});

module.exports = router;
