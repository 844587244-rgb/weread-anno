(() => {
  const readerPath = () => /^\/web\/reader\/[^/]+/.test(location.pathname);
  const marker = 'anno-weread-quote';
  const phrase = element => element?.textContent?.trim() || '';
  let selected = null;
  let markBook = '';
  let notes = [];
  let mountFrame = 0;
  let noteRequest = 0;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:999990;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { --surface:#fff; --border:#e2e2e2; --ink:#424242; --focus:#4377c5;
      --close:#8a593d; --skim:#476b58; --skip:#6b6b6b; --flash:#bd823930 }
    :host([data-theme="dark"]) { --surface:#2a2a2a; --border:#454545; --ink:#dedede; --focus:#92b3f2;
      --close:#dfae87; --skim:#a9c7b1; --skip:#b5b5b5; --flash:#dea96638 }
    button { pointer-events:auto; position:absolute; border:1px solid var(--border); border-radius:8px;
      background:var(--surface); color:var(--ink); padding:8px 12px; cursor:pointer;
      font:500 13px/1.3 system-ui,sans-serif; white-space:nowrap }
    button:focus-visible { outline:2px solid var(--focus); outline-offset:3px }
    #open { right:16px; bottom:18px }
    [hidden] { display:none }
    #status { position:absolute; bottom:62px; right:16px; max-width:min(280px,85vw);
      padding:9px 12px; border-radius:8px; background:#392c22; color:#fff; font:13px/1.45 system-ui }
    .anno-mode { padding:2px 6px; border-radius:10px; color:var(--close);
      font-size:12px; box-shadow:none; transform:translateX(-100%) }
    .anno-mode[data-mode="速读"] { color:var(--skim) }
    .anno-mode[data-mode="跳读"] { color:var(--skip) }
    #source { position:absolute; background:var(--flash); border-bottom:2px dotted var(--close);
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
  const marks = document.createElement('div');
  marks.setAttribute('aria-label', 'Anno 阅读标记');
  shadow.append(style, marks, open, explain, status);
  function mount() {
    if (readerPath()) {
      if (!host.isConnected) document.documentElement.append(host);
      if (markBook !== bookInfo().key) void loadMarks();
      scheduleMarks();
    } else {
      host.remove();
      marks.replaceChildren();
      markBook = '';
      explain.hidden = true;
      selected = null;
    }
  }


  function readerTheme() {
    if (document.querySelector('.wr_blackTheme,.wr_darkTheme,.wr_nightTheme')) return 'dark';
    const layers = [
      document.querySelector('.readerChapterContent,.wr_horizontalReader_app_content'),
      document.body,
      document.documentElement,
    ];
    for (const layer of layers) {
      if (!layer) continue;
      const channels = getComputedStyle(layer).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (channels?.length >= 3 && (channels.length === 3 || channels[3] >= 0.65)) {
        const [r,g,b] = channels;
        return (0.213 * r + 0.715 * g + 0.072 * b) < 132 ? 'dark' : 'light';
      }
    }
    return 'light';
  }

  function bookInfo() {
    const segment = location.pathname.split('/')[3] || '';
    return {
      key: segment.split('k')[0],
      theme: readerTheme(),
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

  function visible(rect) {
    return rect.width > 0 && rect.height > 0 && rect.left < innerWidth &&
      rect.right > 0 && rect.top < innerHeight && rect.bottom > 52;
  }

  function lookup(indexes, quote) {
    const domHits = indexes.dom.map(index => findAnnoQuote(index, quote)).filter(Boolean)
      .map(hit => ({ ...hit, rects: [...hit.range.getClientRects()].filter(visible) }))
      .filter(hit => hit.rects.length);
    if (domHits.length === 1) {
      const hit = domHits[0];
      const paragraph = hit.range.startContainer.parentElement?.closest('p,li,blockquote');
      const candidates = paragraph?.contains(hit.range.endContainer) ? [...paragraph.getClientRects()] : hit.rects;
      const first = hit.rects[0];
      return { ...hit, left: Math.min(first.left, ...candidates
        .filter(rect => rect.right > first.left && rect.left < first.right).map(rect => rect.left)) };
    }
    const hits = indexes.canvas.map(index => findAnnoCanvasQuote(index, quote)).filter(Boolean);
    const unique = new Map(hits.map(hit => {
      const rect = hit.rects[0];
      return [Math.round(rect.left / 4) + ':' + Math.round(rect.top / 4), hit];
    }));
    return unique.size === 1 ? unique.values().next().value : null;
  }

  function readingIndexes() {
    return { dom: readerIndex(), canvas: annoCanvasIndexes() };
  }

  function flash(hit) {
    shadow.querySelectorAll('#source').forEach(element => element.remove());
    if (hit.range && globalThis.CSS?.highlights && globalThis.Highlight) {
      const highlight = new Highlight(hit.range);
      CSS.highlights.set(marker, highlight);
      setTimeout(() => { if (CSS.highlights.get(marker) === highlight) CSS.highlights.delete(marker); }, 3200);
    }
    for (const rect of hit.rects) {
      const overlay = document.createElement('div');
      overlay.id = 'source';
      overlay.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      shadow.append(overlay);
      setTimeout(() => overlay.remove(), 2400);
    }
  }

  async function loadMarks() {
    const key = bookInfo().key;
    const request = ++noteRequest;
    markBook = key;
    notes = [];
    scheduleMarks();
    const result = await chrome.runtime.sendMessage({ anno: true, type: 'reader-marks' }).catch(() => []);
    if (request !== noteRequest || !readerPath() || key !== bookInfo().key) return;
    notes = Array.isArray(result) ? result : [];
    scheduleMarks();
  }

  let layoutKey = '';
  function renderMarks() {
    mountFrame = 0;
    if (host.isConnected) host.dataset.theme = readerTheme();
    if (!host.isConnected || !notes.length) {
      marks.replaceChildren();
      layoutKey = '';
      return;
    }
    const indexes = readingIndexes();
    const placed = [];
    for (const note of notes) {
      if (!['精读', '速读', '跳读'].includes(note.mode)) continue;
      const hit = lookup(indexes, note.quote);
      const rect = hit?.rects.find(visible);
      if (!rect) continue;
      const x = Math.max(55, hit.left - 8);
      const y = Math.min(Math.max(53, rect.top - 1), innerHeight - 28);
      if (placed.some(mark => Math.abs(mark.x - x) < 58 && Math.abs(mark.y - y) < 24)) continue;
      placed.push({ note, x, y });
    }
    const nextKey = placed.map(({note,x,y}) => note.id + ':' + Math.round(x) + ':' + Math.round(y)).join('|');
    if (layoutKey === nextKey) return;
    layoutKey = nextKey;
    marks.replaceChildren(...placed.map(({note,x,y}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'anno-mode';
      button.dataset.mode = note.mode;
      button.textContent = note.mode;
      button.title = 'Anno ' + note.mode + '：' + note.quote;
      button.style.cssText = `left:${x}px;top:${y}px`;
      button.addEventListener('click', event => {
        const hit = lookup(readingIndexes(), note.quote);
        if (hit) flash(hit);
        void activate('reader-note', event, { key: bookInfo().key, noteId: note.id, actionId: crypto.randomUUID() });
      });
      return button;
    }));
  }

  function scheduleMarks() {
    if (!mountFrame) mountFrame = requestAnimationFrame(renderMarks);
  }

  document.addEventListener('anno:canvas-painted', scheduleMarks);
  addEventListener('scroll', scheduleMarks, { capture: true, passive: true });
  addEventListener('resize', scheduleMarks, { passive: true });
  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)
      ?.closest('.readerChapterContent, .renderTargetContainer'))) scheduleMarks();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const themeObserver = new MutationObserver(scheduleMarks);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class','style'] });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class','style'] });
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes['anno-book:' + markBook];
    if (readerPath() && area === 'local' && change && change.oldValue?.link !== change.newValue?.link) void loadMarks();
  });
  globalThis.navigation?.addEventListener('navigatesuccess', mount);
  mount();

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
      const indexes = readingIndexes();
      reply(message.quotes.filter(quote => typeof quote === 'string' && lookup(indexes, quote)));
    }
    if (message.type === 'locate' && typeof message.quote === 'string') {
      const hit = lookup(readingIndexes(), message.quote);
      if (hit) flash(hit);
      reply(Boolean(hit));
    }
    return false;
  });
})();
