import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerWeReadExtension } from './weread_extension.mjs';

const library = process.env.ANNO_LIBRARY;
const bookId = /^[a-z\d_-]{1,80}$/i;

function loadBook(id) {
  if (!library || !bookId.test(id)) return null;
  try {
    const book = JSON.parse(readFileSync(join(library, id + '.json'), 'utf8'));
    return book.id === id && typeof book.title === 'string' &&
      Array.isArray(book.paragraphs) && Array.isArray(book.annotations) ? book : null;
  } catch {
    return null;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.get('/api/books', (req, res) => {
  const origin = req.get('origin');
  if ((origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) ||
      req.get('x-anno-client') !== 'weread-extension') return res.sendStatus(403);
  let summaries = [];
  if (library) {
    try {
      summaries = readdirSync(library).flatMap(file => {
        if (!file.endsWith('.json')) return [];
        const book = loadBook(file.slice(0, -5));
        return book ? [{ id: book.id, title: book.title }] : [];
      });
    } catch {
      return res.status(503).json({ error: '找不到指定的 Anno 书架。' });
    }
  }
  return res.set('Cache-Control', 'no-store').json(summaries);
});
registerWeReadExtension(app, { loadBook });
app.listen(18330, '127.0.0.1', () => console.log('Anno 已在本机启动 (127.0.0.1:18330)'))
  .on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '18330 已在使用。已运行 Anno 时可直接加载扩展。' : error.message);
    process.exitCode = 1;
  });
