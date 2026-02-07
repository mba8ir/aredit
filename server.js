require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (needed for Railway, Render, etc. where HTTPS terminates at load balancer)
if (isProd) {
  app.set('trust proxy', 1);
}

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://platform.twitter.com", "https://connect.facebook.net", "https://www.youtube.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://www.youtube.com", "https://platform.twitter.com", "https://www.facebook.com"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Request logging
app.use(morgan(isProd ? 'combined' : 'dev'));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '7d' : 0,
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
  }
}));

// Session
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[WARN] No SESSION_SECRET set in .env - using random secret (sessions lost on restart)');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict'
  }
}));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'عدد الطلبات كثير جداً، حاول مرة أخرى لاحقاً' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Make user + helpers available in all templates
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.unreadNotifications = 0;
  if (req.session.userId) {
    const user = db.prepare('SELECT id, username, email, email_verified, avatar_url, bio, created_at FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      res.locals.currentUser = user;
      res.locals.unreadNotifications = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
    }
  }
  // Helper for relative time
  res.locals.timeAgo = function(dateStr) {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    if (seconds < 60) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    if (hours < 24) return `منذ ${hours} ساعة`;
    if (days < 30) return `منذ ${days} يوم`;
    if (months < 12) return `منذ ${months} شهر`;
    return `منذ ${years} سنة`;
  };
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/communities'));
app.use('/', require('./routes/posts'));
app.use('/', require('./routes/comments'));
app.use('/', require('./routes/api'));
app.use('/', require('./routes/admin'));

// Home page
app.get('/', (req, res) => {
  const user = res.locals.currentUser;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;

  let communities;
  let posts;
  let allCommunities = [];
  let totalPosts = 0;

  if (user) {
    communities = db.prepare(`
      SELECT c.*, COUNT(cf2.user_id) as follower_count
      FROM communities c
      JOIN community_follows cf ON c.id = cf.community_id AND cf.user_id = ?
      LEFT JOIN community_follows cf2 ON c.id = cf2.community_id
      GROUP BY c.id
      ORDER BY follower_count DESC
    `).all(user.id);

    totalPosts = db.prepare(`
      SELECT COUNT(*) as c FROM posts p
      JOIN community_follows cf ON p.community_id = cf.community_id AND cf.user_id = ?
    `).get(user.id).c;

    posts = db.prepare(`
      SELECT p.*, u.username, c.name as community_name, c.id as community_id,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      JOIN communities c ON p.community_id = c.id
      JOIN community_follows cf ON c.id = cf.community_id AND cf.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(user.id, perPage, offset);

    if (communities.length === 0) {
      allCommunities = db.prepare(`
        SELECT c.*, COUNT(cf.user_id) as follower_count
        FROM communities c
        LEFT JOIN community_follows cf ON c.id = cf.community_id
        GROUP BY c.id
        ORDER BY follower_count DESC
      `).all();
    }
  } else {
    communities = db.prepare('SELECT c.*, COUNT(cf.user_id) as follower_count FROM communities c LEFT JOIN community_follows cf ON c.id = cf.community_id GROUP BY c.id ORDER BY follower_count DESC').all();

    totalPosts = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;

    posts = db.prepare(`
      SELECT p.*, u.username, c.name as community_name, c.id as community_id,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      JOIN communities c ON p.community_id = c.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).all(perPage, offset);
  }

  const totalPages = Math.ceil(totalPosts / perPage);

  res.render('home', {
    communities, posts, allCommunities,
    page, totalPages,
    pageTitle: 'الصفحة الرئيسية',
    pageDescription: 'راية الفرسان - منتدى عربي للنقاشات والمجتمعات'
  });
});

// Search
app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 25;
  const offset = (page - 1) * perPage;

  let posts = [];
  let totalPosts = 0;

  if (q.length > 0) {
    try {
      totalPosts = db.prepare(`
        SELECT COUNT(*) as c FROM posts_fts WHERE posts_fts MATCH ?
      `).get(q).c;

      posts = db.prepare(`
        SELECT p.*, u.username, c.name as community_name, c.id as community_id,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts_fts fts
        JOIN posts p ON fts.rowid = p.id
        JOIN users u ON p.user_id = u.id
        JOIN communities c ON p.community_id = c.id
        WHERE posts_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(q, perPage, offset);
    } catch (e) {
      // Invalid FTS query, fallback to LIKE
      totalPosts = db.prepare(`
        SELECT COUNT(*) as c FROM posts WHERE title LIKE ? OR body LIKE ?
      `).get(`%${q}%`, `%${q}%`).c;

      posts = db.prepare(`
        SELECT p.*, u.username, c.name as community_name, c.id as community_id,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN communities c ON p.community_id = c.id
        WHERE p.title LIKE ? OR p.body LIKE ?
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `).all(`%${q}%`, `%${q}%`, perPage, offset);
    }
  }

  const totalPages = Math.ceil(totalPosts / perPage);

  res.render('search', {
    q, posts, page, totalPages,
    pageTitle: q ? `بحث: ${q}` : 'بحث',
    pageDescription: 'البحث في راية الفرسان'
  });
});

// All communities page
app.get('/communities', (req, res) => {
  const communities = db.prepare(`
    SELECT c.*, COUNT(cf.user_id) as follower_count
    FROM communities c
    LEFT JOIN community_follows cf ON c.id = cf.community_id
    GROUP BY c.id
    ORDER BY follower_count DESC
  `).all();

  res.render('communities', {
    communities,
    pageTitle: 'المجتمعات',
    pageDescription: 'تصفح جميع المجتمعات في راية الفرسان'
  });
});

// Health check
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'database unavailable' });
  }
});

// RSS feed
app.get('/feed.xml', (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.username, c.name as community_name
    FROM posts p
    JOIN users u ON p.user_id = u.id
    JOIN communities c ON p.community_id = c.id
    ORDER BY p.created_at DESC
    LIMIT 50
  `).all();

  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>راية الفرسان</title>
    <description>منتدى عربي للنقاشات والمجتمعات</description>
    <link>${req.protocol}://${req.get('host')}</link>
    <language>ar</language>
    ${posts.map(p => `
    <item>
      <title>${escapeXml(p.title)}</title>
      <description>${escapeXml((p.body || '').substring(0, 500))}</description>
      <link>${req.protocol}://${req.get('host')}/p/${p.id}</link>
      <author>${escapeXml(p.username)}</author>
      <category>${escapeXml(p.community_name)}</category>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <guid>${req.protocol}://${req.get('host')}/p/${p.id}</guid>
    </item>`).join('')}
  </channel>
</rss>`);
});

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { message: 'الصفحة غير موجودة', pageTitle: '404', status: 404 });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err);
  res.status(500).render('error', { message: 'حدث خطأ في الخادم', pageTitle: 'خطأ', status: 500 });
});

// Graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
