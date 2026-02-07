/**
 * Bulk data injector for AREDIT
 *
 * Usage:
 *   node inject.js data.json
 *
 * The JSON file can contain any combination of:
 *   - users
 *   - communities
 *   - posts
 *   - comments
 *   - follows
 *
 * See data-example.json for the format.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');

const file = process.argv[2];

if (!file) {
  console.log('Usage: node inject.js <data-file.json>');
  console.log('Example: node inject.js data.json');
  console.log('\nSee data-example.json for the format.');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

async function inject() {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  let totalInserted = 0;

  // --- USERS ---
  if (data.users && data.users.length > 0) {
    console.log(`Injecting ${data.users.length} users...`);
    const defaultHash = await bcrypt.hash('123456', 10);

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO users (username, password_hash, email, bio, avatar_url)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertUsers = db.transaction((users) => {
      let count = 0;
      for (const u of users) {
        const hash = u.password ? await_hash(u.password) : defaultHash;
        stmt.run(
          u.username,
          defaultHash,  // all users get default password, override below if needed
          u.email || null,
          u.bio || null,
          u.avatar_url || null
        );
        count++;
      }
      return count;
    });

    // For custom passwords, hash them individually
    for (const u of data.users) {
      if (u.password) {
        const hash = await bcrypt.hash(u.password, 10);
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
        if (!existing) {
          db.prepare(`
            INSERT OR IGNORE INTO users (username, password_hash, email, bio, avatar_url)
            VALUES (?, ?, ?, ?, ?)
          `).run(u.username, hash, u.email || null, u.bio || null, u.avatar_url || null);
          totalInserted++;
        }
      }
    }

    // Bulk insert users without custom passwords
    const defaultUsers = data.users.filter(u => !u.password);
    if (defaultUsers.length > 0) {
      const bulkStmt = db.prepare(`
        INSERT OR IGNORE INTO users (username, password_hash, email, bio, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const u of defaultUsers) {
          bulkStmt.run(u.username, defaultHash, u.email || null, u.bio || null, u.avatar_url || null);
          totalInserted++;
        }
      })();
    }

    console.log(`  ✓ Users done`);
  }

  // --- COMMUNITIES ---
  if (data.communities && data.communities.length > 0) {
    console.log(`Injecting ${data.communities.length} communities...`);

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO communities (name, description, rules, icon, accent_color, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const c of data.communities) {
        // Look up creator by username if provided
        let creatorId = null;
        if (c.created_by) {
          const user = db.prepare('SELECT id FROM users WHERE username = ?').get(c.created_by);
          if (user) creatorId = user.id;
        }

        stmt.run(
          c.name,
          c.description || null,
          c.rules || null,
          c.icon || '🕌',
          c.accent_color || '#e94560',
          creatorId
        );
        totalInserted++;
      }
    })();

    console.log(`  ✓ Communities done`);
  }

  // --- POSTS ---
  if (data.posts && data.posts.length > 0) {
    console.log(`Injecting ${data.posts.length} posts...`);

    const stmt = db.prepare(`
      INSERT INTO posts (user_id, community_id, title, body, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const p of data.posts) {
        // Look up user by username
        const user = db.prepare('SELECT id FROM users WHERE username = ?').get(p.username);
        if (!user) {
          console.warn(`  ⚠ User "${p.username}" not found, skipping post "${p.title}"`);
          continue;
        }

        // Look up community by name
        const community = db.prepare('SELECT id FROM communities WHERE name = ?').get(p.community);
        if (!community) {
          console.warn(`  ⚠ Community "${p.community}" not found, skipping post "${p.title}"`);
          continue;
        }

        // Use provided timestamp or default to now
        const createdAt = p.created_at || new Date().toISOString();

        stmt.run(
          user.id,
          community.id,
          p.title,
          p.body || null,
          p.score || 0,
          createdAt
        );
        totalInserted++;
      }
    })();

    console.log(`  ✓ Posts done`);
  }

  // --- COMMENTS ---
  if (data.comments && data.comments.length > 0) {
    console.log(`Injecting ${data.comments.length} comments...`);

    const stmt = db.prepare(`
      INSERT INTO comments (post_id, user_id, parent_comment_id, body, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const c of data.comments) {
        // Look up user
        const user = db.prepare('SELECT id FROM users WHERE username = ?').get(c.username);
        if (!user) {
          console.warn(`  ⚠ User "${c.username}" not found, skipping comment`);
          continue;
        }

        // Find post by ID or by title
        let postId = c.post_id;
        if (!postId && c.post_title) {
          const post = db.prepare('SELECT id FROM posts WHERE title = ?').get(c.post_title);
          if (post) postId = post.id;
        }
        if (!postId) {
          console.warn(`  ⚠ Post not found for comment by "${c.username}", skipping`);
          continue;
        }

        const createdAt = c.created_at || new Date().toISOString();

        stmt.run(
          postId,
          user.id,
          c.parent_comment_id || null,
          c.body,
          c.score || 0,
          createdAt
        );
        totalInserted++;
      }
    })();

    console.log(`  ✓ Comments done`);
  }

  // --- FOLLOWS ---
  if (data.follows && data.follows.length > 0) {
    console.log(`Injecting ${data.follows.length} follows...`);

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO community_follows (user_id, community_id)
      VALUES (?, ?)
    `);

    db.transaction(() => {
      for (const f of data.follows) {
        const user = db.prepare('SELECT id FROM users WHERE username = ?').get(f.username);
        const community = db.prepare('SELECT id FROM communities WHERE name = ?').get(f.community);
        if (user && community) {
          stmt.run(user.id, community.id);
          totalInserted++;
        }
      }
    })();

    console.log(`  ✓ Follows done`);
  }

  // Rebuild FTS index for search
  try {
    db.exec(`DELETE FROM posts_fts;`);
    const posts = db.prepare('SELECT id, title, body FROM posts').all();
    const ftsStmt = db.prepare('INSERT OR IGNORE INTO posts_fts(rowid, title, body) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const p of posts) {
        ftsStmt.run(p.id, p.title, p.body);
      }
    })();
  } catch (e) { /* ok */ }

  console.log(`\n✅ Done! Inserted ${totalInserted} records total.`);
}

inject().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
