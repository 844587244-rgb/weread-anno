const normalizeAnnoText = text => text.replace(/[\s\u200b\u00ad]/g, '');

function annoTextIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const element = node.parentElement;
      if (!normalizeAnnoText(node.data) || !element ||
          element.closest('script, style, button, [data-wr-ignore], .preRenderContainer, .renderTarget_pager, .readerFooter, .readerControls, [class*="needPay"], [class*="float"], [class*="CoverPage"], [class*="flyleaf"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      const style = getComputedStyle(element);
      return style.visibility === 'visible' && element.getClientRects().length
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const segments = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const offsets = [];
    for (let i = 0; i < node.length; i++) {
      if (normalizeAnnoText(node.data[i])) offsets.push(i);
    }
    if (offsets.length) {
      segments.push({ node, offsets, from: text.length, to: text.length + offsets.length });
      text += normalizeAnnoText(node.data);
    }
  }
  return { text, segments };
}

function findAnnoQuote(index, quote) {
  const needle = normalizeAnnoText(quote);
  if (!needle) return null;
  const start = index.text.indexOf(needle);
  if (start < 0 || index.text.indexOf(needle, start + 1) !== -1) return null;
  const end = start + needle.length - 1;
  const head = index.segments.find(segment => start >= segment.from && start < segment.to);
  const tail = index.segments.find(segment => end >= segment.from && end < segment.to);
  if (!head || !tail) return null;
  const range = document.createRange();
  range.setStart(head.node, head.offsets[start - head.from]);
  range.setEnd(tail.node, tail.offsets[end - tail.from] + 1);
  return { start, end, range };
}

function annoCanvasIndexes() {
  let frames = [];
  function receive(event) {
    try {
      const data = JSON.parse(event.detail);
      if (Array.isArray(data)) frames = data;
    } catch {
      // No reading canvas is visible yet.
    }
  }
  document.addEventListener('anno:canvas-response', receive);
  document.dispatchEvent(new Event('anno:canvas-request'));
  document.removeEventListener('anno:canvas-response', receive);
  return frames.flatMap(annoCanvasColumns);
}

function annoCanvasColumns(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const rows = [];
  const sorted = chunks.filter(p => typeof p?.text === 'string' && [p.x,p.y,p.w,p.h,p.baseline].every(Number.isFinite))
    .sort((a,b) => a.baseline - b.baseline || a.x - b.x);
  for (const piece of sorted) {
    const last = rows.at(-1);
    const row = last && Math.abs(last.baseline - piece.baseline) <= 3 ? last : { baseline: piece.baseline, parts: [] };
    if (row !== last) rows.push(row);
    row.parts.push(piece);
  }

  // Large gaps on a single line separate the two pages of the horizontal reader.
  const lines = [];
  for (const row of rows) {
    let line;
    for (const piece of row.parts.sort((a,b) => a.x - b.x)) {
      if (!line || piece.x - line.right >= 44) {
        line = { left: piece.x, right: piece.x + piece.w, baseline: row.baseline, parts: [] };
        lines.push(line);
      }
      line.right = Math.max(line.right, piece.x + piece.w);
      line.parts.push(piece);
    }
  }

  const columns = [];
  for (const line of lines.sort((a,b) => a.left - b.left || a.baseline - b.baseline)) {
    const last = columns.at(-1);
    if (!last || line.left > last.right + 40) {
      columns.push({ left: line.left, right: line.right, lines: [line] });
    } else {
      last.lines.push(line);
      last.right = Math.max(last.right, line.right);
    }
  }

  return columns.map(column => {
    const segments = [];
    let text = '';
    for (const line of column.lines.sort((a,b) => a.baseline - b.baseline)) {
      for (const piece of line.parts) {
        const value = normalizeAnnoText(piece.text);
        if (!value) continue;
        segments.push({ piece, from: text.length, to: text.length + value.length });
        text += value;
      }
    }
    return { text, segments, left: column.left };
  });
}

function findAnnoCanvasQuote(index, quote) {
  const needle = normalizeAnnoText(quote);
  if (!needle) return null;
  const start = index.text.indexOf(needle);
  if (start < 0 || index.text.indexOf(needle, start + 1) !== -1) return null;
  const end = start + needle.length;
  const rects = [];
  for (const { piece, from, to } of index.segments) {
    if (to <= start) continue;
    if (from >= end) break;
    const cell = piece.w / (to - from);
    const left = piece.x + Math.max(start - from, 0) * cell;
    const right = piece.x + (Math.min(end, to) - from) * cell;
    const previous = rects.at(-1);
    if (previous && Math.abs(previous.top - piece.y) < 5 && left - previous.right < 12) {
      previous.right = Math.max(previous.right, right);
      previous.width = previous.right - previous.left;
    } else {
      rects.push({ left, right, top: piece.y, bottom: piece.y + piece.h, width: right - left, height: piece.h });
    }
  }
  return rects.length ? { left: index.left, rects } : null;
}
