function createAnnoPagePanel(shadow, { bookInfo, locate, onLayout, onFocus, onVisibility }) {
  const panel = document.createElement('aside');
  panel.className = 'anno-page-panel';
  panel.setAttribute('aria-label', 'Anno 伴读');
  panel.hidden = true;
  panel.innerHTML = `
    <header>
      <button type="button" data-view="notes" aria-pressed="true">本页旁注</button>
      <button type="button" data-view="threads" aria-pressed="false">我的追问</button>
      <button type="button" data-close aria-label="收起伴读">×</button>
    </header>
    <div class="anno-panel-scroll">
      <section data-notes>
        <p data-hint class="hint" role="status"></p>
        <div data-cards></div>
      </section>
      <section data-threads hidden></section>
    </div>
    <footer>
      <select aria-label="关联本地书籍"><option value="">关联本地书籍</option></select>
      <a href="http://127.0.0.1:18330/" target="_blank" rel="noreferrer">本地书架 ↗</a>
    </footer>`;
  shadow.append(panel);

  const get = selector => panel.querySelector(selector);
  const scroll = get('.anno-panel-scroll');
  const select = get('select');
  const cards = get('[data-cards]');
  const threads = get('[data-threads]');
  const drafts = new Map();
  const polling = new Set();
  let book;
  let bookLoad;
  let matches = [];
  let view = 'notes';
  let activeNote = '';
  let activeThread = '';
  let focusTarget = null;
  let sourceAnchor = null;
  let signature = '';
  let connectionError = '';
  let matchesError = '';
  let books = [];

  function element(tag, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, handler) {
    const control = element('button', text);
    control.type = 'button';
    control.addEventListener('click', event => {
      if (event.isTrusted) handler(event);
    });
    return control;
  }

  async function local(type, fields = {}) {
    const response = await chrome.runtime.sendMessage({ anno: true, type, ...fields });
    if (!response || response.error) throw new Error(response?.error || 'Anno 暂时无法处理，请重试。');
    return response.data;
  }

  function save(owner) {
    const stored = { link: owner.link, threads: owner.threads.map(({ sending, ...thread }) => thread) };
    return chrome.storage.local.set({ ['anno-book:' + owner.key]: stored });
  }

  function showView(next) {
    view = next;
    get('[data-notes]').hidden = view !== 'notes';
    threads.hidden = view !== 'threads';
    for (const control of panel.querySelectorAll('[data-view]')) {
      control.setAttribute('aria-pressed', String(control.dataset.view === view));
    }
  }

  function setFocus(target) {
    focusTarget = target;
    onFocus();
  }

  function renderBooks() {
    select.replaceChildren(new Option('关联本地书籍', ''));
    for (const item of books) select.add(new Option(item.title, item.id));
    if (book?.link && !books.some(item => item.id === book.link)) {
      select.add(new Option('已关联本地书籍', book.link));
    }
    select.value = book?.link || '';
  }

  async function loadBooks() {
    try {
      books = await local('books');
      connectionError = '';
    } catch (error) {
      connectionError = error.message;
    }
    renderBooks();
    renderHint();
  }

  function ensureBook() {
    const info = bookInfo();
    if (book?.key === info.key) {
      Object.assign(book, info);
      return Promise.resolve(book);
    }
    if (bookLoad?.key === info.key) return bookLoad.promise;
    const key = 'anno-book:' + info.key;
    const promise = chrome.storage.local.get(key).then(values => {
      if (bookInfo().key !== info.key) return null;
      const stored = values[key];
      book = { ...info, link: stored?.link || '', threads: stored?.threads || [] };
      renderBooks();
      for (const thread of book.threads) if (thread.job) void poll(book, thread);
      if (!books.length) void loadBooks();
      return book;
    }).finally(() => {
      if (bookLoad?.promise === promise) bookLoad = null;
    });
    bookLoad = { key: info.key, promise };
    return promise;
  }

  function getThread(owner, passage) {
    const chapter = passage.chapter || '';
    let thread = owner.threads.find(item => item.quote === passage.quote && item.chapter === chapter);
    if (!thread) {
      thread = {
        id: crypto.randomUUID(), quote: passage.quote, chapter,
        before: passage.before || '', after: passage.after || '',
        readerNote: passage.readerNote || '', messages: [],
      };
      owner.threads.unshift(thread);
    } else {
      for (const field of ['before', 'after', 'readerNote']) {
        if (passage[field]) thread[field] = passage[field];
      }
    }
    return thread;
  }

  function renderHint() {
    const hint = get('[data-hint]');
    hint.textContent = matchesError || (matches.length ? '' : connectionError ||
      (book?.link ? '本页暂无旁注。' : '关联本地书籍后，会在这里显示旁注。'));
    hint.hidden = !hint.textContent;
  }

  function paint(focusDraft = false) {
    const focused = shadow.activeElement?.dataset.draft;
    const focusQuote = focusTarget?.quote;
    renderHint();
    cards.replaceChildren();
    threads.replaceChildren();

    if (view === 'notes') {
      const shown = panel.dataset.layout === 'near' && activeNote
        ? matches.filter(item => item.note.id === activeNote)
        : matches;
      for (const { note } of shown) {
        const article = makeCard(note.quote, note.mode + ' · AI 旁注');
        article.dataset.noteId = note.id;
        article.dataset.mode = note.mode;
        article.append(element('p', note.text, 'prose'));
        const thread = book?.threads.find(item => item.id === activeThread);
        if (activeNote === note.id && thread) {
          appendConversation(article, book, thread);
        } else {
          article.append(button('就这句追问', () => { void openNote(note, null, true); }));
        }
        cards.append(article);
      }
    } else if (book) {
      const items = book.threads.slice().sort((left, right) =>
        Number(right.id === activeThread) - Number(left.id === activeThread));
      if (!items.length) threads.append(element('p', '选中原文后，点「解释」。', 'hint'));
      for (const thread of items) {
        const article = makeCard(thread.quote, '微信读书 · 原句');
        article.dataset.threadId = thread.id;
        appendConversation(article, book, thread);
        threads.append(article);
      }
    }

    alignCards();
    const input = [...panel.querySelectorAll('textarea')].find(field =>
      field.dataset.draft === (focusDraft ? activeThread : focused));
    input?.focus({ preventScroll: true });
    const previous = [...panel.querySelectorAll('.anno-card-source')].find(node => node.textContent === focusQuote);
    if (!input) setFocus(previous ? { quote: focusQuote, article: previous.parentElement } : null);
  }

  function makeCard(quote, label) {
    const article = element('article');
    const target = { quote, article };
    const source = button(quote, () => {
      setFocus(target);
      if (!locate(quote, true)) source.title = '当前页未找到这句';
    });
    source.className = 'anno-card-source';
    source.title = '定位原句';
    article.append(element('div', label, 'meta'), source);
    article.addEventListener('pointerenter', () => setFocus(target));
    article.addEventListener('pointerleave', () => {
      if (focusTarget === target && !article.contains(shadow.activeElement)) setFocus(null);
    });
    article.addEventListener('focusin', () => setFocus(target));
    return article;
  }

  function appendConversation(article, owner, thread) {
    if (thread.readerNote) {
      article.append(element('div', '我的想法', 'meta'), element('p', thread.readerNote, 'prose'));
    }
    for (const message of thread.messages) {
      const item = element('div', '', 'message');
      item.append(element('div', message.role === 'assistant' ? 'AI 伴读' : '我', 'meta'),
        element('p', message.text, 'prose'));
      article.append(item);
    }
    if (thread.job || thread.sending) {
      article.append(element('p', '正在解释…', 'hint'));
      return;
    }
    if (thread.error) article.append(element('p', thread.error, 'error'));
    if (thread.pendingQuestion != null) {
      article.append(button('重试', () => { void ask(owner, thread, thread.pendingQuestion); }));
      return;
    }
    const form = element('form');
    const input = element('textarea');
    input.dataset.draft = thread.id;
    input.maxLength = 1500;
    input.placeholder = '问问这句话…';
    input.setAttribute('aria-label', '追问这句话');
    input.value = drafts.get(thread.id) || '';
    input.addEventListener('input', () => drafts.set(thread.id, input.value));
    const submit = element('button', thread.messages.length ? '追问' : '解释');
    submit.type = 'submit';
    form.append(input, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!event.isTrusted) return;
      const question = input.value.trim();
      if (thread.messages.length && !question) return;
      drafts.delete(thread.id);
      void ask(owner, thread, question);
    });
    article.append(form);
  }

  async function ask(owner, thread, question) {
    if (thread.job || thread.sending) return;
    thread.sending = true;
    thread.pendingQuestion = question;
    thread.error = '';
    if (book === owner) paint();
    try {
      const { id } = await local('explain', { payload: {
        title: owner.title, chapter: thread.chapter, quote: thread.quote,
        before: thread.before, after: thread.after, history: thread.messages,
        question, bookId: owner.link, readerNote: thread.readerNote,
      } });
      thread.job = id;
    } catch (error) {
      thread.error = error.message;
    } finally {
      delete thread.sending;
      await save(owner);
      if (book === owner) paint();
    }
    if (thread.job) void poll(owner, thread);
  }

  async function poll(owner, thread) {
    const id = thread.job;
    if (!id || polling.has(id)) return;
    polling.add(id);
    try {
      const deadline = Date.now() + 200_000;
      while (Date.now() < deadline) {
        const result = await local('answer', { id });
        if (result.status === 'failed') throw new Error(result.error || '解释失败，请重试。');
        if (result.status === 'completed') {
          if (thread.pendingQuestion) thread.messages.push({ role: 'user', text: thread.pendingQuestion });
          thread.messages.push({ role: 'assistant', text: result.answer });
          delete thread.pendingQuestion;
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1600));
      }
      throw new Error('这次解释超时，可以重试。');
    } catch (error) {
      thread.error = error.message;
    } finally {
      polling.delete(id);
      delete thread.job;
      await save(owner);
      if (book === owner) paint();
    }
  }

  function alignCards() {
    if (panel.hidden || view !== 'notes' || panel.dataset.layout !== 'rail') return;
    const offset = scroll.getBoundingClientRect().top;
    let end = 0;
    for (const article of cards.children) {
      const match = matches.find(item => item.note.id === article.dataset.noteId);
      if (!match) continue;
      const gap = Math.round(Math.max(0, Math.min(match.rect.top - offset - end, 100)));
      article.style.marginTop = gap + 'px';
      end += gap + article.offsetHeight + 10;
    }
  }

  function position() {
    if (panel.hidden) return;
    const layout = innerWidth >= 1240 && innerHeight >= 480 ? 'rail' : 'near';
    if (panel.dataset.layout !== layout) {
      panel.dataset.layout = layout;
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      onLayout(layout === 'rail');
      paint();
    }
    if (layout === 'near') {
      const width = Math.min(344, innerWidth - 24);
      const anchor = focusTarget?.article.isConnected ? locate(focusTarget.quote)?.rects[0] : null;
      const note = matches.find(item => item.note.id === activeNote);
      const thread = book?.threads.find(item => item.id === activeThread);
      const rect = view === 'notes'
        ? note?.rect || anchor
        : (thread && locate(thread.quote)?.rects[0]) || sourceAnchor;
      const height = panel.offsetHeight;
      const right = innerWidth - width - 12;
      const left = rect && rect.right + 12 <= right
        ? rect.right + 12
        : rect && rect.left >= width + 24 ? rect.left - width - 12 : right;
      const top = rect
        ? (rect.bottom + height + 24 <= innerHeight ? rect.bottom + 12 : rect.top - height - 12)
        : innerHeight - height - 60;
      panel.style.left = Math.max(12, left) + 'px';
      panel.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + 'px';
    }
    alignCards();
  }

  async function open({ note, passage, rect, start = false } = {}) {
    const owner = await ensureBook();
    if (!owner) return;
    const wasHidden = panel.hidden;
    panel.hidden = false;
    onVisibility(true);
    activeNote = note?.id || '';
    activeThread = '';
    sourceAnchor = rect || null;
    const thread = passage ? getThread(owner, passage) : null;
    if (thread) activeThread = thread.id;
    showView(note || !thread ? 'notes' : 'threads');
    setFocus(null);
    if (wasHidden) position();
    paint(Boolean(thread && !start));
    position();
    if (activeNote) revealNote(activeNote);
    else {
      scroll.scrollTop = 0;
      const card = threads.firstElementChild;
      if (thread && card?.dataset.threadId === thread.id) setFocus({ quote: thread.quote, article: card });
    }
    if (!thread) return;
    if (start && !thread.messages.length && thread.pendingQuestion == null) void ask(owner, thread, '');
    else await save(owner);
  }

  function revealNote(id) {
    const card = [...cards.children].find(item => item.dataset.noteId === id);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const match = matches.find(item => item.note.id === id);
    if (match) setFocus({ quote: match.note.quote, article: card });
  }

  async function openNote(note, rect, compose) {
    const info = bookInfo();
    const context = locate(note.quote);
    await open({
      note, rect,
      passage: compose ? { ...info, quote: note.quote, before: context?.before, after: context?.after } : null,
    });
  }

  function setMatches(items, error = '') {
    matches = items;
    matchesError = error;
    if (panel.hidden) return;
    const next = items.map(item => item.note.id).join('|');
    if (next !== signature) {
      signature = next;
      if (activeNote && !items.some(item => item.note.id === activeNote)) {
        activeNote = '';
        if (activeThread) showView('threads');
      }
      paint();
    } else {
      renderHint();
    }
    position();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    onVisibility(false);
    panel.removeAttribute('data-layout');
    signature = '';
    activeNote = '';
    activeThread = '';
    focusTarget = null;
    sourceAnchor = null;
    onLayout(false);
    onFocus();
  }

  for (const control of panel.querySelectorAll('[data-view]')) {
    control.addEventListener('click', event => {
      if (!event.isTrusted) return;
      activeNote = '';
      sourceAnchor = null;
      setFocus(null);
      showView(control.dataset.view);
      scroll.scrollTop = 0;
      paint();
      position();
    });
  }
  get('[data-close]').addEventListener('click', event => { if (event.isTrusted) close(); });
  select.addEventListener('focus', () => { if (connectionError) void loadBooks(); });
  select.addEventListener('change', event => {
    if (!book || !event.isTrusted) return;
    book.link = select.value;
    void save(book);
  });
  panel.addEventListener('keydown', event => {
    if (event.target.matches('textarea,select') && event.key !== 'Escape') event.stopPropagation();
  });
  scroll.addEventListener('scroll', onFocus, { passive: true });

  return { open, openNote, close, setMatches, position,
    isOpen: () => !panel.hidden,
    railRight: () => panel.dataset.layout === 'rail' ? panel.getBoundingClientRect().left : innerWidth,
    focus: () => {
      if (panel.hidden || !focusTarget?.article.isConnected) return null;
      const rect = focusTarget.article.getBoundingClientRect();
      const body = scroll.getBoundingClientRect();
      if (rect.bottom <= body.top || rect.top >= body.bottom) return null;
      return { quote: focusTarget.quote, rect, top: Math.max(rect.top, body.top), near: panel.dataset.layout === 'near' };
    },
    reset: () => {
      close();
      book = null;
      matches = [];
      matchesError = '';
      drafts.clear();
    },
  };
}
