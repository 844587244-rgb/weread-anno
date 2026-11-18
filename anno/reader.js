(() => {
  const readerPath = () => /^\/web\/reader\/[^/]+/.test(location.pathname);
  const marker = 'anno-weread-quote';
  const phrase = element => element?.textContent?.trim() || '';
  let selected = null;
  let markBook = '';
  let notes = [];
  let marksError = '';
  let indexes;
  let mountFrame = 0;
  let noteRequest = 0;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:999990;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme:light; --surface:#fff; --soft:#f4f4f4; --muted:#626267; --error:#9a4848;
      --border:#e2e2e2; --ink:#424242; --focus:#4377c5;
      --close:#8a593d; --skim:#476b58; --skip:#6b6b6b; --flash:#bd823930 }
    :host([data-theme="dark"]) { color-scheme:dark; --surface:#262626; --soft:#303030; --muted:#aaaab0;
      --error:#e1a299; --border:#454545; --ink:#dedede; --focus:#92b3f2;
      --close:#dfae87; --skim:#a9c7b1; --skip:#b5b5b5; --flash:#dea96638 }
    :is(#open,#explain,.anno-mode) { pointer-events:auto; position:absolute; border:1px solid var(--border); border-radius:8px;
      background:var(--surface); color:var(--ink); padding:8px 12px; cursor:pointer;
      font:500 13px/1.3 system-ui,sans-serif; white-space:nowrap }
    button:focus-visible { outline:2px solid var(--focus); outline-offset:3px }
    #open { right:16px; bottom:18px }
    [hidden] { display:none !important }
    #explain,.anno-mode { z-index:1 }
    .anno-mode { padding:2px 6px; border-radius:10px; color:var(--close);
      font-size:12px; box-shadow:none; transform:translateX(-100%) }
    .anno-mode[data-mode="速读"] { color:var(--skim) }
    .anno-mode[data-mode="难点"] { color:var(--error) }
    .anno-mode[data-mode="跳读"] { color:var(--skip) }
    .anno-source { position:absolute; background:var(--flash); border-bottom:2px dotted var(--close);
      border-radius:3px; pointer-events:none }
    .anno-connector { position:absolute; inset:0; width:100%; height:100%; overflow:hidden }
    .anno-connector path { stroke:var(--close); stroke-width:1.2; stroke-dasharray:3 5;
      fill:none; opacity:.75 }
  ` + annoPanelStyle;
  const open = document.createElement('button');
  open.id = 'open';
  open.textContent = 'Anno 伴读';
  const explain = document.createElement('button');
  explain.id = 'explain';
  explain.textContent = '✦ 解释';
  explain.setAttribute('aria-label', 'AI 解释所选原句');
  explain.hidden = true;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const connector = document.createElementNS(svgNamespace, 'svg');
  connector.classList.add('anno-connector');
  connector.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNamespace, 'path');
  connector.append(path);
  const sourceFocus = document.createElement('div');
  const flashes = document.createElement('div');
  const marks = document.createElement('div');
  marks.setAttribute('aria-label', 'Anno 阅读标记');
  shadow.append(style, sourceFocus, flashes, connector, marks, open, explain);
  const panel = createAnnoPagePanel(shadow, { bookInfo, locate, onLayout: setRail, onFocus: scheduleFocus, onVisibility: visible => { open.hidden = visible; } });

  function setRail(docked) {
    const root = document.documentElement;
    if (root.classList.contains('anno-page-rail') === docked) return;
    root.classList.toggle('anno-page-rail', docked);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      scheduleMarks();
    });
  }

  function mount() {
    if (readerPath()) {
      if (!host.isConnected) document.documentElement.append(host);
      if (markBook !== bookInfo().key) {
        panel.reset();
        void loadMarks();
      }
      scheduleMarks();
    } else {
      panel.reset();
      host.remove();
      marks.replaceChildren();
      markBook = '';
      layoutKey = '';
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
    const domHits = indexes.dom.map(index => {
      const hit = findAnnoQuote(index, quote);
      return hit && { ...hit, index, rects: [...hit.range.getClientRects()].filter(visible) };
    }).filter(Boolean)
      .filter(hit => hit.rects.length);
    if (domHits.length === 1) {
      const hit = domHits[0];
      const paragraph = hit.range.startContainer.parentElement?.closest('p,li,blockquote');
      const candidates = paragraph?.contains(hit.range.endContainer) ? [...paragraph.getClientRects()] : hit.rects;
      const first = hit.rects[0];
      return { ...hit, ...context(hit.index, hit.start, hit.end + 1),
        left: Math.min(first.left, ...candidates
        .filter(rect => rect.right > first.left && rect.left < first.right).map(rect => rect.left)) };
    }
    const hits = indexes.canvas.map(index => {
      const hit = findAnnoCanvasQuote(index, quote);
      return hit && { ...hit, ...context(index, hit.start, hit.end) };
    }).filter(hit => hit?.rects.some(visible));
    const unique = new Map(hits.map(hit => {
      const rect = hit.rects[0];
      return [Math.round(rect.left / 4) + ':' + Math.round(rect.top / 4), hit];
    }));
    return unique.size === 1 ? unique.values().next().value : null;
  }

  function readingIndexes() {
    return { dom: readerIndex(), canvas: annoCanvasIndexes() };
  }

  function context(index, start, end) {
    return index ? {
      before: index.text.slice(Math.max(0, start - 320), start),
      after: index.text.slice(end, end + 320),
    } : {};
  }

  function locate(quote, emphasize = false) {
    const hit = lookup(indexes || readingIndexes(), quote);
    if (hit && emphasize) flash(hit);
    return hit;
  }

  function highlightRect(rect) {
    const overlay = document.createElement('div');
    overlay.className = 'anno-source';
    overlay.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    return overlay;
  }

  function flash(hit) {
    if (hit.range && globalThis.CSS?.highlights && globalThis.Highlight) {
      const highlight = new Highlight(hit.range);
      CSS.highlights.set(marker, highlight);
      setTimeout(() => { if (CSS.highlights.get(marker) === highlight) CSS.highlights.delete(marker); }, 2000);
    }
    const overlays = hit.rects.filter(visible).map(highlightRect);
    flashes.replaceChildren(...overlays);
    setTimeout(() => overlays.forEach(overlay => overlay.remove()), 1600);
  }

  let focusFrame = 0;
  function scheduleFocus() {
    if (!focusFrame) focusFrame = requestAnimationFrame(drawFocus);
  }

  function drawFocus() {
    focusFrame = 0;
    const focus = panel.focus();
    const rects = (focus && locate(focus.quote)?.rects || []).filter(visible);
    sourceFocus.replaceChildren(...rects.map(highlightRect));
    path.removeAttribute('d');
    if (!rects.length) return;
    const source = rects[0];
    const card = focus.rect;
    const fromX = source.right + 3;
    const fromY = source.bottom;
    const toX = card.left - 1;
    const toY = Math.min(card.bottom - 8, focus.top + 18);
    if (fromX + 5 < toX) {
      const elbow = toX - Math.min(18, (toX - fromX) / 2);
      path.setAttribute('d', `M ${fromX} ${fromY} H ${elbow} L ${toX} ${toY}`);
    } else if (focus.near) {
      const x = Math.max(card.left + 12, Math.min(card.right - 12, source.left + source.width / 2));
      const cardBelow = card.top >= source.bottom;
      const cardAbove = card.bottom <= source.top;
      if (cardBelow || cardAbove) {
        path.setAttribute('d', `M ${x} ${cardBelow ? source.bottom : source.top} V ${cardBelow ? card.top : card.bottom}`);
      }
    }
  }

  async function loadMarks() {
    const key = bookInfo().key;
    const request = ++noteRequest;
    const loadKeyChanged = key !== markBook;
    markBook = key;
    notes = [];
    marksError = '';
    if (loadKeyChanged) scheduleMarks();
    const result = await chrome.runtime.sendMessage({ anno: true, type: 'reader-marks' })
      .catch(() => ({ error: '扩展已更新，请刷新阅读页。' }));
    if (request !== noteRequest || !readerPath() || key !== bookInfo().key) return;
    notes = Array.isArray(result?.notes) ? result.notes : [];
    marksError = result?.error || '';
    scheduleMarks();
  }

  let layoutKey = '';
  function renderMarks() {
    mountFrame = 0;
    if (host.isConnected) host.dataset.theme = readerTheme();
    if (!host.isConnected) {
      indexes = null;
      return;
    }
    // Read the current render after pagination or a change to the companion width.
    indexes = notes.length || panel.isOpen() ? readingIndexes() : null;
    panel.position();
    const limit = panel.railRight();
    const matches = [];
    const placed = [];
    for (const note of notes) {
      const hit = lookup(indexes, note.quote);
      const rect = hit?.rects.find(item => visible(item) && item.left < limit);
      if (!rect) continue;
      matches.push({ note, rect });
      const mode = note.mode;
      if (!['精读', '速读', '跳读', '难点'].includes(mode)) continue;
      const x = Math.max(55, hit.left - 8);
      const y = Math.min(Math.max(53, rect.top - 1), innerHeight - 28);
      if (placed.some(mark => Math.abs(mark.x - x) < 58 && Math.abs(mark.y - y) < 24)) continue;
      placed.push({ note, x, y });
    }
    matches.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    panel.setMatches(matches, marksError);
    scheduleFocus();
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
        if (!event.isTrusted) return;
        const hit = locate(note.quote);
        void panel.openNote(note, hit?.rects[0], false);
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

  function readSelection() {
    const selection = getSelection();
    const root = contentRoot(selection?.anchorNode);
    const quote = selection?.toString().trim() || '';
    if (root && contentRoot(selection.focusNode) === root && quote) {
      const range = selection.getRangeAt(0);
      const rect = [...range.getClientRects()].filter(visible).at(-1);
      const neighborhood = range.startContainer.parentElement?.closest('p,li,blockquote');
      const index = annoTextIndex(neighborhood?.contains(range.endContainer) ? neighborhood : root);
      const match = findAnnoQuote(index, quote);
      return { quote, rect, ...(match ? context(index, match.start, match.end + 1) : {}) };
    }
    const masks = [...document.querySelectorAll('.readerChapterContent .wr_selection')]
      .flatMap(element => [...element.getClientRects()]).filter(visible);
    if (!masks.length) return null;
    const found = findAnnoCanvasSelection(annoCanvasIndexes(), masks);
    if (!found) return null;
    return { quote: found.quote, rect: masks.at(-1), ...context(found.index, found.start, found.end) };
  }

  function updateSelection() {
    if (!host.isConnected) return;
    const current = readSelection();
    const rect = current?.rect;
    if (!rect || current.quote.length < 2 || current.quote.length > 1600) {
      selected = null;
      explain.hidden = true;
      return;
    }
    selected = { ...bookInfo(), ...current };
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
  open.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (panel.isOpen()) panel.close();
    else void panel.open().then(scheduleMarks);
  });
  explain.addEventListener('click', event => {
    if (!event.isTrusted || !selected) return;
    const passage = selected;
    explain.hidden = true;
    void panel.open({ passage, rect: passage.rect, start: true }).then(scheduleMarks);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.isOpen()) panel.close();
  });

  globalThis.annoOpenWeReadNote = function (event, note) {
    if (!readerPath() || !event.isTrusted || !note?.quote) return;
    const quote = note.quote.trim();
    if (quote.length < 2 || quote.length > 1600) return;
    const hit = locate(quote);
    void panel.open({ rect: hit?.rects[0], passage: {
      ...bookInfo(), quote, chapter: note.chapterName || '',
      before: hit?.before, after: hit?.after,
      readerNote: (note.readerNote || '').slice(0, 1500),
    } }).then(scheduleMarks);
  };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html') &&
        readerPath() && message.type === 'anno-open-page') {
      void panel.open().then(scheduleMarks);
      reply(true);
    }
    return false;
  });
})();
