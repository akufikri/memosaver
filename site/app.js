/* Hallmark · app.js · theme: Cobalt · nav: N13 (working ⌘K palette) · motion: reveal · type-in · copy-state
 * No framework, no build step at runtime. Everything degrades: without JS the page is complete,
 * the palette never opens, and every command is still readable and copyable by hand.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------- one orchestrated entrance */

const revealables = document.querySelectorAll('.reveal');
if (reduceMotion || !('IntersectionObserver' in window)) {
  revealables.forEach((el) => el.classList.add('is-in'));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' }
  );
  revealables.forEach((el) => observer.observe(el));
}

/* ---------------------------------------------- nav frost (no scroll listener) */

const nav = document.getElementById('nav');
const navSentinel = document.getElementById('nav-sentinel');
if (nav && navSentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => nav.classList.toggle('is-frosted', !entry.isIntersecting),
    { threshold: 0 }
  ).observe(navSentinel);
}

/* ---------------------------------------------- hero type-in (plays once) */

const typed = document.querySelector('[data-typed]');
if (typed) {
  const full = typed.dataset.typed;
  const output = document.querySelectorAll('[data-typed-after]');
  const revealOutput = () => {
    output.forEach((el) => {
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('is-in'));
    });
  };

  if (reduceMotion) {
    typed.textContent = full;
    revealOutput();
  } else {
    let index = 0;
    typed.textContent = '';
    const tick = () => {
      typed.textContent = full.slice(0, (index += 1));
      if (index < full.length) {
        window.setTimeout(tick, 18);
      } else {
        revealOutput();
      }
    };
    window.setTimeout(tick, 260);
  }
}

/* ---------------------------------------------- copy buttons (label swap, no toast) */

for (const button of document.querySelectorAll('.copy-btn')) {
  const target = button.closest('.step-block')?.querySelector('pre');
  if (!target) continue;
  const label = button.querySelector('.copy-btn__label');
  const original = label ? label.textContent : '';

  const revert = () => {
    delete button.dataset.state;
    if (label) label.textContent = original;
  };

  button.addEventListener('click', async () => {
    const text = target.innerText.replace(/\s+$/u, '');
    try {
      await navigator.clipboard.writeText(text);
      button.dataset.state = 'copied';
      if (label) label.textContent = 'Copied';
      window.setTimeout(revert, 2500);
    } catch {
      button.dataset.state = 'error';
      if (label) label.textContent = 'Select & copy';
      window.setTimeout(revert, 2500);
    }
  });
}

/* ---------------------------------------------- screenshot tabs */

const tablist = document.querySelector('[role="tablist"]');
if (tablist) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

  const select = (next, focus = true) => {
    for (const tab of tabs) {
      const selected = tab === next;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = panelFor(tab);
      if (panel) panel.hidden = !selected;
    }
    if (focus) next.focus({ preventScroll: true });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length]);
    });
  });
}

/* ---------------------------------------------- ⌘K palette (real, keyboard-first) */

const palette = document.getElementById('cmdk');
const paletteInput = document.getElementById('cmdk-input');
const paletteResults = document.getElementById('cmdk-results');
const searchpill = document.getElementById('searchpill');

if (palette && paletteInput && paletteResults && searchpill) {
  let entries = [];
  let active = 0;

  const collect = () => {
    const fromPage = [...document.querySelectorAll('[data-cmdk]')].map((el) => ({
      label: el.dataset.cmdk,
      kind: el.dataset.cmdkKind || 'section',
      href: `#${el.id}`
    }));
    const tools = [...document.querySelectorAll('[data-tool]')].map((row) => ({
      label: row.dataset.tool,
      kind: 'mcp tool',
      href: '#tools'
    }));
    entries = [...fromPage, ...tools];
  };

  const render = (query) => {
    const needle = query.trim().toLowerCase();
    const matches = entries.filter((entry) => entry.label.toLowerCase().includes(needle));
    active = 0;
    paletteResults.replaceChildren();

    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cmdk__empty';
      empty.textContent = 'No section or tool matches that. Try “session”, “search” or “visual”.';
      paletteResults.append(empty);
      return;
    }

    const groups = new Map();
    for (const match of matches) {
      if (!groups.has(match.kind)) groups.set(match.kind, []);
      groups.get(match.kind).push(match);
    }

    for (const [kind, items] of groups) {
      const heading = document.createElement('p');
      heading.className = 'cmdk__group mono-label';
      heading.textContent = kind;
      paletteResults.append(heading);
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cmdk__item';
        button.dataset.href = item.href;
        const text = document.createElement('span');
        text.textContent = item.label;
        const kindTag = document.createElement('span');
        kindTag.className = 'cmdk__item-kind';
        kindTag.textContent = item.kind;
        button.append(text, kindTag);
        button.addEventListener('click', () => go(button));
        paletteResults.append(button);
      }
    }
    highlight();
  };

  const items = () => [...paletteResults.querySelectorAll('.cmdk__item')];

  const highlight = () => {
    items().forEach((item, index) => item.classList.toggle('is-active', index === active));
  };

  const go = (item) => {
    const href = item.dataset.href;
    close();
    const target = href ? document.querySelector(href) : null;
    if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const open = () => {
    collect();
    render('');
    paletteInput.value = '';
    palette.classList.add('is-open');
    palette.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    paletteInput.focus();
  };

  const close = () => {
    palette.classList.remove('is-open');
    palette.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    searchpill.focus();
  };

  searchpill.addEventListener('click', open);
  palette.querySelector('[data-close]')?.addEventListener('click', close);

  paletteInput.addEventListener('input', () => render(paletteInput.value));

  palette.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const list = items();
      if (list.length === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      highlight();
      list[active].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      const current = items()[active];
      if (current) {
        event.preventDefault();
        go(current);
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.classList.contains('is-open') ? close() : open();
    }
  });
}
