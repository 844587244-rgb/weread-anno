const $ = id => document.getElementById(id);
const make = (tag, text = '', className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let active = null;
let books = [];
let bookLoadFailed = false;
let view = 'notes';
let timers = new Set();
let refreshing = false;

async function local(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ anno: true, type, ...fields });
  if (!response || response.error) throw new Error(response?.error || 'Anno 暂时无法处理，请重试。');
  return response.data;
}

function tabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

function button(text, handler) {
  const control = make('button', text);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
}

function showView(next) {
  view = next;
  for (const name of ['notes', 'threads']) {
    $('show-' + name).setAttribute('aria-pressed', String(name === view));
    $(name + '-view').hidden = name !== view;
  }
}

function persist(book) {
  const threads = book.threads.map(({ sending, ...thread }) => thread);
  return chrome.storage.local.set({ ['anno-book:' + book.key]: { link: book.link, threads } });
}

function renderBooks() {
  const select = $('book-link');
  select.replaceChildren(new Option('选择一本书', ''));
  for (const book of books) select.add(new Option(book.title, book.id));
  if (active?.link && !books.some(book => book.id === active.link)) {
    select.add(new Option('已关联本地书籍', active.link));
  }
  select.value = active?.link || '';
}

async function loadBooks() {
  try {
    books = await local('books');
    bookLoadFailed = false;
    $('connection').hidden = true;
  } catch (error) {
    bookLoadFailed = true;
    $('connection').textContent = error.message;
    $('connection').hidden = false;
  }
  renderBooks();
}

async function locate(book, quote, control) {
  const found = active === book && await tabMessage(book.tabId, { type: 'locate', quote });
  control.textContent = found ? '已标出' : '当前页未找到';
  setTimeout(() => { control.textContent = '定位原句'; }, 2200);
}

function renderNotes(book, notes) {
  $('notes').replaceChildren(...notes.map(note => {
    const article = make('article');
    article.dataset.mode = note.mode;
    article.dataset.noteId = note.id;
    article.append(make('div', note.mode + ' · AI 旁注', 'meta'), make('blockquote', note.quote),
      make('p', note.text, 'prose'));
    const actions = make('div', '', 'actions');
    actions.append(
      button('定位原句', event => { void locate(book, note.quote, event.currentTarget); }),
      button('就这句提问', () => {
        const thread = addThread(book, { quote: note.quote, chapter: book.chapter });
        showView('threads');
        renderThreads();
        document.getElementById('ask-' + thread.id)?.focus();
        void persist(book);
      })
    );
    article.append(actions);
    return article;
  }));
}

async function updateNotes(book) {
  const link = book.link;
  if (!link) {
    $('notes-status').textContent = '关联后会显示本页匹配到的旁注。';
    $('notes').replaceChildren();
    return;
  }
  try {
    if (!book.notes) book.notes = (await local('notes', { bookId: link })).notes;
    const notes = book.notes;
    if (active !== book || link !== book.link) return;
    const quotes = [...new Set(notes.map(note => note.quote))];
    const visible = new Set(await tabMessage(book.tabId, { type: 'match-page', quotes }) || []);
    if (active !== book || link !== book.link) return;
    const matches = notes.filter(note => visible.has(note.quote));
    $('notes-status').textContent = matches.length ? '' : '本页还没有匹配的旁注。';
    const signature = matches.map(note => note.id).join(',');
    if (book.noteSignature !== signature) {
      renderNotes(book, matches);
      book.noteSignature = signature;
    }
  } catch (error) {
    if (active === book && link === book.link) $('notes-status').textContent = error.message;
  }
}

function addThread(book, passage) {
  let thread = book.threads.find(thread => thread.quote === passage.quote && thread.chapter === (passage.chapter || ''));
  if (thread) return thread;

  thread = {
    id: crypto.randomUUID(),
    quote: passage.quote,
    chapter: passage.chapter || '',
    before: passage.before || '',
    after: passage.after || '',
    readerNote: passage.readerNote || '',
    messages: [],
  };
  book.threads.unshift(thread);
  return thread;
}

function renderThreads() {
  const area = $('threads');
  const drafts = new Map([...area.querySelectorAll('textarea')].map(input => [input.id, input.value]));
  const focused = document.activeElement?.id;
  const book = active;
  $('empty').hidden = Boolean(book?.threads.length);
  area.replaceChildren();
  if (!book) return;

  for (const thread of book.threads) {
    const article = make('article');
    const actions = make('div', '', 'actions');
    actions.append(button('定位原句', event => { void locate(book, thread.quote, event.currentTarget); }));
    article.append(make('div', '微信读书 · 原句', 'meta'), make('blockquote', thread.quote), actions);
    if (thread.readerNote) article.append(make('div', '我的想法', 'meta'), make('p', thread.readerNote, 'prose'));
    for (const message of thread.messages) {
      const item = make('div', '', 'message');
      item.append(make('div', message.role === 'assistant' ? 'AI 伴读' : '我', 'meta'), make('p', message.text, 'prose'));
      article.append(item);
    }

    if (thread.job) {
      article.append(make('p', '正在解释…', 'hint'));
    } else {
      if (thread.error) {
        const error = make('p', thread.error, 'error');
        error.setAttribute('role', 'alert');
        article.append(error);
      }
      if (thread.pendingQuestion != null) {
        article.append(button('重试', () => { void ask(book, thread, thread.pendingQuestion); }));
      } else {
        const form = make('form');
        const input = make('textarea');
        input.id = 'ask-' + thread.id;
        input.maxLength = 1500;
        input.placeholder = thread.messages.length ? '继续追问这句话…' : '输入你想弄清的地方';
        input.setAttribute('aria-label', input.placeholder);
        input.value = drafts.get(input.id) || '';
        const submit = make('button', thread.messages.length ? '追问' : '解释');
        submit.type = 'submit';
        form.append(input, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          const question = input.value.trim();
          if (thread.messages.length && !question) {
            input.focus();
            return;
          }
          void ask(book, thread, question);
        });
        article.append(form);
      }
    }
    area.append(article);
  }
  if (focused?.startsWith('ask-')) $(focused)?.focus();
}

async function ask(book, thread, question) {
  if (thread.job || thread.sending) return;
  thread.sending = true;
  thread.pendingQuestion = question;
  thread.error = '';
  try {
    const { id } = await local('explain', { payload: {
      title: book.title, chapter: thread.chapter, quote: thread.quote,
      before: thread.before, after: thread.after, history: thread.messages,
      question, bookId: book.link, readerNote: thread.readerNote,
    } });
    thread.job = id;
    delete thread.sending;
    await persist(book);
    if (active === book) renderThreads();
    void poll(book, thread);
  } catch (error) {
    thread.error = error.message;
    delete thread.sending;
    await persist(book);
    if (active === book) renderThreads();
  } finally {
    delete thread.sending;
  }
}

async function poll(book, thread) {
  const id = thread.job;
  if (!id || timers.has(id)) return;
  timers.add(id);
  try {
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline) {
      const result = await local('answer', { id });
      if (result.status === 'failed') throw new Error(result.error || '解释失败，请重试。');
      if (result.status === 'completed') {
        if (thread.pendingQuestion) thread.messages.push({ role: 'user', text: thread.pendingQuestion });
        thread.messages.push({ role: 'assistant', text: result.answer });
        delete thread.pendingQuestion;
        delete thread.job;
        await persist(book);
        if (active === book) renderThreads();
        return;
      }
      await sleep(1600);
    }
    throw new Error('这次解释超时，可以重试。');
  } catch (error) {
    thread.error = error.message;
    delete thread.job;
    await persist(book);
    if (active === book) renderThreads();
  } finally {
    timers.delete(id);
  }
}

async function consumeDraft(book) {
  const key = 'draft:' + book.tabId;
  const passage = (await chrome.storage.session.get(key))[key];
  if (!passage || passage.key !== book.key || passage.actionId === book.lastAction || active !== book) return;
  book.lastAction = passage.actionId;
  await chrome.storage.session.remove(key);
  if (passage.noteId) {
    showView('notes');
    await updateNotes(book);
    const note = [...$('notes').children].find(card => card.dataset.noteId === passage.noteId);
    note?.scrollIntoView({ block: 'nearest' });
    note?.animate([{ outline: '2px solid #a8652e' }, { outline: '2px solid transparent' }], 1500);
    return;
  }
  const thread = addThread(book, passage);
  showView('threads');
  renderThreads();
  if (passage.start !== false && !thread.messages.length && thread.pendingQuestion == null) {
    void ask(book, thread, '');
  } else {
    await persist(book);
    $('ask-' + thread.id)?.focus();
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const info = tab?.id && await tabMessage(tab.id, { type: 'book' });
    if (!info?.key) {
      if (active && !info) $('notes').replaceChildren();
      active = null;
      $('reading').hidden = true;
      $('book').textContent = '打开微信读书的一本书';
      return;
    }

    document.documentElement.dataset.theme = info.theme === 'dark' ? 'dark' : 'light';
    if (active?.key !== info.key || active?.tabId !== tab.id) {
      const key = 'anno-book:' + info.key;
      const stored = (await chrome.storage.local.get(key))[key];
      active = { ...info, tabId: tab.id, link: stored?.link || '', threads: stored?.threads || [] };
      $('book').textContent = info.title;
      $('reading').hidden = false;
      $('notes').replaceChildren();
      renderThreads();
      showView(active.threads.some(thread => thread.job) ? 'threads' : 'notes');
      await loadBooks();
      for (const thread of active.threads) if (thread.job) void poll(active, thread);
    } else {
      active.chapter = info.chapter;
    }
    await consumeDraft(active);
    if (view === 'notes') await updateNotes(active);
  } finally {
    refreshing = false;
  }
}

$('show-notes').addEventListener('click', () => { showView('notes'); void refresh(); });
$('show-threads').addEventListener('click', () => showView('threads'));
$('book-link').addEventListener('focus', () => { if (bookLoadFailed) void loadBooks(); });
$('book-link').addEventListener('change', async event => {
  const book = active;
  if (!book) return;
  book.link = event.target.value;
  book.notes = null;
  book.noteSignature = undefined;
  $('notes').replaceChildren();
  await persist(book);
  void refresh();
});

chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'session') void refresh(); });
chrome.tabs.onActivated.addListener(() => { void refresh(); });
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 2200);
