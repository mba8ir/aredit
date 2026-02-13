const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'rayat.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    email_verified INTEGER DEFAULT 0,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    rules TEXT,
    icon TEXT DEFAULT '🕌',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS community_follows (
    user_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, community_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    media_type TEXT,
    media_url TEXT,
    score INTEGER DEFAULT 0,
    edited_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    parent_comment_id INTEGER,
    body TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    edited_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    votable_type TEXT NOT NULL,
    votable_id INTEGER NOT NULL,
    value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, votable_type, votable_id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id);
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score);
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
  CREATE INDEX IF NOT EXISTS idx_votes_votable ON votes(votable_type, votable_id);
  CREATE INDEX IF NOT EXISTS idx_community_follows_user ON community_follows(user_id);
  CREATE INDEX IF NOT EXISTS idx_community_follows_community ON community_follows(community_id);

  CREATE TABLE IF NOT EXISTS community_admins (
    community_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (community_id, user_id),
    FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    code TEXT,
    verified INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    reportable_type TEXT NOT NULL,
    reportable_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    resolved_by INTEGER,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

  CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, body, content='posts', content_rowid='id');
`);

// Migrations for existing DBs
const migrations = [
  `ALTER TABLE password_resets ADD COLUMN code TEXT`,
  `ALTER TABLE password_resets ADD COLUMN verified INTEGER DEFAULT 0`,
  `ALTER TABLE password_resets ADD COLUMN attempts INTEGER DEFAULT 0`,
  `ALTER TABLE communities ADD COLUMN accent_color TEXT DEFAULT '#e94560'`,
  `ALTER TABLE communities ADD COLUMN banner_url TEXT`,
  `ALTER TABLE communities ADD COLUMN created_by INTEGER`,
  `ALTER TABLE communities ADD COLUMN rules TEXT`,
  `ALTER TABLE posts ADD COLUMN edited_at DATETIME`,
  `ALTER TABLE comments ADD COLUMN edited_at DATETIME`,
  `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
  `ALTER TABLE users ADD COLUMN bio TEXT`,
  `ALTER TABLE posts ADD COLUMN post_type TEXT DEFAULT 'text'`,
  `ALTER TABLE posts ADD COLUMN link_url TEXT`,
];

for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* column already exists */ }
}

// FTS triggers for search
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body);
      INSERT INTO posts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
  `);
} catch (e) { /* triggers may already exist */ }

// Rebuild FTS index from existing data
try {
  const count = db.prepare('SELECT COUNT(*) as c FROM posts_fts').get();
  if (count.c === 0) {
    const posts = db.prepare('SELECT id, title, body FROM posts').all();
    const insert = db.prepare('INSERT OR IGNORE INTO posts_fts(rowid, title, body) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const p of posts) {
        insert.run(p.id, p.title, p.body);
      }
    });
    tx();
  }
} catch (e) { /* ok */ }

module.exports = db;
