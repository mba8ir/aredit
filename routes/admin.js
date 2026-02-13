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

// Export entire database as JSON (download from local)
router.get('/admin/export', requireAdmin, (req, res) => {
  try {
    const tableNames = [
      'users', 'communities', 'community_follows', 'community_admins',
      'posts', 'comments', 'votes', 'bookmarks', 'reports',
      'notifications', 'password_resets'
    ];

    const data = {};
    for (const table of tableNames) {
      try {
        data[table] = db.prepare(`SELECT * FROM "${table}"`).all();
      } catch (e) {
        data[table] = [];
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=rayat-al-fursan-export.json');
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Import database from JSON (upload to Railway)
router.post('/admin/import', requireAdmin, express.json({ limit: '50mb' }), (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.users) {
      return res.json({ success: false, error: 'ملف غير صالح. يجب أن يحتوي على جدول users على الأقل.' });
    }

    // Import order matters due to foreign keys - disable temporarily
    db.pragma('foreign_keys = OFF');

    const importTable = (tableName, rows) => {
      if (!rows || rows.length === 0) return 0;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const colNames = columns.map(c => `"${c}"`).join(', ');
      const stmt = db.prepare(`INSERT OR REPLACE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`);

      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          const values = columns.map(c => row[c] !== undefined ? row[c] : null);
          stmt.run(...values);
        }
      });
      insertMany(rows);
      return rows.length;
    };

    const importOrder = [
      'users', 'communities', 'community_follows', 'community_admins',
      'posts', 'comments', 'votes', 'bookmarks', 'reports',
      'notifications', 'password_resets'
    ];

    const results = {};
    for (const table of importOrder) {
      if (data[table] && data[table].length > 0) {
        results[table] = importTable(table, data[table]);
      }
    }

    db.pragma('foreign_keys = ON');

    // Rebuild FTS index
    try {
      db.exec(`DELETE FROM posts_fts;`);
      const posts = db.prepare('SELECT id, title, body FROM posts').all();
      const insertFts = db.prepare('INSERT OR IGNORE INTO posts_fts(rowid, title, body) VALUES (?, ?, ?)');
      db.transaction(() => {
        for (const p of posts) {
          insertFts.run(p.id, p.title, p.body);
        }
      })();
    } catch (e) { /* FTS rebuild failed, not critical */ }

    const summary = Object.entries(results).map(([t, c]) => `${t}: ${c}`).join('، ');
    res.json({ success: true, message: `تم الاستيراد بنجاح! ${summary}` });
  } catch (e) {
    db.pragma('foreign_keys = ON');
    res.json({ success: false, error: e.message });
  }
});

// Seed database from admin panel
router.post('/admin/seed', requireAdmin, async (req, res) => {
  try {
    const bcrypt = require('bcrypt');
    // Seed works even if data exists (skips duplicates)
    const usernames = [
      'أبو_عمر', 'نور_الهدى', 'سيف_الحق', 'زهرة_البيان', 'عبدالله_الفصيح',
      'أم_خالد', 'فارس_العروبة', 'ليلى_الأدبية', 'حسن_المؤرخ', 'مريم_النحوية',
      'طارق_المعرفة', 'سلمى_القارئة', 'يوسف_الباحث', 'هند_الكاتبة', 'عمر_الشاعر',
      'فاطمة_المفكرة', 'خالد_الناقد', 'رقية_العالمة', 'أحمد_اللغوي', 'سارة_المحللة',
      'محمد_الراوي', 'عائشة_البلاغية', 'إبراهيم_الحكيم', 'خديجة_الأديبة', 'علي_المناظر',
      'آمنة_الفقيهة', 'حمزة_المجاهد', 'رملة_الصحفية', 'عثمان_المحقق', 'صفية_الداعية',
      'بلال_المنشد', 'حفصة_المعلمة', 'سعد_المؤمن', 'جويرية_الحافظة', 'معاذ_الفقيه',
      'ميمونة_القاضية', 'أسامة_المحارب', 'زينب_العابدة', 'أنس_الراوي', 'سودة_الزاهدة',
      'ثابت_المحدث', 'أسماء_المجتهدة', 'زيد_العالم', 'رقية_المتأملة', 'جابر_الشجاع',
      'لبابة_الحكيمة', 'سلمان_الفارسي', 'أم_سلمة', 'عمار_الصادق', 'شيماء_الوفية',
      'رافع_الهمة', 'حليمة_السعدية', 'عبادة_التقي', 'سمية_الصابرة', 'مصعب_الخير',
      'نسيبة_المقاتلة', 'أبو_بكر_الصديق', 'أم_عمارة', 'سعيد_السعيد', 'عاتكة_النبيلة',
      'وحشي_التائب', 'هالة_المنيرة', 'عكرمة_الشهم', 'أروى_الذكية', 'ضرار_الفدائي',
      'تماضر_الخنساء', 'النعمان_الأمير', 'بثينة_الشاعرة', 'قتادة_الحافظ', 'جميلة_اللبيبة',
      'حذيفة_الأمين', 'سلافة_الرقيقة', 'البراء_البطل', 'عفراء_الطاهرة', 'أبي_ذر_الغفاري',
      'خولة_الفارسة', 'عدي_الكريم', 'فضة_الزاهرة', 'شرحبيل_القائد', 'رابعة_العدوية',
      'المقداد_الشجاع', 'عزة_الأنيقة', 'أبو_هريرة', 'أم_حبيبة', 'عبدالرحمن_الأول',
      'كلثوم_الحنون', 'صهيب_الرومي', 'أم_كلثوم', 'طلحة_الكريم', 'سكينة_الهادئة',
      'الزبير_المقدام', 'رفيدة_الطبيبة', 'أبو_عبيدة', 'أم_الفضل', 'خباب_الصبور',
      'فاختة_اللطيفة', 'أبو_طلحة', 'أم_سليم', 'سهيل_المتفائل', 'غادة_المبدعة'
    ];

    const hash = await bcrypt.hash('123456', 10);
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, email) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (let i = 0; i < usernames.length; i++) {
        const email = i < 30 ? `user${i}@example.com` : null;
        insertUser.run(usernames[i], hash, email);
      }
    })();

    const communities = [
      { name: 'اللغة العربية', description: 'مجتمع لمحبي اللغة العربية', icon: '📚' },
      { name: 'التاريخ العربي', description: 'نقاشات حول تاريخ العرب', icon: '🏛️' },
      { name: 'نقاشات إسلامية', description: 'حوارات حول الدين الإسلامي', icon: '🕌' },
      { name: 'أخبار العالم', description: 'آخر الأخبار والأحداث العالمية', icon: '🌍' },
      { name: 'الشعر العربي', description: 'ديوان الشعر العربي', icon: '✒️' },
      { name: 'نظريات المؤامرة', description: 'نقاشات حول نظريات المؤامرة', icon: '🔍' },
      { name: 'نقاشات روحانية', description: 'حوارات حول الروحانيات والتصوف', icon: '🌙' },
      { name: 'التقنية والتكنولوجيا', description: 'أخبار التقنية والبرمجة', icon: '💻' },
      { name: 'الرياضة العربية', description: 'أخبار الرياضة العربية', icon: '⚽' },
      { name: 'الطبخ العربي', description: 'وصفات المطبخ العربي', icon: '🍲' }
    ];

    const insertCommunity = db.prepare('INSERT OR IGNORE INTO communities (name, description, icon) VALUES (?, ?, ?)');
    db.transaction(() => {
      communities.forEach(c => insertCommunity.run(c.name, c.description, c.icon));
    })();

    // Follows
    const insertFollow = db.prepare('INSERT OR IGNORE INTO community_follows (user_id, community_id) VALUES (?, ?)');
    db.transaction(() => {
      for (let userId = 1; userId <= 100; userId++) {
        const numFollows = 2 + Math.floor(Math.random() * 5);
        const followed = new Set();
        while (followed.size < numFollows) {
          followed.add(1 + Math.floor(Math.random() * 10));
        }
        followed.forEach(cId => insertFollow.run(userId, cId));
      }
    })();

    // Sample posts (3 per community for quick seed)
    const samplePosts = [
      { cId: 1, title: 'لماذا الإعراب مهم في فهم القرآن؟', body: 'الإعراب ليس مجرد قواعد جامدة بل هو مفتاح لفهم المعاني الدقيقة في النصوص العربية.' },
      { cId: 1, title: 'أصعب عشر كلمات عربية في النطق', body: 'اللغة العربية تحتوي على أصوات فريدة لا توجد في أي لغة أخرى.' },
      { cId: 1, title: 'هل اللهجات العامية تهدد الفصحى؟', body: 'انتشار اللهجات العامية في وسائل الإعلام أثار قلق المهتمين باللغة العربية.' },
      { cId: 2, title: 'بيت الحكمة: أعظم مكتبة في التاريخ', body: 'أسس الخليفة هارون الرشيد بيت الحكمة في بغداد وطوره ابنه المأمون.' },
      { cId: 2, title: 'صلاح الدين الأيوبي: بين الأسطورة والحقيقة', body: 'صلاح الدين يعتبر من أعظم القادة في التاريخ الإسلامي.' },
      { cId: 2, title: 'الحضارة الأندلسية: ثمانية قرون من الازدهار', body: 'حكم المسلمون الأندلس من 711 إلى 1492م. خلال هذه الفترة ازدهرت العلوم والفنون.' },
      { cId: 3, title: 'المقاصد الشرعية: روح التشريع الإسلامي', body: 'علم المقاصد يدرس الحكم والغايات من التشريعات الإسلامية.' },
      { cId: 3, title: 'الصوفية بين الروحانية والانحراف', body: 'التصوف الإسلامي له تاريخ طويل بدأ بالزهد والتقشف.' },
      { cId: 3, title: 'الربا في العصر الحديث', body: 'النظام المالي العالمي يقوم على الفائدة. البنوك الإسلامية حاولت تقديم بدائل.' },
      { cId: 4, title: 'هل نشهد نهاية القطب الواحد؟', body: 'مع صعود الصين وعودة روسيا وتكتلات مثل بريكس، العالم يتغير.' },
      { cId: 4, title: 'الذكاء الاصطناعي يغير سوق العمل', body: 'تقرير جديد يتوقع أن الذكاء الاصطناعي سيلغي 300 مليون وظيفة.' },
      { cId: 4, title: 'العملات الرقمية: ثورة مالية أم فقاعة؟', body: 'بيتكوين وصل لأسعار قياسية ثم انهار. ما مستقبل العملات الرقمية؟' },
      { cId: 5, title: 'المتنبي: أعظم شعراء العربية', body: 'أنا الذي نظر الأعمى إلى أدبي وأسمعت كلماتي من به صمم.' },
      { cId: 5, title: 'محمود درويش وشعر المقاومة', body: 'سجل أنا عربي ورقم بطاقتي خمسون ألف.' },
      { cId: 5, title: 'أجمل أبيات الحكمة في الشعر العربي', body: 'ومن يتهيب صعود الجبال يعش أبد الدهر بين الحفر.' },
      { cId: 6, title: 'من يتحكم في الاقتصاد العالمي؟', body: 'هل الحكومات تحكم فعلاً أم أنها واجهة لقوى مالية أكبر؟' },
      { cId: 6, title: 'الهبوط على القمر: حقيقة أم تمثيلية؟', body: 'لماذا لم يعد أحد للقمر منذ 1972؟' },
      { cId: 6, title: 'الماسونية في العالم العربي', body: 'الماسونية منظمة سرية يعتقد كثيرون أنها تتحكم في العالم.' },
      { cId: 7, title: 'التأمل في الإسلام: التفكر كعبادة', body: 'القرآن يحث على التفكر. هل يمكن دمج تقنيات التأمل مع الذكر؟' },
      { cId: 7, title: 'جلال الدين الرومي: فيلسوف الحب الإلهي', body: 'لا تجلس مع الحزانى فإن الأحزان معدية.' },
      { cId: 7, title: 'الصلاة كعلاج نفسي وجسدي', body: 'الصلاة ليست مجرد عبادة بل هي تمرين بدني ونفسي وروحي.' },
      { cId: 8, title: 'ChatGPT: هل اقتربنا من الذكاء الخارق؟', body: 'النماذج اللغوية الكبيرة أذهلت العالم. هل هي ذكية فعلاً؟' },
      { cId: 8, title: 'الخصوصية في عصر المراقبة الرقمية', body: 'هاتفك يعرف أين أنت وماذا تبحث وما تشتري.' },
      { cId: 8, title: 'الحوسبة الكمية: ثورة قادمة', body: 'الحاسوب الكمي يمكنه حل مسائل في ثوانٍ تحتاج ملايين السنين.' },
      { cId: 9, title: 'كأس العالم 2022: إنجاز عربي تاريخي', body: 'المغرب وصل للمربع الذهبي. السعودية هزمت الأرجنتين.' },
      { cId: 9, title: 'محمد صلاح: أفضل لاعب عربي في التاريخ؟', body: 'محمد صلاح حقق ما لم يحققه أي لاعب عربي قبله.' },
      { cId: 9, title: 'الألعاب الإلكترونية: هل هي رياضة حقيقية؟', body: 'بطولات بمليارات الدولارات. لاعبون عرب يحققون إنجازات عالمية.' },
      { cId: 10, title: 'المنسف الأردني: ملك الأطباق العربية', body: 'أرز مع لحم الخروف واللبن الجميد. يُقدم في المناسبات والأعراس.' },
      { cId: 10, title: 'الفلافل: مصرية أم شامية؟', body: 'المصريون من الفول والشوام من الحمص. أيهما ألذ؟' },
      { cId: 10, title: 'القهوة العربية: من اليمن إلى العالم', body: 'اليمن هو مهد القهوة. القهوة العربية بالهيل والزعفران.' },
    ];

    const insertPost = db.prepare('INSERT INTO posts (user_id, community_id, title, body, score) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      samplePosts.forEach(p => {
        const userId = 1 + Math.floor(Math.random() * 100);
        const score = Math.floor(Math.random() * 100);
        insertPost.run(userId, p.cId, p.title, p.body, score);
      });
    })();

    // Comments
    const commentTexts = [
      'ما شاء الله، موضوع ممتاز!', 'أختلف معك في هذه النقطة.',
      'هل لديك مصادر؟', 'كلام سليم مئة بالمئة.',
      'موضوع مهم جداً.', 'جزاك الله خيراً.',
    ];
    const insertComment = db.prepare('INSERT INTO comments (post_id, user_id, body, score) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (let postId = 1; postId <= 30; postId++) {
        const numComments = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numComments; i++) {
          const userId = 1 + Math.floor(Math.random() * 100);
          const body = commentTexts[Math.floor(Math.random() * commentTexts.length)];
          insertComment.run(postId, userId, body, Math.floor(Math.random() * 20));
        }
      }
    })();

    res.json({ success: true, message: 'تم ملء قاعدة البيانات بنجاح! 100 مستخدم، 10 مجتمعات، 30 منشور.' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Clear all data
router.post('/admin/clear', requireAdmin, (req, res) => {
  try {
    db.exec(`
      DELETE FROM votes;
      DELETE FROM comments;
      DELETE FROM bookmarks;
      DELETE FROM reports;
      DELETE FROM notifications;
      DELETE FROM posts;
      DELETE FROM community_follows;
      DELETE FROM community_admins;
      DELETE FROM password_resets;
      DELETE FROM communities;
      DELETE FROM users;
    `);
    // Reset FTS
    try { db.exec(`DELETE FROM posts_fts;`); } catch(e) {}
    res.json({ success: true, message: 'تم حذف جميع البيانات.' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
