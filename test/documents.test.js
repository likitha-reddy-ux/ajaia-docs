// test/documents.test.js — persistence, permissions, conflicts, delete and file import
// Run with:  npm test   (uses a temporary in-memory database; your real data.db is never touched)

process.env.DB_PATH = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { server } = require('../server');

let baseUrl;
let likitha, bhavitha, harshitha;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
  likitha = await login('likitha@ajaia.test');
  bhavitha = await login('bhavitha@ajaia.test');
  harshitha = await login('harshitha@ajaia.test');
});
after(() => server.close());

// ---------- helpers ----------

async function login(email) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Likitha@123' }),
  });
  assert.strictEqual(res.status, 200, `login failed for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

function call(cookie, method, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function upload(cookie, fileName, content) {
  return fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-Filename': encodeURIComponent(fileName), 'Content-Type': 'application/octet-stream' },
    body: content,
  });
}

async function newDoc(cookie) {
  const res = await call(cookie, 'POST', '/api/documents');
  assert.strictEqual(res.status, 201);
  return (await res.json()).id;
}

async function getDoc(cookie, id) {
  return (await (await call(cookie, 'GET', `/api/documents/${id}`)).json()).document;
}

// ---------- persistence ----------

test('rename + rich-text content are saved and come back unchanged after reopening', async () => {
  const id = await newDoc(likitha);
  const content = '<h1>Plan</h1><h2>Goals</h2><h3>Detail</h3><p>Normal <b>bold</b> <i>italic</i> <u>underline</u></p>'
    + '<ul><li>bullet</li></ul><ol><li>number</li></ol>';
  const save = await call(likitha, 'PATCH', `/api/documents/${id}`, { title: '  Q4 Roadmap  ', content });
  assert.strictEqual(save.status, 200);

  const doc = await getDoc(likitha, id); // "reopen"
  assert.strictEqual(doc.title, 'Q4 Roadmap', 'title is trimmed and saved');
  assert.strictEqual(doc.content, content, 'all formatting survives a save + reopen');

  const lists = await (await call(likitha, 'GET', '/api/documents')).json();
  assert.ok(lists.owned.some((d) => d.id === id && d.title === 'Q4 Roadmap'), 'new title shows in My documents');
});

test('saving strips harmful markup but keeps formatting', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'PATCH', `/api/documents/${id}`, {
    content: '<h2 style="color:red" onclick="x()">Hi</h2><p><b>ok</b><img src=x onerror=alert(1)><script>alert(2)</script></p>',
  });
  assert.strictEqual((await getDoc(likitha, id)).content, '<h2>Hi</h2><p><b>ok</b></p>');
});

test('invalid saves are rejected with a clear error', async () => {
  const id = await newDoc(likitha);
  const empty = await call(likitha, 'PATCH', `/api/documents/${id}`, { title: '   ' });
  assert.strictEqual(empty.status, 400);
  assert.match((await empty.json()).error, /empty/i);
  assert.strictEqual((await call(likitha, 'PATCH', `/api/documents/${id}`, { title: 'x'.repeat(201) })).status, 400);
});

// ---------- conflicts (no silent overwrites) ----------

test('a save based on an old version is refused instead of overwriting someone else', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'editor' });

  // Both open the same version
  const opened = (await getDoc(likitha, id)).updated_at;

  // Likitha saves first
  const first = await call(likitha, 'PATCH', `/api/documents/${id}`, { content: '<p>Likitha</p>', base_updated_at: opened });
  assert.strictEqual(first.status, 200);
  const { updated_at: afterFirst } = await first.json();
  assert.notStrictEqual(afterFirst, opened, 'every save produces a new version marker');

  // Bhavitha saves with the old marker: refused, and told what the latest content is
  const second = await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>Bhavitha</p>', base_updated_at: opened });
  assert.strictEqual(second.status, 409);
  const body = await second.json();
  assert.strictEqual(body.document.content, '<p>Likitha</p>');
  assert.strictEqual((await getDoc(likitha, id)).content, '<p>Likitha</p>', 'Likitha\'s work was NOT overwritten');

  // Bhavitha explicitly chooses "Keep my version" (uses the latest marker): allowed
  const third = await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>Bhavitha</p>', base_updated_at: body.document.updated_at });
  assert.strictEqual(third.status, 200);
});

// ---------- sharing & permissions (enforced by the server) ----------

test('editor can edit, but cannot delete or change sharing', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'editor' });

  assert.strictEqual((await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>edited by editor</p>' })).status, 200);
  assert.strictEqual((await getDoc(likitha, id)).content, '<p>edited by editor</p>', 'owner sees the editor\'s change');

  assert.strictEqual((await call(bhavitha, 'DELETE', `/api/documents/${id}`)).status, 403);
  assert.strictEqual((await call(bhavitha, 'POST', `/api/documents/${id}/shares`, { email: 'harshitha@ajaia.test', role: 'editor' })).status, 403);
  assert.strictEqual((await getDoc(likitha, id)).id, id, 'document still exists');
});

test('viewer can read but cannot edit, rename or delete', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'PATCH', `/api/documents/${id}`, { title: 'Read me', content: '<p>original</p>' });
  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'harshitha@ajaia.test', role: 'viewer' });

  const lists = await (await call(harshitha, 'GET', '/api/documents')).json();
  const entry = lists.shared.find((d) => d.id === id);
  assert.ok(entry, 'shows under Shared with me');
  assert.strictEqual(entry.role, 'viewer');

  const doc = await getDoc(harshitha, id);
  assert.strictEqual(doc.access, 'viewer');
  assert.deepStrictEqual(doc.shares, [], 'non-owners do not see the share list');

  assert.strictEqual((await call(harshitha, 'PATCH', `/api/documents/${id}`, { content: '<p>hacked</p>' })).status, 403);
  assert.strictEqual((await call(harshitha, 'PATCH', `/api/documents/${id}`, { title: 'renamed' })).status, 403);
  assert.strictEqual((await call(harshitha, 'DELETE', `/api/documents/${id}`)).status, 403);
  const after = await getDoc(likitha, id);
  assert.strictEqual(after.content, '<p>original</p>');
  assert.strictEqual(after.title, 'Read me');
});

test('changing the document id in the URL does not give access', async () => {
  const id = await newDoc(likitha); // never shared
  for (const [method, path, body] of [
    ['GET', `/api/documents/${id}`],
    ['PATCH', `/api/documents/${id}`, { content: '<p>x</p>' }],
    ['DELETE', `/api/documents/${id}`],
    ['POST', `/api/documents/${id}/shares`, { email: 'harshitha@ajaia.test', role: 'editor' }],
  ]) {
    assert.strictEqual((await call(harshitha, method, path, body)).status, 404, `${method} ${path} must be 404`);
  }
  assert.strictEqual((await call(likitha, 'GET', '/api/documents/999999')).status, 404, 'missing id looks the same');
  assert.strictEqual((await fetch(`${baseUrl}/api/documents/${id}`)).status, 401, 'signed-out users are blocked');
});

test('removing a person takes their access away; changing a role updates it', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'viewer' });
  assert.strictEqual((await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>x</p>' })).status, 403);

  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'editor' }); // upgrade
  assert.strictEqual((await call(bhavitha, 'PATCH', `/api/documents/${id}`, { content: '<p>x</p>' })).status, 200);

  const me = await (await call(bhavitha, 'GET', '/api/me')).json();
  await call(likitha, 'DELETE', `/api/documents/${id}/shares/${me.user.id}`);
  assert.strictEqual((await call(bhavitha, 'GET', `/api/documents/${id}`)).status, 404);
});

// ---------- delete ----------

test('owner delete removes the document for everyone', async () => {
  const id = await newDoc(likitha);
  await call(likitha, 'POST', `/api/documents/${id}/shares`, { email: 'bhavitha@ajaia.test', role: 'editor' });
  assert.strictEqual((await call(likitha, 'DELETE', `/api/documents/${id}`)).status, 200);
  assert.strictEqual((await call(likitha, 'GET', `/api/documents/${id}`)).status, 404);
  assert.strictEqual((await call(bhavitha, 'GET', `/api/documents/${id}`)).status, 404);
  const lists = await (await call(bhavitha, 'GET', '/api/documents')).json();
  assert.ok(!lists.shared.some((d) => d.id === id), 'gone from Shared with me');
});

// ---------- file import ----------

test('.txt and .md files import as new, editable documents', async () => {
  const txt = await upload(likitha, 'meeting notes.txt', 'Line one\n\nLine <two>');
  assert.strictEqual(txt.status, 201);
  const txtDoc = await getDoc(likitha, (await txt.json()).id);
  assert.strictEqual(txtDoc.title, 'meeting notes');
  assert.strictEqual(txtDoc.content, '<p>Line one</p><p>Line &lt;two&gt;</p>', 'text is escaped, not run as HTML');
  assert.strictEqual(txtDoc.access, 'owner');

  const md = await upload(likitha, 'plan.md', '# Plan\n\n- a\n- b\n\n1. first');
  assert.strictEqual(md.status, 201);
  const mdId = (await md.json()).id;
  assert.strictEqual((await getDoc(likitha, mdId)).content, '<h1>Plan</h1><ul><li>a</li><li>b</li></ul><ol><li>first</li></ol>');

  // imported docs behave like any other doc
  assert.strictEqual((await call(likitha, 'PATCH', `/api/documents/${mdId}`, { content: '<p>edited</p>' })).status, 200);
  assert.strictEqual((await getDoc(likitha, mdId)).content, '<p>edited</p>');
});

test('import rejects unsupported, empty, binary and oversized files with clear messages', async () => {
  const pdf = await upload(likitha, 'report.pdf', 'whatever');
  assert.strictEqual(pdf.status, 400);
  assert.match((await pdf.json()).error, /not supported/);

  const empty = await upload(likitha, 'empty.txt', '   \n  ');
  assert.strictEqual(empty.status, 400);
  assert.match((await empty.json()).error, /empty/i);

  const binary = await upload(likitha, 'photo.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]));
  assert.strictEqual(binary.status, 400);
  assert.match((await binary.json()).error, /does not look like a text file/);

  const justUnder = await upload(likitha, 'ok.txt', Buffer.alloc(1024 * 1024, 97)); // exactly 1 MB
  assert.strictEqual(justUnder.status, 201, 'a 1 MB file is allowed');

  const tooBig = await upload(likitha, 'big.txt', Buffer.alloc(1024 * 1024 + 1, 97));
  assert.strictEqual(tooBig.status, 413);
  assert.match((await tooBig.json()).error, /max 1 MB/);

  const before = (await (await call(likitha, 'GET', '/api/documents')).json()).owned.length;
  await upload(likitha, 'report.pdf', 'x');
  const after = (await (await call(likitha, 'GET', '/api/documents')).json()).owned.length;
  assert.strictEqual(after, before, 'rejected files never create documents');
});