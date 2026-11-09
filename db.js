// db.js — our app's notebook (database)
const { DatabaseSync } = require('node:sqlite');

// Open (or create) the notebook file called data.db
const db = new DatabaseSync(process.env.DB_PATH || 'data.db');

// Draw the pages (tables) if they don't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id    INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY,
    owner_id   INTEGER NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shares (
    document_id INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    role        TEXT NOT NULL DEFAULT 'editor',
    PRIMARY KEY (document_id, user_id)
  );

  -- NEW: wristbands (login sessions), so logins survive a server restart
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

// Add 3 demo users, but only the first time (when the users page is empty)
const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (count === 0) {
  const addUser = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)');
  addUser.run('likitha@ajaia.test', 'Likitha');
  addUser.run('bhavitha@ajaia.test', 'Bhavitha');
  addUser.run('harshitha@ajaia.test', 'Harshitha');
}

// Let other files use this notebook
module.exports = db;

// If we run "node db.js" directly, print the users so we can check
if (require.main === module) {
  console.log(db.prepare('SELECT * FROM users').all());
}