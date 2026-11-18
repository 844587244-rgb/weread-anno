(() => {
const BASE = 'http://127.0.0.1:18330/api';
const idPattern = /^[\w-]{1,80}$/;
const jobPattern = /^[a-f\d-]{36}$/;

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
      .then(result => reply({ notes: result.notes }), error => reply({ error: error.message }));
    return true;
  }

  if (!validReader) return false;
  let pending;
  if (message?.type === 'books') {
    pending = request('/books').then(books => books.map(({ id, title }) => ({ id, title })));
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
