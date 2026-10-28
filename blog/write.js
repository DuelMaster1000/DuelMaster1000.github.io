/* Blog editor (write.html).
   Posting is restricted by GitHub itself: publishing needs a fine-grained access token
   that only the repo owner can create, scoped to this one repository. The token is kept
   only in this browser (never in the site's files) and is sent only to api.github.com.
   Each publish/delete is a single commit authored with the private no-reply identity. */
(() => {
  'use strict';

  const OWNER = 'DuelMaster1000';
  const REPO = 'DuelMaster1000.github.io';
  const BRANCH = 'main';
  const DIR = 'blog/posts';
  const SITE = `https://${OWNER.toLowerCase()}.github.io`;
  const AUTHOR = { name: 'Adam Halliday', email: '62613051+DuelMaster1000@users.noreply.github.com' };
  const API = 'https://api.github.com';
  const TOKEN_KEY = 'blog-gh-token';
  const DRAFT_KEY = 'blog-draft';

  const $ = (id) => document.getElementById(id);
  const ui = {
    signin: $('signin'), signinForm: $('signin-form'), token: $('token'), remember: $('remember'),
    editor: $('editor'), who: $('who-name'), signout: $('signout'),
    mine: $('my-posts'), newPost: $('new-post'),
    heading: $('editing-label'), title: $('title'), date: $('date'), summary: $('summary'), body: $('body'),
    toolbar: $('toolbar'), preview: $('preview'), publish: $('publish'), del: $('delete'), status: $('status'),
  };

  /* ---------- small helpers ---------- */
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const tokenStore = {
    get: () => safe(() => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY)),
    set: (t, remember) => safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t)),
    clear: () => safe(() => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); }),
  };
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post';
  const byNewest = (a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug);

  function setStatus(message, kind = '', link) {
    ui.status.className = `status${kind ? ` status--${kind}` : ''}`;
    ui.status.textContent = message;
    if (link) {
      ui.status.append(' ');
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = link.replace(/^https?:\/\//, '');
      ui.status.append(a);
    }
  }
  function busy(on) {
    [ui.publish, ui.del, ui.newPost, ui.signout].forEach((b) => { if (b) b.disabled = on; });
    ui.mine.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  }

  /* ---------- GitHub API ---------- */
  let token = null;
  async function gh(path, { method = 'GET', body, raw = false, auth = token } = {}) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = `GitHub API error ${res.status}`;
      try { message = (await res.json()).message || message; } catch { /* keep default */ }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return raw ? res.text() : (res.status === 204 ? null : res.json());
  }

  async function readFile(path, ref) {
    try {
      return await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`, { raw: true });
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  async function readIndex(ref) {
    const text = await readFile(`${DIR}/index.json`, ref);
    const list = text ? safe(() => JSON.parse(text), []) : [];
    return Array.isArray(list) ? list : [];
  }

  // Build one commit from a list of file changes, retrying once if the branch moved meanwhile.
  async function commitWith(build) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
      const head = ref.object.sha;
      const { changes, message, result } = await build(head);
      const base = await gh(`/repos/${OWNER}/${REPO}/git/commits/${head}`);
      const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
        method: 'POST',
        body: {
          base_tree: base.tree.sha,
          tree: changes.map((c) => (c.remove
            ? { path: c.path, mode: '100644', type: 'blob', sha: null }
            : { path: c.path, mode: '100644', type: 'blob', content: c.content })),
        },
      });
      const now = new Date().toISOString();
      const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
        method: 'POST',
        body: { message, tree: tree.sha, parents: [head], author: { ...AUTHOR, date: now }, committer: { ...AUTHOR, date: now } },
      });
      try {
        await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha } });
        return result;
      } catch (e) {
        if (attempt === 1 || e.status !== 422) throw e;
      }
    }
    return null;
  }

  function explain(e) {
    if (e.status === 401) return 'GitHub rejected the token (it may have expired or been revoked). Sign out and paste a new one.';
    if (e.status === 403) return 'This token is not allowed to write to the repo. It needs "Contents: Read and write" on DuelMaster1000.github.io.';
    if (e.status === 404) return 'The token cannot see the repo. Make sure it has access to DuelMaster1000.github.io.';
    if (e instanceof TypeError) return 'Could not reach GitHub. Check your connection and try again.';
    return `Something went wrong: ${e.message}`;
  }

  /* ---------- sign in / out ---------- */
  async function verify(candidate) {
    const user = await gh('/user', { auth: candidate });
    if (!user || user.login !== OWNER) {
      const err = new Error('This token belongs to a different GitHub account.');
      err.status = 0;
      throw err;
    }
    await gh(`/repos/${OWNER}/${REPO}`, { auth: candidate });
    return user;
  }

  async function startSession(candidate) {
    const user = await verify(candidate);
    token = candidate;
    ui.who.textContent = user.login;
    ui.signin.hidden = true;
    ui.editor.hidden = false;
    await refreshList();
    restoreDraft();
  }

  ui.signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const candidate = ui.token.value.trim();
    if (!candidate) return;
    setStatus('Checking token…');
    try {
      await startSession(candidate);
      tokenStore.set(candidate, ui.remember.checked);
      ui.token.value = '';
      setStatus('Signed in.', 'ok');
    } catch (err) {
      token = null;
      setStatus(err.status === 0 ? err.message : explain(err), 'error');
    }
  });

  ui.signout.addEventListener('click', () => {
    tokenStore.clear();
    token = null;
    ui.editor.hidden = true;
    ui.signin.hidden = false;
    setStatus('Signed out. The token was removed from this browser.', 'ok');
  });

  /* ---------- your posts ---------- */
  let currentSlug = null; // null = new post

  async function refreshList() {
    const posts = await readIndex(BRANCH);
    ui.mine.textContent = '';
    if (!posts.length) {
      const li = document.createElement('li');
      li.textContent = 'No posts yet.';
      ui.mine.append(li);
      return;
    }
    posts.forEach((p) => {
      const li = document.createElement('li');
      const date = document.createElement('span'); date.className = 'mine__date'; date.textContent = p.date;
      const title = document.createElement('span'); title.className = 'mine__title'; title.textContent = p.title;
      const btns = document.createElement('span'); btns.className = 'mine__btns';
      btns.append(keyButton('Edit', 'E', () => loadPost(p)), keyButton('View', '↗', () => window.open(`${SITE}/blog/post.html?p=${p.slug}`, '_blank', 'noopener')));
      li.append(date, title, btns);
      ui.mine.append(li);
    });
  }

  function keyButton(label, legend, onClick, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `key key--sm${extra}`;
    const top = document.createElement('span'); top.className = 'key__top';
    const lg = document.createElement('span'); lg.className = 'key__legend'; lg.setAttribute('aria-hidden', 'true'); lg.textContent = legend;
    const lb = document.createElement('span'); lb.className = 'key__label'; lb.textContent = label;
    top.append(lg, lb); b.append(top);
    b.addEventListener('click', onClick);
    return b;
  }

  async function loadPost(p) {
    if (isDirty() && !confirm('Discard your unsaved changes and open this post?')) return;
    busy(true);
    setStatus(`Opening "${p.title}"…`);
    try {
      const md = await readFile(`${DIR}/${p.slug}.md`, BRANCH);
      fill({ slug: p.slug, title: p.title, date: p.date, summary: p.summary || '', body: (md || '').replace(/\s+$/, '') });
      setStatus(`Editing "${p.title}". Publish to save changes.`, 'ok');
      ui.title.focus();
    } catch (e) {
      setStatus(explain(e), 'error');
    } finally {
      busy(false);
    }
  }

  /* ---------- form state, drafts, preview ---------- */
  let savedSnapshot = '';
  const snapshot = () => JSON.stringify([ui.title.value, ui.date.value, ui.summary.value, ui.body.value]);
  const isDirty = () => snapshot() !== savedSnapshot;

  function fill({ slug = null, title = '', date = today(), summary = '', body = '' }) {
    currentSlug = slug;
    ui.title.value = title; ui.date.value = date; ui.summary.value = summary; ui.body.value = body;
    ui.heading.textContent = slug ? `Editing: ${title}` : 'New post';
    ui.del.hidden = !slug;
    ui.publish.querySelector('.key__label').textContent = slug ? 'Update post' : 'Publish';
    savedSnapshot = snapshot();
    renderPreview();
  }

  function saveDraft() {
    safe(() => localStorage.setItem(DRAFT_KEY, JSON.stringify({
      slug: currentSlug, title: ui.title.value, date: ui.date.value, summary: ui.summary.value, body: ui.body.value,
    })));
  }
  const clearDraft = () => safe(() => localStorage.removeItem(DRAFT_KEY));
  function restoreDraft() {
    const draft = safe(() => JSON.parse(localStorage.getItem(DRAFT_KEY)));
    if (draft && (draft.title || draft.body)) {
      fill(draft);
      savedSnapshot = '';
      setStatus('Restored your unsaved draft from this browser.', 'ok');
    } else {
      fill({});
    }
  }

  let previewTimer;
  function renderPreview() {
    const wrap = document.createElement('div');
    const h = document.createElement('h1'); h.className = 'post__title'; h.textContent = ui.title.value || 'Untitled post';
    const body = document.createElement('div'); body.className = 'prose';
    body.innerHTML = window.Markdown.render(ui.body.value); // renderer escapes all input HTML
    wrap.append(h);
    if (ui.summary.value.trim()) {
      const s = document.createElement('p'); s.className = 'post__summary'; s.textContent = ui.summary.value; wrap.append(s);
    }
    const hr = document.createElement('hr'); hr.className = 'post__rule';
    wrap.append(hr, body);
    ui.preview.replaceChildren(...wrap.childNodes);
  }
  function changed() {
    saveDraft();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }
  [ui.title, ui.date, ui.summary, ui.body].forEach((f) => f.addEventListener('input', changed));

  ui.newPost.addEventListener('click', () => {
    if (isDirty() && !confirm('Discard your unsaved changes and start a new post?')) return;
    clearDraft();
    fill({});
    setStatus('');
    ui.title.focus();
  });

  /* ---------- formatting toolbar ---------- */
  const ta = ui.body;
  function wrapSel(before, after = before, placeholder = 'text') {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, 'end');
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    ta.focus(); changed();
  }
  function prefixLines(make) {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    const nl = value.indexOf('\n', e);
    const end = nl === -1 ? value.length : nl;
    const out = value.slice(start, end).split('\n').map((line, i) => make(line, i + 1)).join('\n');
    ta.setRangeText(out, start, end, 'select');
    ta.focus(); changed();
  }
  function insertBlock(text) {
    const { selectionStart: s, value } = ta;
    const pre = s > 0 && value[s - 1] !== '\n' ? '\n\n' : '';
    ta.setRangeText(`${pre}${text}\n`, s, ta.selectionEnd, 'end');
    ta.focus(); changed();
  }
  function link(image = false) {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const text = value.slice(s, e) || (image ? 'image description' : 'link text');
    const snippet = `${image ? '!' : ''}[${text}](https://)`;
    ta.setRangeText(snippet, s, e, 'end');
    const urlStart = s + snippet.length - 'https://)'.length;
    ta.setSelectionRange(urlStart, urlStart + 'https://'.length);
    ta.focus(); changed();
  }
  const actions = {
    bold: () => wrapSel('**', '**', 'bold text'),
    italic: () => wrapSel('*', '*', 'italic text'),
    h2: () => prefixLines((l) => `## ${l.replace(/^#+\s*/, '')}`),
    h3: () => prefixLines((l) => `### ${l.replace(/^#+\s*/, '')}`),
    ul: () => prefixLines((l) => `- ${l}`),
    ol: () => prefixLines((l, n) => `${n}. ${l}`),
    quote: () => prefixLines((l) => `> ${l}`),
    code: () => (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')
      ? wrapSel('```\n', '\n```', 'code') : wrapSel('`', '`', 'code')),
    link: () => link(false),
    image: () => link(true),
    hr: () => insertBlock('---'),
  };
  ui.toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action]();
  });
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const map = { b: 'bold', i: 'italic', k: 'link' };
    const action = map[e.key.toLowerCase()];
    if (action) { e.preventDefault(); actions[action](); }
  });

  /* ---------- publish / delete ---------- */
  ui.publish.addEventListener('click', async () => {
    const title = ui.title.value.trim();
    const date = ui.date.value;
    const summary = ui.summary.value.trim();
    const body = ui.body.value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (!title) return setStatus('Add a title first.', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setStatus('Pick a date for the post.', 'error');
    if (!body) return setStatus('The post is empty.', 'error');

    busy(true);
    setStatus(currentSlug ? 'Saving changes…' : 'Publishing…');
    try {
      const editing = currentSlug;
      const slug = await commitWith(async (head) => {
        const index = await readIndex(head);
        let s = editing;
        if (!s) {
          const base = `${date}-${slugify(title)}`;
          s = base;
          for (let n = 2; index.some((p) => p.slug === s); n++) s = `${base}-${n}`;
        }
        const entry = { slug: s, title, date, ...(summary ? { summary } : {}) };
        const next = index.filter((p) => p.slug !== s).concat(entry).sort(byNewest);
        return {
          result: s,
          message: `${editing ? 'Update' : 'Add'} blog post: ${title}`,
          changes: [
            { path: `${DIR}/${s}.md`, content: `${body}\n` },
            { path: `${DIR}/index.json`, content: `${JSON.stringify(next, null, 2)}\n` },
          ],
        };
      });
      fill({ slug, title, date, summary, body });
      clearDraft();
      await refreshList();
      setStatus(`${editing ? 'Updated' : 'Published'}. It will be live in about a minute:`, 'ok', `${SITE}/blog/post.html?p=${slug}`);
    } catch (e) {
      setStatus(explain(e), 'error');
    } finally {
      busy(false);
    }
  });

  ui.del.addEventListener('click', async () => {
    const slug = currentSlug;
    if (!slug) return;
    if (!confirm(`Delete "${ui.title.value}" from the blog? This removes it from the live site.`)) return;
    busy(true);
    setStatus('Deleting…');
    try {
      await commitWith(async (head) => {
        const index = await readIndex(head);
        return {
          result: true,
          message: `Delete blog post: ${ui.title.value.trim() || slug}`,
          changes: [
            { path: `${DIR}/${slug}.md`, remove: true },
            { path: `${DIR}/index.json`, content: `${JSON.stringify(index.filter((p) => p.slug !== slug), null, 2)}\n` },
          ],
        };
      });
      clearDraft();
      fill({});
      await refreshList();
      setStatus('Deleted. The live blog will update in about a minute.', 'ok');
    } catch (e) {
      setStatus(explain(e), 'error');
    } finally {
      busy(false);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!ui.editor.hidden && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- start ---------- */
  const stored = tokenStore.get();
  if (stored) {
    setStatus('Signing in…');
    startSession(stored)
      .then(() => { if (!ui.status.textContent.startsWith('Restored')) setStatus(''); })
      .catch((err) => {
        tokenStore.clear();
        setStatus(err.status === 0 ? err.message : `${explain(err)}`, 'error');
      });
  }
})();
