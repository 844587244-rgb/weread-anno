import { randomUUID } from 'node:crypto';
import { explainWithCodex, readingContext, resolveCodex } from './companion_ai.mjs';

const SECTION = /^[a-z\d_-]{1,80}$/i;
const JOB = /^[a-f\d-]{36}$/;
const TEN_MINUTES = 600_000;
const clean = value => typeof value === 'string' ? value.trim() : '';
const normalize = value => value.replace(/[\s\u200b\u00ad]/g, '');
const clip = (value, length) => clean(value).slice(0, length);

function readingAnchor(paragraph, selected) {
  const quote = clean(selected);
  if (quote && normalize(paragraph).includes(normalize(quote))) {
    if (normalize(quote).length >= 12) return clip(quote, 62);
    const at = paragraph.indexOf(quote);
    if (at >= 0) {
      // Keep the selected words, widening the anchor on both sides when needed.
      const start = Math.max(0, at - 12);
      const end = Math.max(start + 24, at + quote.length);
      return paragraph.slice(start, end).trim();
    }
  }
  return clip(paragraph, 62);
}

export function registerWeReadExtension(app, { loadBook, generate = explainWithCodex }) {
  const jobs = new Map();
  let working = false;

  // Ordinary web pages cannot send the custom header across origins without CORS.
  // Treat requests with a browser origin as valid only from the extension.
  app.use('/api/weread', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    const allowed = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (!allowed || req.get('x-anno-client') !== 'weread-extension') {
      return res.status(403).json({ error: '请从 Chrome 的 Anno 伴读扩展打开。' });
    }
    next();
  });

  app.get('/api/weread/notes/:bookId', (req, res) => {
    const book = SECTION.test(req.params.bookId) ? loadBook(req.params.bookId) : null;
    if (!book) return res.status(404).json({ error: '书架里找不到这本书。' });

    const paragraphs = new Map(book.paragraphs.map(p => [p.id, p.text]));
    const highlights = new Map(book.annotations.filter(a => a.type === 'highlight').map(a => [a.id, a.text]));
    const notes = [];
    for (const annotation of book.annotations) {
      if (annotation.author !== 'AI 伴读' || annotation.type !== 'note' || annotation.reply_to) continue;
      const parsed = /^【(精读|速读|跳读|难点)】\s*([\s\S]+)$/.exec(annotation.text);
      const paragraph = paragraphs.get(annotation.paragraph_id);
      if (!parsed || !paragraph) continue;
      const selected = annotation.source_quote || highlights.get(annotation.highlight_id);
      const quote = readingAnchor(paragraph, selected);
      // Short headings and repeated snippets are ambiguous on another edition.
      if (normalize(quote).length < 12) continue;
      notes.push({ id: annotation.id, mode: parsed[1], text: clip(parsed[2], 2500), quote });
    }
    return res.json({ title: book.title, notes });
  });

  app.post('/api/weread/explain', (req, res) => {
    for (const [id, job] of jobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > TEN_MINUTES) jobs.delete(id);
    }
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json({ error: '请选择正文里的一小段。' });
    }
    const quote = clean(input.quote);
    const question = clean(input.question) || '请直接解释这段原句。';
    if (quote.length < 2 || quote.length > 1600 || question.length > 1500) {
      return res.status(400).json({ error: '请选择一小段原文，问题请控制在 1500 字内。' });
    }
    if (working) return res.status(429).json({ error: '正在回答另一条微信读书提问，请稍后重试。' });
    if (generate === explainWithCodex && !resolveCodex()) {
      return res.status(503).json({ error: '本机还没有连接 Codex。' });
    }

    const history = Array.isArray(input.history) ? input.history.slice(-6).map(entry => ({
      role: entry?.role === 'assistant' ? '先前AI解释（不是原书）' : '读者提问',
      text: clip(entry?.text, 2500),
    })).filter(entry => entry.text) : [];
    let context = {
      book: clip(input.title, 180) || '微信读书',
      chapter: clip(input.chapter, 180),
      selected_text: quote,
      passages: [{ text: clip(input.before, 480) + quote + clip(input.after, 480) }],
      history,
      question,
      reader_note: clip(input.readerNote, 1500),
    };
    const book = SECTION.test(clean(input.bookId)) ? loadBook(input.bookId) : null;
    if (book && normalize(quote).length >= 12) {
      const matches = book.paragraphs.filter(p => p.kind !== 'source_note' && normalize(p.text).includes(normalize(quote)));
      if (matches.length === 1) {
        context = {
          ...readingContext(book, { paragraph_id: matches[0].id, source_quote: quote, text: question }),
          history,
          reader_note: context.reader_note,
        };
      }
    }

    // The prompt treats the webpage, existing notes, and prior replies as reading material.
    const id = randomUUID();
    const job = { status: 'running' };
    jobs.set(id, job);
    working = true;
    res.status(202).json({ id });
    void Promise.resolve().then(() => generate(context)).then(answer => {
      Object.assign(job, { status: 'completed', answer });
    }).catch(error => {
      Object.assign(job, { status: 'failed', error: error.message || '解释失败，请重试。' });
    }).finally(() => {
      job.finishedAt = Date.now();
      working = false;
    });
  });

  app.get('/api/weread/explain/:id', (req, res) => {
    const job = JOB.test(req.params.id) && jobs.get(req.params.id);
    if (!job || (job.finishedAt && Date.now() - job.finishedAt > TEN_MINUTES)) {
      return res.status(404).json({ error: '这次解释已过期，可以重新提问。' });
    }
    const { status, answer, error } = job;
    return res.json({ status, answer, error });
  });
}
