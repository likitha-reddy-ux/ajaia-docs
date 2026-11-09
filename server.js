// server.js — the helper program (runs on the computer)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DEMO_PASSWORD = 'Likitha@123';
const COOKIE_NAME = 'ajaia_sid';      // unique name, so other apps' cookies don't confuse us
const SESSION_DAYS = 7;               // stay logged in for 7 days
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB

// ---------- general helpers ----------

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

// Read the raw uploaded file (returns null if it is too big)
function readRaw(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks)));
  });
}

// Read ONE cookie by its exact name
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

// Look at the wristband (cookie) and find who this is
function getUser(req) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, Date.now()) || null;
}

// What can this user do with this document?  'owner' | 'editor' | 'viewer' | null (nothing)
function getAccess(user, doc) {
  if (doc.owner_id === user.id) return 'owner';
  const share = db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?').get(doc.id, user.id);
  return share ? share.role : null;
}

// Who is this document shared with?
function getShares(docId) {
  return db.prepare(
    `SELECT u.id AS user_id, u.name, u.email, s.role
     FROM shares s JOIN users u ON u.id = s.user_id
     WHERE s.document_id = ? ORDER BY u.name`
  ).all(docId);
}

// Send files from the "public" folder to the browser
function serveFile(res, fileName) {
  const filePath = path.join(__dirname, 'public', fileName);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, {
    'Content-Type': (types[path.extname(filePath)] || 'text/plain') + '; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(fs.readFileSync(filePath));
}

// ---------- security: clean document HTML ----------
// Keep only simple formatting tags and remove ALL attributes (onclick, onerror, style, src...),
// so nobody can hide harmful code inside a shared document.

const ALLOWED_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'hr', 'blockquote']);

function sanitizeHtml(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')                                                  // remove comments
    .replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, '') // remove dangerous blocks
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, slash, tag) => {
      tag = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';                  // unknown tag: drop it (its text stays)
      if (tag === 'br' || tag === 'hr') return slash ? '' : `<${tag}>`;
      return `<${slash}${tag}>`;                              // allowed tag, without any attributes
    });
}

// ---------- file import: .txt and .md -> HTML ----------

// Make text safe to put inside HTML (so "<" shows as text, not as code)
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// .txt  ->  every non-empty line becomes a paragraph
function textToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

// **bold** and *italic* inside a line
function inlineMarkdown(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>');
}

// .md  ->  headings, bullet lists, numbered lists, paragraphs
function markdownToHtml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let listType = null; // 'ul' or 'ol' while we are inside a list
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) {
      closeList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {          // # Heading
      closeList();
      const level = Math.min(m[1].length, 3);
      html += `<h${level}>${inlineMarkdown(m[2])}</h${level}>`;
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {             // - bullet
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${inlineMarkdown(m[1])}</li>`;
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {           // 1. numbered
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${inlineMarkdown(m[1])}</li>`;
    } else {                                                     // normal text
      closeList();
      html += `<p>${inlineMarkdown(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// ---------- the server ----------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  try {
    // ===== Pages and files =====
    if (req.method === 'GET' && url === '/') return serveFile(res, 'index.html');
    if (req.method === 'GET' && url === '/app.js') return serveFile(res, 'app.js');
    if (req.method === 'GET' && url === '/styles.css') return serveFile(res, 'styles.css');

    // ===== Login / logout =====
    if (req.method === 'POST' && url === '/api/login') {
      const { email, password } = await readJson(req);
      const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?')
        .get(String(email || '').trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) {
        return sendJson(res, 401, { error: 'Wrong email or password' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);
      return sendJson(res, 200, { user }, {
        'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
      });
    }

    if (req.method === 'POST' && url === '/api/logout') {
      const token = getCookie(req, COOKIE_NAME);
      if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0` });
    }

    // ===== Everything below needs a logged-in user =====
    const user = getUser(req);
    if (!user) return sendJson(res, 401, { error: 'Please sign in' });

    if (req.method === 'GET' && url === '/api/me') {
      return sendJson(res, 200, { user });
    }

    // Everyone except me (for the "share with" dropdown)
    if (req.method === 'GET' && url === '/api/users') {
      const users = db.prepare('SELECT id, name, email FROM users WHERE id != ? ORDER BY name').all(user.id);
      return sendJson(res, 200, { users });
    }

    // List my documents + documents shared with me
    if (req.method === 'GET' && url === '/api/documents') {
      const owned = db.prepare(
        `SELECT d.id, d.title, d.updated_at,
                (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id) AS share_count
         FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`
      ).all(user.id);
      const shared = db.prepare(
        `SELECT d.id, d.title, d.updated_at, u.name AS owner_name, s.role
         FROM shares s
         JOIN documents d ON d.id = s.document_id
         JOIN users u ON u.id = d.owner_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC`
      ).all(user.id);
      return sendJson(res, 200, { owned, shared });
    }

    // Create a new document (I become the owner)
    if (req.method === 'POST' && url === '/api/documents') {
      const result = db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
        .run(user.id, 'Untitled document', '<p></p>');
      return sendJson(res, 201, { id: Number(result.lastInsertRowid) });
    }

    // ===== Import a file -> new document =====
    if (req.method === 'POST' && url === '/api/import') {
      const fileName = decodeURIComponent(req.headers['x-filename'] || '');
      const ext = path.extname(fileName).toLowerCase();
      if (!['.txt', '.md'].includes(ext)) {
        return sendJson(res, 400, { error: `"${ext || 'no extension'}" is not supported. Please upload a .txt or .md file.` });
      }
      const buffer = await readRaw(req, MAX_UPLOAD_BYTES);
      if (buffer === null) return sendJson(res, 413, { error: 'File is too big (max 1 MB)' });
      if (buffer.length === 0) return sendJson(res, 400, { error: 'The file is empty' });

      const text = buffer.toString('utf8');
      // A real text file never contains "null" bytes; images/PDFs renamed to .txt do.
      if (text.includes('\u0000')) {
        return sendJson(res, 400, { error: 'This file does not look like a text file. Please upload a plain .txt or .md file.' });
      }
      if (text.trim() === '') return sendJson(res, 400, { error: 'The file is empty' });
      const html = sanitizeHtml(ext === '.md' ? markdownToHtml(text) : textToHtml(text)) || '<p></p>';
      const title = path.basename(fileName, ext).trim().slice(0, 200) || 'Imported document';

      const result = db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
        .run(user.id, title, html);
      return sendJson(res, 201, { id: Number(result.lastInsertRowid) });
    }

    // ===== Sharing:  /api/documents/5/shares  and  /api/documents/5/shares/2 =====
    const shareMatch = url.match(/^\/api\/documents\/(\d+)\/shares(?:\/(\d+))?$/);
    if (shareMatch) {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(shareMatch[1]));
      const access = doc ? getAccess(user, doc) : null;
      if (!access) return sendJson(res, 404, { error: 'Document not found' });
      if (access !== 'owner') return sendJson(res, 403, { error: 'Only the owner can change sharing' });

      // Add (or change) a person
      if (req.method === 'POST' && !shareMatch[2]) {
        const { email, role } = await readJson(req);
        if (!['editor', 'viewer'].includes(role)) return sendJson(res, 400, { error: 'Role must be editor or viewer' });
        const target = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
        if (!target) return sendJson(res, 404, { error: 'No user with that email' });
        if (target.id === user.id) return sendJson(res, 400, { error: 'You already own this document' });
        db.prepare(
          `INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
           ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`
        ).run(doc.id, target.id, role);
        return sendJson(res, 200, { shares: getShares(doc.id) });
      }

      // Remove a person
      if (req.method === 'DELETE' && shareMatch[2]) {
        db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?').run(doc.id, Number(shareMatch[2]));
        return sendJson(res, 200, { shares: getShares(doc.id) });
      }
    }

    // ===== Open, save or delete ONE document:  /api/documents/5 =====
    const docMatch = url.match(/^\/api\/documents\/(\d+)$/);
    if (docMatch) {
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(docMatch[1]));
      const access = doc ? getAccess(user, doc) : null;
      if (!access) return sendJson(res, 404, { error: 'Document not found' });

      // Open
      if (req.method === 'GET') {
        const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(doc.owner_id);
        return sendJson(res, 200, {
          document: {
            ...doc,
            access,
            owner_name: owner.name,
            shares: access === 'owner' ? getShares(doc.id) : [], // only the owner sees the share list
          },
        });
      }

      // Delete (only the owner can delete)
      if (req.method === 'DELETE') {
        if (access !== 'owner') return sendJson(res, 403, { error: 'Only the owner can delete this document' });
        db.prepare('DELETE FROM shares WHERE document_id = ?').run(doc.id);
        db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
        return sendJson(res, 200, { ok: true });
      }

      // Save (title and/or content)
      if (req.method === 'PATCH') {
        if (access === 'viewer') return sendJson(res, 403, { error: 'You can only view this document' });
        const body = await readJson(req);
        const title = body.title === undefined ? doc.title : String(body.title).trim();
        const content = body.content === undefined ? doc.content : sanitizeHtml(body.content);
        if (!title) return sendJson(res, 400, { error: 'Title cannot be empty' });
        if (title.length > 200) return sendJson(res, 400, { error: 'Title is too long (max 200)' });
        if (content.length > 500000) return sendJson(res, 400, { error: 'Document is too large' });

        // Conflict check: the browser sends the "updated_at" it last saw (base_updated_at).
        // The update only happens if nobody else saved since then, so one person's work
        // is never silently overwritten by another. (Requests without it still save, as before.)
        const base = body.base_updated_at === undefined ? null : String(body.base_updated_at);
        const result = db.prepare(
          `UPDATE documents
           SET title = ?, content = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
           WHERE id = ? AND (? IS NULL OR updated_at = ?)`
        ).run(title, content, doc.id, base, base);

        const latest = db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id);
        if (result.changes === 0) {
          return sendJson(res, 409, {
            error: 'This document was changed by someone else since you opened it',
            document: { id: latest.id, title: latest.title, content: latest.content, updated_at: latest.updated_at },
          });
        }
        return sendJson(res, 200, { ok: true, updated_at: latest.updated_at });
      }
    }

    // Anything else
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Server error' });
  }
});

// Start the server only when we run "node server.js" (not when the tests load this file)
if (require.main === module) {
  const PORT = process.env.PORT || 3000; // hosting sites like Render choose the port
  server.listen(PORT, () => {
    console.log(`Open http://localhost:${PORT} in your browser`);
  });
}

// Let the tests use these
module.exports = { server, sanitizeHtml, markdownToHtml };