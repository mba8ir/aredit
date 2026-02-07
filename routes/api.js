const express = require('express');
const db = require('../db');
const router = express.Router();

// Share link (copy to clipboard is client-side, this is for getting the URL)
router.get('/api/share/:id', (req, res) => {
  const post = db.prepare('SELECT id, title FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  res.json({ url: `/p/${post.id}`, title: post.title });
});

// Notification count
router.get('/api/notifications/count', (req, res) => {
  if (!req.session.userId) return res.json({ count: 0 });
  const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.userId).c;
  res.json({ count });
});

module.exports = router;
