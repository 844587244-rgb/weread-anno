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
