/* Public blog pages: the post list (index.html) and a single post (post.html?p=slug). */
(() => {
  'use strict';

  const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
  const fmtDate = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const fetchText = async (url) => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  const loadIndex = async () => {
    const posts = JSON.parse(await fetchText('posts/index.json'));
    return Array.isArray(posts) ? posts.filter((p) => p && SLUG.test(p.slug)) : [];
  };

  /* ---------- Post list ---------- */
  const list = document.getElementById('post-list');
  if (list) {
    loadIndex().then((posts) => {
      list.textContent = '';
      if (!posts.length) {
        list.append(el('p', 'blog-empty', 'No posts yet. Check back soon.'));
        return;
      }
      posts.forEach((p) => {
        const article = el('article', 'entry');
        article.append(el('p', 'meta', fmtDate(p.date)));
        const h = el('h2', 'entry__title');
        const a = el('a', 'post-link', p.title);
        a.href = `post.html?p=${encodeURIComponent(p.slug)}`;
        h.append(a);
        article.append(h);
        if (p.summary) article.append(el('p', 'entry__text', p.summary));
        list.append(article);
      });
    }).catch(() => {
      list.textContent = '';
      list.append(el('p', 'blog-empty', 'Posts could not be loaded right now.'));
    });
  }

  /* ---------- Single post ---------- */
  const body = document.getElementById('post-body');
  if (body) {
    const slug = new URLSearchParams(location.search).get('p') || '';
    const title = document.getElementById('post-title');
    const date = document.getElementById('post-date');
    const summary = document.getElementById('post-summary');
    const notFound = () => {
      title.textContent = 'Post not found';
      date.textContent = '';
      body.textContent = '';
      body.append(el('p', null, "That post doesn't exist (or was removed)."));
    };

    if (!SLUG.test(slug)) {
      notFound();
    } else {
      Promise.all([loadIndex(), fetchText(`posts/${slug}.md`)])
        .then(([posts, md]) => {
          const meta = posts.find((p) => p.slug === slug);
          if (!meta) return notFound();
          title.textContent = meta.title;
          date.textContent = fmtDate(meta.date);
          if (meta.summary) { summary.textContent = meta.summary; summary.hidden = false; }
          document.title = `${meta.title} — Adam Halliday`;
          body.innerHTML = window.Markdown.render(md); // renderer escapes all input HTML
        })
        .catch(notFound);
    }
  }
})();
