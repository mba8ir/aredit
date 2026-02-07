const express = require('express');
const router = express.Router();
const db = require('../db');

// Simple admin password - change this!
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2024';

// Check admin session
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

// Admin login page
router.get('/admin/login', (req, res) => {
  res.render('admin-login', {
    pageTitle: 'لوحة التحكم - دخول',
    error: null
  });
});

// Admin login handler
router.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', {
    pageTitle: 'لوحة التحكم - دخول',
    error: 'كلمة المرور غير صحيحة'
  });
});

// Admin logout
router.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin/login');
});

// Admin dashboard
router.get('/admin', requireAdmin, (req, res) => {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
    ORDER BY name
  `).all();

  const stats = {};
  for (const t of tables) {
    try {
      const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
      stats[t.name] = count.c;
    } catch (e) {
      stats[t.name] = 'خطأ';
    }
  }

  res.render('admin', {
    pageTitle: 'لوحة التحكم',
    tables: tables.map(t => t.name),
    stats
  });
});

// View table data
router.get('/admin/table/:name', requireAdmin, (req, res) => {
  const tableName = req.params.name;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 50;
  const offset = (page - 1) * perPage;

  // Validate table name exists (prevent SQL injection)
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name = ?
  `).get(tableName);

  if (!tableExists) {
    return res.status(404).render('error', {
      message: 'الجدول غير موجود',
      pageTitle: '404',
      status: 404
    });
  }

  const totalRows = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c;
  const totalPages = Math.ceil(totalRows / perPage);
  const rows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`).all(perPage, offset);

  // Get column names
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Hide password hashes for display
  const safeRows = rows.map(row => {
    const safe = { ...row };
    if (safe.password_hash) safe.password_hash = '****';
    return safe;
  });

  res.render('admin-table', {
    pageTitle: `جدول: ${tableName}`,
    tableName,
    columns,
    rows: safeRows,
    totalRows,
    page,
    totalPages
  });
});

// Run custom SQL query (SELECT only)
router.post('/admin/query', requireAdmin, (req, res) => {
  const { sql } = req.body;
  const trimmed = (sql || '').trim().toLowerCase();

  // Only allow SELECT queries
  if (!trimmed.startsWith('select')) {
    return res.render('admin-query', {
      pageTitle: 'استعلام SQL',
      sql,
      error: 'فقط استعلامات SELECT مسموح بها. لتعديل البيانات استخدم صفحة الجداول.',
      columns: [],
      rows: []
    });
  }

  try {
    const rows = db.prepare(sql).all();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    res.render('admin-query', {
      pageTitle: 'استعلام SQL',
      sql,
      error: null,
      columns,
      rows,
      rowCount: rows.length
    });
  } catch (e) {
    res.render('admin-query', {
      pageTitle: 'استعلام SQL',
      sql,
      error: e.message,
      columns: [],
      rows: []
    });
  }
});

// SQL query page
router.get('/admin/query', requireAdmin, (req, res) => {
  res.render('admin-query', {
    pageTitle: 'استعلام SQL',
    sql: '',
    error: null,
    columns: [],
    rows: [],
    rowCount: 0
  });
});

module.exports = router;
