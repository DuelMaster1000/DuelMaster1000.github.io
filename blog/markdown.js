/* Minimal, safe Markdown → HTML for blog posts.
   Every character of input is HTML-escaped first; only the constructs below become tags.
   Links allow http(s), mailto and relative URLs only; images allow https only.

   Supported:
     ## Heading / ### Subheading   (a single # is treated like ##)
     **bold**  *italic*  _italic_  ~~strike~~  `code`
     [text](https://…)   ![alt](https://…)
     - bullet list   1. numbered list   > quote   --- divider
     ```  fenced code block  ```
   A single line break inside a paragraph is kept as a line break. */
(function (global) {
  'use strict';

  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Browsers ignore control characters and whitespace inside URLs ("java\tscript:"),
  // so strip them before deciding whether the scheme is allowed.
  const cleanUrl = (url) => {
    const u = url.replace(/[\u0000- \u007f-\u009f]/g, '');
    const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return null;
    return u || null;
  };

  const emphasis = (s) => s
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?=\S)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');

  // URLs may contain one level of balanced parentheses (e.g. Wikipedia links)
  const IMG = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
  const LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

  function inline(raw) {
    let s = esc(raw);
    // Code, images and links become placeholders so emphasis never touches their contents.
    const saved = [];
    const keep = (html) => `\u0000${saved.push(html) - 1}\u0000`;

    s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
    s = s.replace(IMG, (m, alt, url) => {
      const u = cleanUrl(url);
      // Only https images; anything else shows its description text instead
      return u && /^https:\/\//i.test(u) ? keep(`<img src="${u}" alt="${alt}" loading="lazy">`) : keep(alt);
    });
    s = s.replace(LINK, (m, text, url) => {
      const u = cleanUrl(url);
      if (!u) return text;
      const external = /^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return keep(`<a href="${u}"${external}>${emphasis(text)}</a>`);
    });

    s = emphasis(s);
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[+i]);
  }

  const RE = {
    fence: /^\s*```/,
    heading: /^(#{1,4})\s+(.*)$/,
    hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
    quote: /^\s*>\s?/,
    ul: /^\s*[-*+]\s+/,
    ol: /^\s*\d+[.)]\s+/,
    blank: /^\s*$/,
  };
  const startsBlock = (line) =>
    RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) ||
    RE.quote.test(line) || RE.ul.test(line) || RE.ol.test(line);

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      let m;

      if (RE.blank.test(line)) { i++; continue; }

      if (RE.fence.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i])) code.push(lines[i++]);
        i++; // closing fence
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }

      if ((m = line.match(RE.heading))) {
        // "#"/"##" → h2 (the post title is the page's h1), "###" → h3, "####" → h4
        const level = Math.min(Math.max(m[1].length, 2), 4);
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
        i++;
        continue;
      }

      if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

      if (RE.quote.test(line)) {
        const inner = [];
        while (i < lines.length && RE.quote.test(lines[i])) inner.push(lines[i++].replace(RE.quote, ''));
        out.push(`<blockquote>${render(inner.join('\n'))}</blockquote>`);
        continue;
      }

      if (RE.ul.test(line) || RE.ol.test(line)) {
        const ordered = RE.ol.test(line);
        const marker = ordered ? RE.ol : RE.ul;
        const items = [];
        while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ''));
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
        continue;
      }

      // Paragraph: consume at least this line, then until a blank line or another block.
      const para = [lines[i++]];
      while (i < lines.length && !RE.blank.test(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }

    return out.join('\n');
  }

  global.Markdown = { render };
})(typeof window !== 'undefined' ? window : globalThis);
