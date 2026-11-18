(() => {
  const readerPath = () => /^\/web\/reader\/[^/]+/.test(location.pathname);
  const marker = 'anno-weread-quote';
  const phrase = element => element?.textContent?.trim() || '';
  let selected = null;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    button { pointer-events:auto; position:absolute; border:1px solid #e0c8a6; border-radius:9px;
      background:#fcf6eb; color:#794315; padding:8px 12px; cursor:pointer;
      box-shadow:0 3px 14px #33220e23; font:500 13px/1.3 system-ui,sans-serif; white-space:nowrap }
    button:focus-visible { outline:2px solid #a55e27; outline-offset:3px }
    #open { right:16px; bottom:18px }
    [hidden] { display:none }
    #status { position:absolute; bottom:62px; right:16px; max-width:min(280px,85vw);
      padding:9px 12px; border-radius:8px; background:#392c22; color:#fff; font:13px/1.45 system-ui }
    #source { position:absolute; background:#bd82392e; border-bottom:2px dotted #a86025;
      border-radius:3px; pointer-events:none }
  `;
  const open = document.createElement('button');
  open.id = 'open';
  open.textContent = 'Anno 伴读';
  const explain = document.createElement('button');
  explain.textContent = '✦ 解释';
  explain.setAttribute('aria-label', 'AI 解释所选原句');
  explain.hidden = true;
  const status = document.createElement('div');
  status.id = 'status';
  status.hidden = true;
  status.setAttribute('role', 'status');
  shadow.append(style, open, explain, status);
  function mount() {
    if (readerPath()) {
      if (!host.isConnected) document.documentElement.append(host);
    } else {
      host.remove();
      explain.hidden = true;
      selected = null;
    }
  }
  mount();
  globalThis.navigation?.addEventListener('navigatesuccess', mount);

  function bookInfo() {
    const segment = location.pathname.split('/')[3] || '';
    return {
      key: segment.split('k')[0],
      title: phrase(document.querySelector('.readerTopBar_title_link, .readerTopBar_title')) ||
        document.title.replace(/\s*[-–]\s*微信读书\s*$/, ''),
      chapter: phrase([...document.querySelectorAll('.renderTargetPageInfo_header_chapterTitle,.readerChapterHeader')].find(
        element => element.getClientRects().length
      )),
    };
  }

  function contentRoot(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || element.closest('input, textarea, [contenteditable], .preRenderContainer, [data-wr-ignore], .readerControls, [class*="needPay"], [class*="CoverPage"], [class*="flyleaf"], [class*="float"]')) return null;
    return element.closest('.renderTargetContainer, .readerChapterContent');
  }

  function readerIndex() {
    const containers = [...document.querySelectorAll('.readerChapterContent')].filter(e => e.getClientRects().length);
    return containers.flatMap(element => {
      const targets = [...element.querySelectorAll('.renderTargetContainer')].filter(e => e.getClientRects().length);
      return (targets.length ? targets : [element]).map(annoTextIndex);
    });
  }

  function flash(range) {
    const previous = shadow.querySelectorAll('#source');
    previous.forEach(element => element.remove());
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      const highlight = new Highlight(range);
      CSS.highlights.set(marker, highlight);
      setTimeout(() => { if (CSS.highlights.get(marker) === highlight) CSS.highlights.delete(marker); }, 3200);
    }
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const overlay = document.createElement('div');
      overlay.id = 'source';
      overlay.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      shadow.append(overlay);
      setTimeout(() => overlay.remove(), 2400);
    }
  }

  function updateSelection() {
    if (!host.isConnected) return;
    const selection = getSelection();
    const root = contentRoot(selection?.anchorNode);
    const quote = selection?.toString().trim() || '';
    if (!root || contentRoot(selection.focusNode) !== root || quote.length < 2 || quote.length > 1600) {
      selected = null;
      explain.hidden = true;
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = [...range.getClientRects()].filter(r => r.width && r.height).at(-1);
    if (!rect || rect.bottom < 0 || rect.top > innerHeight) {
      selected = null;
      explain.hidden = true;
      return;
    }

    const info = bookInfo();
    const neighborhood = range.startContainer.parentElement?.closest('p,li,blockquote');
    const index = annoTextIndex(neighborhood?.contains(range.endContainer) ? neighborhood : root);
    const match = findAnnoQuote(index, quote);
    selected = {
      ...info, quote,
      before: match ? index.text.slice(Math.max(0, match.start - 320), match.start) : '',
      after: match ? index.text.slice(match.end + 1, match.end + 321) : '',
    };
    explain.style.left = Math.min(Math.max(8, rect.right + 9), innerWidth - 86) + 'px';
    explain.style.top = Math.min(Math.max(8, rect.bottom + 12), innerHeight - 44) + 'px';
    explain.hidden = false;
  }

  let selectionUpdate;
  function scheduleSelection() {
    clearTimeout(selectionUpdate);
    selectionUpdate = setTimeout(updateSelection, 85);
  }
  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('pointerup', event => {
    if (host.isConnected && event.target !== host) scheduleSelection();
  }, true);
  explain.addEventListener('mousedown', event => event.preventDefault());
  let timer;
  async function activate(type, event, passage) {
    if (!event.isTrusted) return;
    const result = await chrome.runtime.sendMessage({ anno: true, type, passage }).catch(() => ({
      error: '扩展已更新，请刷新阅读页。',
    }));
    if (result?.error) {
      clearTimeout(timer);
      status.textContent = result.error;
      status.hidden = false;
      timer = setTimeout(() => { status.hidden = true; }, 5000);
    }
  }
  open.addEventListener('click', event => { void activate('reader-open', event); });
  explain.addEventListener('click', event => {
    if (!selected) return;
    const passage = { ...selected, actionId: crypto.randomUUID() };
    explain.hidden = true;
    void activate('reader-explain', event, passage);
  });

  globalThis.annoOpenWeReadNote = function (event, note) {
    if (!readerPath() || !event.isTrusted || !note?.quote) return;
    const quote = note.quote.trim();
    if (quote.length < 2 || quote.length > 1600) return;
    void activate('reader-explain', event, {
      ...bookInfo(),
      quote,
      chapter: note.chapterName || '',
      readerNote: (note.readerNote || '').slice(0, 1500),
      actionId: crypto.randomUUID(),
      start: false,
    });
  };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('anno/panel.html') || !readerPath()) return false;
    if (message.type === 'book') reply(bookInfo());
    if (message.type === 'match-page' && Array.isArray(message.quotes)) {
      const indexes = readerIndex();
      const matched = message.quotes.filter(quote =>
        indexes.filter(index => findAnnoQuote(index, quote)).length === 1
      );
      reply(matched);
    }
    if (message.type === 'locate' && typeof message.quote === 'string') {
      const hits = readerIndex().map(index => findAnnoQuote(index, message.quote)).filter(Boolean);
      if (hits.length === 1) {
        hits[0].range.startContainer.parentElement.scrollIntoView({ block: 'center', inline: 'nearest' });
        requestAnimationFrame(() => flash(hits[0].range));
      }
      reply(hits.length === 1);
    }
    return false;
  });
})();
