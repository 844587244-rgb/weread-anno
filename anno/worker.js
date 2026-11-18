(() => {
const BASE = 'http://127.0.0.1:18330/api';
const idPattern = /^[\w-]{1,80}$/;
const jobPattern = /^[a-f\d-]{36}$/;
const panelUrl = chrome.runtime.getURL('anno/panel.html');

async function request(path, data) {
  const response = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', 'X-Anno-Client': 'weread-extension' },
    method: data === undefined ? 'GET' : 'POST',
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(7000),
  }).catch(() => { throw new Error('连不上本机 Anno。打开 Anno 阅读器后重试。'); });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || 'Anno 暂时无法处理，请重试。');
  return body;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.anno !== true) return false;

  const reader = /^https:\/\/weread\.qq\.com\/web\/reader\/([^/?#]+)/.exec(sender.url || '');
  const validReader = reader && sender.tab?.id && sender.frameId === 0;
  if (message?.type === 'reader-marks' && validReader) {
    const key = 'anno-book:' + reader[1].split('k')[0];
    chrome.storage.local.get(key)
      .then(values => values[key]?.link)
      .then(link => typeof link === 'string' && idPattern.test(link)
        ? request('/weread/notes/' + link) : { notes: [] })
      .then(result => reply(result.notes), () => reply([]));
    return true;
  }

  if (['reader-explain', 'reader-open', 'reader-note'].includes(message?.type)) {
    if (!validReader) return false;
    const tabId = sender.tab.id;
    // Open synchronously while the original click retains user activation.
    const open = chrome.sidePanel.open({ tabId });
    const draft = message.type !== 'reader-open' && message.passage;
    const save = draft ? chrome.storage.session.set({ ['draft:' + tabId]: draft }) : Promise.resolve();
    Promise.all([open, save]).then(() => reply({ ok: true }), () => reply({
      error: '请先点 Chrome 工具栏里的「Anno 伴读」，再选中文字。',
    }));
    return true;
  }

  if (sender.url !== panelUrl) return false;
  let pending;
  if (message?.type === 'books') {
    pending = request('/books').then(books => books.map(({ id, title }) => ({ id, title })));
  } else if (message?.type === 'notes' && idPattern.test(message.bookId || '')) {
    pending = request('/weread/notes/' + message.bookId);
  } else if (message?.type === 'explain') {
    pending = request('/weread/explain', message.payload);
  } else if (message?.type === 'answer' && jobPattern.test(message.id || '')) {
    pending = request('/weread/explain/' + message.id);
  }
  if (!pending) return false;
  pending.then(data => reply({ data }), error => reply({ error: error.message }));
  return true;
});

})();
