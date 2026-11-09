// test/app.test.js — the robot that checks our app
// Run with:  npm test

// Use a temporary in-memory notebook, so tests never touch the real data.db
process.env.DB_PATH = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { server, sanitizeHtml, markdownToHtml } = require('../server');

let baseUrl;

// Start the app on a random free port before the tests, stop it after
before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// Helper: log in and return the wristband (cookie)
async function login(email) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Likitha@123' }),
  });
  assert.strictEqual(res.status, 200, `login failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

// Helper: call the API as a logged-in user
function call(cookie, method, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------- Test 1: security ----------
test('sanitizer removes harmful code but keeps formatting', () => {
  const dirty = '<p onclick="steal()">Hi <b>there</b><script>alert(1)</script><img src=x onerror=alert(1)></p>';
  const clean = sanitizeHtml(dirty);
  assert.strictEqual(clean, '<p>Hi <b>there</b></p>');
});

// ---------- Test 2: file import ----------
test('markdown is converted to headings, lists and bold', () => {
  const html = markdownToHtml('# Title\n\nSome **bold** text\n\n- one\n- two');
  assert.strictEqual(html, '<h1>Title</h1><p>Some <b>bold</b> text</p><ul><li>one</li><li>two</li></ul>');
});

// ---------- Test 3: sharing rules (the most important one) ----------
test('only the owner and people it is shared with can access a document', async () => {
  const likitha = await login('likitha@ajaia.test');
  const bhavitha = await login('bhavitha@ajaia.test');
  const harshitha = await login('harshitha@ajaia.test');

  // Likitha creates a document
  const created = await call(likitha, 'POST', '/api/documents');
  assert.strictEqual(created.status, 201);
  const { id } = await created.json();

  // Before sharing: Bhavitha cannot open it
  assert.strictEqual((await call(bhavitha, 'GET', `/api/documents/${id}`)).status, 404);

  // Likitha shares it with Bhavitha as VIEWER
  const shared = await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'viewer' });
  assert.strictEqual(shared.status, 200);

  // Now Bhavitha can open it, and it shows in her "Shared with me" list
  assert.strictEqual((await call(bhavitha, 'GET', `/api/documents/${id}`)).status, 200);
  const lists = await (await call(bhavitha, 'GET', '/api/documents')).json();
  assert.ok(lists.shared.some((d) => d.id === id), 'doc should be in Shared with me');

  // But a viewer cannot edit it
  const edit = await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>hacked</p>' });
  assert.strictEqual(edit.status, 403);

  // And a viewer cannot delete it
  assert.strictEqual((await call(bhavitha, 'DELETE', `/api/documents/${id}`)).status, 403);

  // Harshitha (not shared) still cannot see it at all
  assert.strictEqual((await call(harshitha, 'GET', `/api/documents/${id}`)).status, 404);

  // Not logged in: blocked
  assert.strictEqual((await fetch(`${baseUrl}/api/documents/${id}`)).status, 401);
});