const express = require('express');
const db = require('../db');
const router = express.Router();

// Add comment to post
router.post('/p/:id/comment', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const postId = parseInt(req.params.id);
  const { body, parent_comment_id } = req.body;

  if (!body || !body.trim()) return res.redirect('/p/' + postId);
  if (body.trim().length > 10000) return res.redirect('/p/' + postId);

  const result = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_comment_id, body) VALUES (?, ?, ?, ?)'
  ).run(postId, res.locals.currentUser.id, parent_comment_id || null, body.trim());

  // Send notification to post author
  const post = db.prepare('SELECT user_id, title FROM posts WHERE id = ?').get(postId);
  if (post && post.user_id !== res.locals.currentUser.id) {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)')
      .run(post.user_id, 'comment', `${res.locals.currentUser.username} علق على منشورك "${post.title.substring(0, 50)}"`, `/p/${postId}#comment-${result.lastInsertRowid}`);
  }

  // If replying to a comment, notify that comment's author too
  if (parent_comment_id) {
    const parentComment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parent_comment_id);
    if (parentComment && parentComment.user_id !== res.locals.currentUser.id && parentComment.user_id !== (post ? post.user_id : null)) {
      db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)')
        .run(parentComment.user_id, 'reply', `${res.locals.currentUser.username} رد على تعليقك`, `/p/${postId}#comment-${result.lastInsertRowid}`);
    }
  }

  res.redirect('/p/' + postId + '#comment-' + result.lastInsertRowid);
});

// Edit comment
router.post('/comment/:id/edit', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'التعليق غير موجود' });
  if (comment.user_id !== res.locals.currentUser.id) return res.status(403).json({ error: 'ليس لديك صلاحية التعديل' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'التعليق لا يمكن أن يكون فارغاً' });
  if (body.trim().length > 10000) return res.status(400).json({ error: 'التعليق طويل جداً' });

  db.prepare('UPDATE comments SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?').run(body.trim(), comment.id);

  res.json({ success: true, body: body.trim() });
});

// Delete comment
router.post('/comment/:id/delete', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).render('error', { message: 'التعليق غير موجود', pageTitle: '404' });
  if (comment.user_id !== res.locals.currentUser.id) return res.status(403).render('error', { message: 'ليس لديك صلاحية الحذف', pageTitle: 'خطأ' });

  db.prepare('DELETE FROM votes WHERE votable_type = ? AND votable_id = ?').run('comment', comment.id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);

  res.redirect('/p/' + comment.post_id);
});

// Vote on comment
router.post('/comment/:id/vote', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  const commentId = parseInt(req.params.id);
  const value = parseInt(req.body.value);
  if (value !== 1 && value !== -1) return res.status(400).json({ error: 'قيمة غير صحيحة' });

  const userId = res.locals.currentUser.id;
  const existing = db.prepare('SELECT * FROM votes WHERE user_id = ? AND votable_type = ? AND votable_id = ?').get(userId, 'comment', commentId);

  if (existing) {
    if (existing.value === value) {
      db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
      db.prepare('UPDATE comments SET score = score - ? WHERE id = ?').run(value, commentId);
    } else {
      db.prepare('UPDATE votes SET value = ? WHERE id = ?').run(value, existing.id);
      db.prepare('UPDATE comments SET score = score + ? WHERE id = ?').run(value * 2, commentId);
    }
  } else {
    db.prepare('INSERT INTO votes (user_id, votable_type, votable_id, value) VALUES (?, ?, ?, ?)').run(userId, 'comment', commentId, value);
    db.prepare('UPDATE comments SET score = score + ? WHERE id = ?').run(value, commentId);
  }

  const comment = db.prepare('SELECT score FROM comments WHERE id = ?').get(commentId);
  res.json({ score: comment.score });
});

// Report comment
router.post('/comment/:id/report', (req, res) => {
  if (!res.locals.currentUser) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

  const commentId = parseInt(req.params.id);
  const { reason } = req.body;

  if (!reason || !reason.trim() || reason.trim().length > 500) {
    return res.status(400).json({ error: 'سبب البلاغ مطلوب' });
  }

  const existing = db.prepare('SELECT 1 FROM reports WHERE reporter_id = ? AND reportable_type = ? AND reportable_id = ?')
    .get(res.locals.currentUser.id, 'comment', commentId);

  if (existing) {
    return res.json({ reported: true, message: 'تم الإبلاغ مسبقاً' });
  }

  db.prepare('INSERT INTO reports (reporter_id, reportable_type, reportable_id, reason) VALUES (?, ?, ?, ?)')
    .run(res.locals.currentUser.id, 'comment', commentId, reason.trim());

  res.json({ reported: true, message: 'تم إرسال البلاغ' });
});

module.exports = router;
