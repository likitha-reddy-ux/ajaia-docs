// app.js — the page's brain (runs in the browser)

let me = null;          // the logged-in user
let currentDoc = null;  // the document that is open right now
let saveTimer = null;   // countdown for autosave
let hasChanges = false; // true = something changed and is not saved yet
let isSaving = false;   // true = a save is happening right now
let allUsers = [];      // for the share dialog
let listsLoadedOnce = false;
let inConflict = false; // true = someone else saved; autosave pauses until the user chooses

const $ = (id) => document.getElementById(id);

// ================= helpers =================

// Talk to our server
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url !== '/api/login' && url !== '/api/me') showLogin();
    // Keep the status code and body so callers can react (e.g. 409 = someone else saved)
    throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status, data });
  }
  return data;
}

// Short message at the bottom. Errors are announced immediately to screen readers.
let toastTimer;
function toast(message, kind = '') {
  const t = $('toast');
  t.hidden = true; // re-show so screen readers announce repeated messages
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  t.className = `toast ${kind}`;
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'error' ? 6000 : 3000);
}

function setStatus(text, kind = '') {
  $('save-status').textContent = text;
  $('save-status').className = `save-status ${kind}`;
}

// Put a button into a "working…" state; returns a function that restores it.
function setBusy(button, busyText) {
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = busyText;
  return () => {
    button.innerHTML = original;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  };
}

// "2026-11-09 18:20:00" (UTC from the database) -> "6:20 PM" or "Nov 9"
function formatTime(sqlTime) {
  if (!sqlTime) return '';
  const d = new Date(sqlTime.replace(' ', 'T') + 'Z');
  const today = d.toDateString() === new Date().toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Make an element with text (textContent = safe, never runs as code)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// An icon from the hidden icon set in index.html
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function initials(name) {
  return (name || '?').trim()[0].toUpperCase();
}

// ================= screens =================

async function showApp(user) {
  me = user;
  $('login-screen').hidden = true;
  $('app-screen').hidden = false;
  $('user-name').textContent = user.name;
  $('user-email').textContent = user.email;
  $('user-avatar').textContent = initials(user.name);

  const linkMatch = location.hash.match(/^#\/doc\/(\d+)$/); // was a doc open? (e.g. #/doc/1)
  closeEditor();
  try {
    await loadLists();
  } catch (err) {
    toast(err.message, 'error');
  }
  if (linkMatch) await openDoc(Number(linkMatch[1]));     // reopen it after refresh
}

function showLogin() {
  me = null;
  currentDoc = null;
  hasChanges = false;
  listsLoadedOnce = false;
  $('app-screen').hidden = true;
  $('login-screen').hidden = false;
  $('email').focus();
}

function closeEditor() {
  currentDoc = null;
  $('editor-area').hidden = true;
  $('doc-loading').hidden = true;
  $('empty-state').hidden = false;
  history.replaceState(null, '', location.pathname); // remove #/doc/... from the address
}

// ================= document lists =================

function makeListItem(doc, metaText, iconName) {
  const li = el('li');
  const link = el('a', 'doc-link');
  link.href = `#/doc/${doc.id}`;
  link.title = doc.title; // full title on hover when it is cut off
  if (currentDoc && currentDoc.id === doc.id) link.setAttribute('aria-current', 'page');

  const text = el('span', 'doc-link-text');
  text.append(el('span', 'doc-link-title', doc.title), el('span', 'doc-link-meta', metaText));
  link.append(icon(iconName), text);

  link.addEventListener('click', (e) => { e.preventDefault(); openDoc(doc.id); });
  li.append(link);
  return li;
}

function emptyListMessage(iconName, heading, body) {
  const li = el('li', 'list-empty');
  li.append(icon(iconName), el('b', '', heading), el('span', '', body));
  return li;
}

function setCount(id, n) {
  $(id).textContent = n;
  $(id).setAttribute('aria-label', `${n} document${n === 1 ? '' : 's'}`);
}

async function loadLists() {
  const lists = [$('owned-list'), $('shared-list')];
  if (!listsLoadedOnce) {
    for (const list of lists) list.replaceChildren(el('li', 'list-note', 'Loading…'));
  }
  for (const list of lists) { list.setAttribute('aria-busy', 'true'); list.classList.add('loading'); }

  try {
    const { owned, shared } = await api('GET', '/api/documents');

    $('owned-list').replaceChildren(
      ...(owned.length
        ? owned.map((d) => makeListItem(d, `${d.share_count ? `Shared with ${d.share_count}` : 'Private'} · ${formatTime(d.updated_at)}`, 'doc'))
        : [emptyListMessage('doc', 'No documents yet', 'Create a document or import a file to get started.')])
    );
    $('shared-list').replaceChildren(
      ...(shared.length
        ? shared.map((d) => makeListItem(d, `${d.owner_name} · ${d.role === 'viewer' ? 'Can view' : 'Can edit'} · ${formatTime(d.updated_at)}`, 'users'))
        : [emptyListMessage('users', 'Nothing shared with you yet', 'When a teammate shares a document with you, it will appear here.')])
    );
    setCount('owned-count', owned.length);
    setCount('shared-count', shared.length);
    listsLoadedOnce = true;
  } finally {
    for (const list of lists) { list.removeAttribute('aria-busy'); list.classList.remove('loading'); }
  }
}

// ================= open / create / delete =================

async function openDoc(id) {
  await saveNow(); // don't lose edits on the doc we are leaving

  // Loading feedback: dim the open doc, or show "Opening document…" if nothing is open yet
  if (currentDoc) $('editor-area').setAttribute('aria-busy', 'true');
  else { $('empty-state').hidden = true; $('doc-loading').hidden = false; }

  try {
    const { document: doc } = await api('GET', `/api/documents/${id}`);
    currentDoc = doc;
    hasChanges = false;
    inConflict = false;
    $('conflict-banner').hidden = true;
    history.replaceState(null, '', `#/doc/${doc.id}`); // put the doc number in the address
    const canEdit = doc.access === 'owner' || doc.access === 'editor';

    $('doc-loading').hidden = true;
    $('empty-state').hidden = true;
    $('editor-area').hidden = false;
    $('doc-title').value = doc.title;
    $('doc-title').title = doc.title;
    $('editor').innerHTML = doc.content || '<p><br></p>';
    setStatus(canEdit ? 'All changes saved ✓' : '', 'ok');

    // Lock things if I can only view
    $('editor').contentEditable = canEdit ? 'true' : 'false';
    $('editor').setAttribute('aria-readonly', String(!canEdit));
    $('editor').classList.toggle('readonly', !canEdit);
    $('doc-title').readOnly = !canEdit;
    for (const b of document.querySelectorAll('#toolbar button, #toolbar select')) b.disabled = !canEdit;
    $('save-btn').hidden = !canEdit;
    $('open-share-btn').hidden = doc.access !== 'owner';
    $('delete-btn').hidden = doc.access !== 'owner';

    $('viewer-banner').hidden = doc.access !== 'viewer';
    $('viewer-banner-text').textContent = `View only. Ask ${doc.owner_name} for edit access.`;

    renderDocInfo();
    await loadLists(); // to highlight the open doc
  } catch (err) {
    toast(err.message === 'Document not found' ? 'That document does not exist or you no longer have access' : err.message, 'error');
    if (!currentDoc) closeEditor();
  } finally {
    $('editor-area').removeAttribute('aria-busy');
    $('doc-loading').hidden = true;
  }
}

function renderDocInfo() {
  const d = currentDoc;
  let text;
  if (d.access === 'owner') {
    text = d.shares.length
      ? `You own this document · Shared with ${d.shares.map((s) => `${s.name} (${s.role === 'viewer' ? 'can view' : 'can edit'})`).join(', ')}`
      : 'You own this document · Private';
  } else if (d.access === 'editor') {
    text = `Owner: ${d.owner_name} · You can edit`;
  } else {
    text = `Owner: ${d.owner_name} · View only`;
  }
  $('doc-info').textContent = text;
}

async function createDoc(button) {
  const restore = setBusy(button, 'Creating…');
  try {
    const { id } = await api('POST', '/api/documents');
    await openDoc(id);
    $('doc-title').focus();
    $('doc-title').select(); // ready to type a new name
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

// Step 1: ask first. Nothing is deleted until "Delete document" is clicked.
function deleteDoc() {
  if (!currentDoc) return;
  $('delete-doc-title').textContent = currentDoc.title;
  $('delete-dialog').showModal();
  $('delete-cancel').focus(); // the safe choice has focus, so Enter never deletes by accident
}

// Step 2: the user confirmed. (The server also checks that they are the owner.)
async function confirmDelete() {
  if (!currentDoc) return;
  const title = currentDoc.title;
  const restore = setBusy($('delete-confirm'), 'Deleting…');
  $('delete-cancel').disabled = true;
  try {
    clearTimeout(saveTimer);
    await api('DELETE', `/api/documents/${currentDoc.id}`);
    hasChanges = false;
    $('delete-dialog').close();
    closeEditor();
    await loadLists();
    toast(`"${title}" was deleted`, 'success');
    $('main').focus(); // keep keyboard focus somewhere sensible
  } catch (err) {
    $('delete-dialog').close();
    toast(`Could not delete: ${err.message}`, 'error');
  } finally {
    restore();
    $('delete-cancel').disabled = false;
  }
}

// ================= sharing (dialog) =================

async function openShareDialog() {
  const restore = setBusy($('open-share-btn'), 'Loading…');
  try {
    ({ users: allUsers } = await api('GET', '/api/users'));
  } catch (err) {
    return toast(err.message, 'error');
  } finally {
    restore();
  }
  $('share-doc-title').textContent = currentDoc.title;
  renderShareDialog();
  $('share-dialog').showModal();
  $('share-user').focus();
}

function personBlock(name, email) {
  const avatar = el('span', 'avatar', initials(name));
  avatar.setAttribute('aria-hidden', 'true');
  const text = el('span', 'person-text');
  text.append(el('b', '', name), el('span', '', email));
  return [avatar, text];
}

function renderShareDialog() {
  $('share-error').textContent = '';

  // Owner
  $('share-owner').replaceChildren(...personBlock(`${me.name} (you)`, me.email), el('span', 'badge', 'Owner'));

  // Dropdown: everyone who does NOT have access yet
  const alreadyShared = new Set(currentDoc.shares.map((s) => s.user_id));
  const candidates = allUsers.filter((u) => !alreadyShared.has(u.id));
  $('share-user').replaceChildren(
    ...(candidates.length
      ? candidates.map((u) => { const o = el('option', '', `${u.name} (${u.email})`); o.value = u.email; return o; })
      : [el('option', '', 'Everyone already has access')])
  );
  $('share-user').disabled = candidates.length === 0;
  $('share-role').disabled = candidates.length === 0;
  $('share-btn').disabled = candidates.length === 0;

  // Recipients
  const n = currentDoc.shares.length;
  $('share-count-heading').textContent = `People with access (${n})`;
  if (n === 0) {
    $('share-list').replaceChildren(el('li', 'share-empty', 'Only you can access this document.'));
    return;
  }
  $('share-list').replaceChildren(...currentDoc.shares.map((s) => {
    const row = el('li', 'share-item');
    const person = el('span', 'person');
    person.append(...personBlock(s.name, s.email));

    const roleSelect = el('select');
    roleSelect.setAttribute('aria-label', `Access level for ${s.name}`);
    roleSelect.append(new Option('Can edit', 'editor'), new Option('Can view', 'viewer'));
    roleSelect.value = s.role;
    roleSelect.addEventListener('change', () => addShare(s.email, roleSelect.value, `${s.name} can now ${roleSelect.value === 'viewer' ? 'view' : 'edit'}`));

    const removeBtn = el('button', 'btn btn-danger btn-sm', 'Remove');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${s.name}`);
    removeBtn.addEventListener('click', () => removeShare(s.user_id, s.name, removeBtn));

    const controls = el('span', 'share-controls');
    controls.append(roleSelect, removeBtn);
    row.append(person, controls);
    return row;
  }));
}

async function addShare(email, role, successMessage) {
  if (!email) return;
  const restore = setBusy($('share-btn'), 'Adding…');
  try {
    const { shares } = await api('POST', `/api/documents/${currentDoc.id}/shares`, { email, role });
    currentDoc.shares = shares;
    renderShareDialog();
    renderDocInfo();
    await loadLists();
    toast(successMessage || 'Access granted', 'success');
  } catch (err) {
    $('share-error').textContent = err.message;
  } finally {
    restore();
    $('share-btn').disabled = $('share-user').disabled; // keep "Add" disabled if nobody is left
  }
}

async function removeShare(userId, name, button) {
  setBusy(button, 'Removing…'); // the row is re-rendered afterwards, so no restore needed on success
  try {
    const { shares } = await api('DELETE', `/api/documents/${currentDoc.id}/shares/${userId}`);
    currentDoc.shares = shares;
    renderShareDialog();
    renderDocInfo();
    await loadLists();
    toast(`${name} no longer has access`, 'success');
  } catch (err) {
    $('share-error').textContent = err.message;
    renderShareDialog();
  }
}

// ================= import a file =================

async function importFile(file) {
  if (!file) return;

  // Quick checks in the browser (the server checks again)
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!['.txt', '.md'].includes(ext)) return toast('Only .txt and .md files are supported', 'error');
  if (file.size > 1024 * 1024) return toast('File is too big (max 1 MB)', 'error');

  const restore = setBusy($('import-btn'), 'Importing…');
  try {
    let res;
    try {
      res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name) },
        body: file, // send the file itself
      });
    } catch {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    await openDoc(data.id); // open the new document
    toast(`Imported "${file.name}"`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

// ================= saving =================

// Called every time something changes: wait 1 second of quiet, then save
function markChanged() {
  if (!currentDoc) return;
  hasChanges = true;
  clearTimeout(saveTimer);
  if (inConflict) return; // paused: the user must choose a version first (see conflict banner)
  setStatus('Unsaved changes…', 'pending');
  saveTimer = setTimeout(saveNow, 1000);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!currentDoc || !hasChanges || inConflict) return;
  if (isSaving) {                        // another save is running: try again shortly
    saveTimer = setTimeout(saveNow, 300);
    return;
  }
  const title = $('doc-title').value.trim();
  if (!title) return setStatus('Not saved: title cannot be empty', 'error');

  const docId = currentDoc.id;
  isSaving = true;
  hasChanges = false;
  setStatus('Saving…', 'pending');
  try {
    const { updated_at } = await api('PATCH', `/api/documents/${docId}`, {
      title,
      content: editorHtmlForSave(),
      base_updated_at: currentDoc.updated_at, // "I'm editing the version from this time"
    });
    if (!currentDoc || currentDoc.id !== docId) return; // user switched docs meanwhile
    currentDoc.title = title;
    currentDoc.updated_at = updated_at;
    $('doc-title').title = title;
    setStatus(hasChanges ? 'Unsaved changes…' : 'All changes saved ✓', hasChanges ? 'pending' : 'ok');
    await loadLists(); // so a new title / time shows on the left
  } catch (err) {
    hasChanges = true; // never drop the user's edits
    if (err.status === 409) {
      // Someone else saved first. Pause autosave and let the user decide.
      inConflict = true;
      currentDoc.latest = err.data.document;
      $('conflict-banner').hidden = false;
      setStatus('Not saved: conflict', 'error');
    } else if (err.status === 403) {
      setStatus('Not saved: your access changed', 'error');
      toast('Your access to this document changed. Reloading it.', 'error');
      hasChanges = false;
      openDoc(docId);
    } else if (err.status === 0 || err.status >= 500) {
      // Network or server hiccup: keep the edits and retry automatically
      setStatus('Not saved: connection problem. Retrying…', 'error');
      saveTimer = setTimeout(saveNow, 5000);
    } else {
      setStatus('Not saved: ' + err.message, 'error');
    }
  } finally {
    isSaving = false;
  }
}

// The browser's editor sometimes nests a list inside a paragraph (<p><ul>…</ul></p>).
// That is invalid HTML, so after a reload the browser would "repair" it and add empty lines.
// We fix the structure on a copy before saving, so reopening shows the same layout every time.
const BLOCK_TAGS = /^(UL|OL|H1|H2|H3|P|DIV|BLOCKQUOTE|HR)$/;
function editorHtmlForSave() {
  const copy = $('editor').cloneNode(true);
  for (const box of [...copy.querySelectorAll('p, div')].reverse()) { // innermost first
    if (![...box.children].some((c) => BLOCK_TAGS.test(c.tagName))) continue;
    const pieces = document.createDocumentFragment();
    let run = null; // loose text next to a list gets its own paragraph
    for (const node of [...box.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.test(node.tagName)) { run = null; pieces.append(node); continue; }
      if (!run) { run = document.createElement('p'); pieces.append(run); }
      run.append(node);
    }
    for (const p of pieces.querySelectorAll(':scope > p')) {
      if (!p.textContent.trim() && !p.querySelector('br')) p.remove(); // drop empty leftovers
    }
    box.replaceWith(pieces);
  }
  return copy.innerHTML;
}

// Conflict choice 1: throw away my unsaved edits and show what the other person saved
function loadTheirVersion() {
  hasChanges = false;
  inConflict = false;
  openDoc(currentDoc.id);
}

// Conflict choice 2: save my version on top of theirs (an explicit, informed choice)
function keepMyVersion() {
  currentDoc.updated_at = currentDoc.latest.updated_at;
  inConflict = false;
  $('conflict-banner').hidden = true;
  hasChanges = true;
  saveNow();
}

// Save button + Ctrl+S: save right now
function forceSave() {
  if (!currentDoc || currentDoc.access === 'viewer' || inConflict) return;
  hasChanges = true;
  saveNow();
}

// ================= paste cleaning =================
// Pasted content (e.g. from Word or Google Docs) carries fonts, colors and images.
// Keep only what the editor supports, so what you see is exactly what gets saved.

const PASTE_KEEP = { P: 'p', DIV: 'p', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
  UL: 'ul', OL: 'ol', LI: 'li', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', BR: 'br', BLOCKQUOTE: 'blockquote' };
const PASTE_DROP = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'IFRAME', 'OBJECT', 'META', 'LINK', 'TITLE', 'HEAD', 'TABLE']);

function cleanPastedHtml(html) {
  const source = new DOMParser().parseFromString(html, 'text/html').body;
  const out = document.createElement('div');

  const walk = (node, parent) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { parent.append(child.textContent); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || PASTE_DROP.has(child.tagName)) continue;

      const style = child.getAttribute('style') || '';
      let tag = PASTE_KEEP[child.tagName];
      // Google Docs wraps everything in <b style="font-weight:normal">: that is NOT bold
      if (tag === 'b' && /font-weight:\s*(normal|[1-5]00)\b/.test(style)) tag = null;

      let target = parent;
      if (tag) { target = document.createElement(tag); parent.append(target); }
      // Formatting expressed only as inline styles (common in Google Docs)
      if (/font-weight:\s*(bold|[6-9]00)/.test(style) && tag !== 'b') { const b = document.createElement('b'); target.append(b); target = b; }
      if (/font-style:\s*italic/.test(style) && tag !== 'i') { const i = document.createElement('i'); target.append(i); target = i; }
      if (/text-decoration[^;]*underline/.test(style) && tag !== 'u') { const u = document.createElement('u'); target.append(u); target = u; }

      if (tag !== 'br') walk(child, target);
    }
  };
  walk(source, out);
  return out.innerHTML;
}

// ================= toolbar =================

for (const button of document.querySelectorAll('#toolbar button')) {
  // mousedown + preventDefault keeps your text selected when you click the button
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    document.execCommand(button.dataset.cmd); // bold, italic, lists...
    updateToolbar();
    markChanged();
  });
}

$('block-select').addEventListener('change', (e) => {
  $('editor').focus();
  document.execCommand('formatBlock', false, e.target.value); // p, h1, h2, h3
  markChanged();
});

// Light up B / I / U / lists when the cursor is on formatted text
function updateToolbar() {
  for (const b of document.querySelectorAll('#toolbar [aria-pressed]')) {
    b.setAttribute('aria-pressed', String(document.queryCommandState(b.dataset.cmd)));
  }
  const block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase();
  $('block-select').value = ['h1', 'h2', 'h3'].includes(block) ? block : 'p';
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement === $('editor')) updateToolbar();
});

// ================= wiring buttons =================

document.execCommand('defaultParagraphSeparator', false, 'p'); // Enter makes a new <p>
$('editor').addEventListener('input', markChanged);
$('editor').addEventListener('paste', (e) => {
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  e.preventDefault();
  if (html) document.execCommand('insertHTML', false, cleanPastedHtml(html));
  else document.execCommand('insertText', false, text);
});
$('doc-title').addEventListener('input', markChanged);
$('doc-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('editor').focus(); }
});

$('save-btn').addEventListener('click', forceSave);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); // stop the browser's own "save page" box
    forceSave();
  }
});

// Sign in (form submit = button click OR pressing Enter)
async function login(email, password) {
  $('login-error').textContent = '';
  if (!email || !password) return ($('login-error').textContent = 'Please enter your email and password');
  const restore = setBusy($('login-submit'), 'Signing in…');
  try {
    const { user } = await api('POST', '/api/login', { email, password });
    await showApp(user);
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    restore();
  }
}
$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  login($('email').value.trim(), $('password').value);
});
for (const b of document.querySelectorAll('[data-demo]')) {
  b.addEventListener('click', () => {
    $('email').value = b.dataset.demo;
    $('password').value = 'Likitha@123';
    login(b.dataset.demo, 'Likitha@123');
  });
}

$('logout-btn').addEventListener('click', async () => {
  await saveNow();
  await api('POST', '/api/logout').catch(() => {});
  closeEditor();   // forget the open doc, so the next person doesn't try to open it
  showLogin();
});

$('new-doc-btn').addEventListener('click', (e) => createDoc(e.currentTarget));
$('empty-create-btn').addEventListener('click', (e) => createDoc(e.currentTarget));
$('import-btn').addEventListener('click', () => $('import-input').click());
$('empty-import-btn').addEventListener('click', () => $('import-input').click());
$('delete-btn').addEventListener('click', deleteDoc);
$('delete-cancel').addEventListener('click', () => $('delete-dialog').close());
$('delete-confirm').addEventListener('click', confirmDelete);
$('delete-dialog').addEventListener('close', () => {
  // Return focus to the Delete button if the doc still exists, otherwise to the main area
  if (currentDoc) $('delete-btn').focus(); else $('main').focus();
});
$('conflict-load').addEventListener('click', loadTheirVersion);
$('conflict-keep').addEventListener('click', keepMyVersion);
$('open-share-btn').addEventListener('click', openShareDialog);
$('share-btn').addEventListener('click', () => {
  const option = $('share-user').selectedOptions[0];
  const name = option ? option.textContent.split(' (')[0] : '';
  const role = $('share-role').value;
  addShare($('share-user').value, role, `Shared with ${name} (${role === 'viewer' ? 'can view' : 'can edit'})`);
});
$('share-close').addEventListener('click', () => $('share-dialog').close());
$('share-dialog').addEventListener('close', () => $('open-share-btn').focus()); // return focus after Esc / Done
$('import-input').addEventListener('change', (e) => {
  importFile(e.target.files[0]);
  e.target.value = ''; // reset, so the same file can be picked again
});

// A doc link pasted into the address bar (or Back/Forward) opens that doc
window.addEventListener('hashchange', () => {
  if (!me) return;
  const m = location.hash.match(/^#\/doc\/(\d+)$/);
  if (m && (!currentDoc || currentDoc.id !== Number(m[1]))) openDoc(Number(m[1]));
});

// Warn if you try to close the tab before saving
window.addEventListener('beforeunload', (e) => {
  if (hasChanges || isSaving) e.preventDefault();
});

// ================= start =================
// When the page opens: am I already logged in? (and was a doc open?)
api('GET', '/api/me')
  .then(({ user }) => showApp(user))
  .catch(() => showLogin());