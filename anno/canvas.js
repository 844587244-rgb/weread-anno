(() => {
  // Read positions of text that WeRead paints on its own reader canvas.
  const methods = CanvasRenderingContext2D.prototype;
  const fillText = methods.fillText;
  const clearRect = methods.clearRect;
  const states = new WeakMap();
  const selector = '.renderTargetContainer canvas, .readerChapterContent canvas, .wr_canvasContainer canvas';
  const inReader = () => /^\/web\/reader\/[^/]+/.test(location.pathname);
  let scheduled = false;

  function stateFor(canvas) {
    let state = states.get(canvas);
    if (!state || state.width !== canvas.width || state.height !== canvas.height) {
      state = { width: canvas.width, height: canvas.height, pieces: new Map() };
      states.set(canvas, state);
    }
    return state;
  }

  function notify() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      document.dispatchEvent(new Event('anno:canvas-painted'));
    });
  }

  methods.fillText = function (text, x, y, maxWidth) {
    const result = Reflect.apply(fillText, this, arguments);
    const canvas = this.canvas;
    if (!inReader() || typeof text !== 'string' || !text.trim() || text.length > 400 ||
        !canvas.matches(selector) || canvas.closest('.preRenderContainer') || !this.globalAlpha) return result;
    try {
      const transform = this.getTransform();
      if (transform.b || transform.c || transform.a <= 0 || transform.d <= 0) return result;
      const metrics = this.measureText(text);
      const width = Math.min(metrics.width, maxWidth > 0 ? maxWidth : Infinity) * transform.a;
      const height = (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) * transform.d;
      if (width <= 0 || height <= 0) return result;
      const point = transform.transformPoint({ x, y });
      const align = this.textAlign;
      const indent = align === 'center' ? width / 2 : align === 'right' || align === 'end' ? width : 0;
      const left = point.x - indent;
      const top = point.y - metrics.fontBoundingBoxAscent * transform.d;
      if (left >= canvas.width || left + width <= 0 || top >= canvas.height || top + height <= 0) return result;
      const state = stateFor(canvas);
      const key = Math.round(left) + ':' + Math.round(point.y);
      if (state.pieces.size < 16000 || state.pieces.has(key)) {
        state.pieces.set(key, { text, x: left, y: top, w: width, h: height, baseline: point.y });
      }
      notify();
    } catch {
      // The reader's rendering remains authoritative even when a mark cannot be positioned.
    }
    return result;
  };

  methods.clearRect = function (x, y, w, h) {
    const result = Reflect.apply(clearRect, this, arguments);
    const state = states.get(this.canvas);
    if (!state?.pieces.size) return result;
    try {
      const matrix = this.getTransform();
      const a = matrix.transformPoint({ x, y });
      const b = matrix.transformPoint({ x: x + w, y: y + h });
      const left = Math.min(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const right = Math.max(a.x, b.x);
      const bottom = Math.max(a.y, b.y);
      if (left <= 1 && top <= 1 && right >= state.width - 1 && bottom >= state.height - 1) {
        state.pieces.clear();
      } else if (right > left && bottom > top) {
        for (const [key, item] of state.pieces) {
          const midX = item.x + item.w / 2;
          const midY = item.y + item.h / 2;
          if (midX >= left && midX < right && midY >= top && midY < bottom) state.pieces.delete(key);
        }
      }
      notify();
    } catch {
      // Clearing belongs to WeRead; the extension never changes its output.
    }
    return result;
  };

  document.addEventListener('anno:canvas-request', () => {
    if (!inReader()) return;
    const frames = [];
    for (const canvas of document.querySelectorAll(selector)) {
      const state = states.get(canvas);
      if (!state?.pieces.size || state.width !== canvas.width || state.height !== canvas.height) continue;
      const box = canvas.getBoundingClientRect();
      const css = getComputedStyle(canvas);
      if (!box.width || !box.height || css.visibility !== 'visible' || css.opacity === '0') continue;
      const sx = box.width / state.width;
      const sy = box.height / state.height;
      const clip = canvas.closest('.readerChapterContent, .renderTargetContainer')?.getBoundingClientRect() || box;
      const chunks = [...state.pieces.values()].map(piece => ({
        text: piece.text, x: box.left + piece.x * sx, y: box.top + piece.y * sy,
        w: piece.w * sx, h: piece.h * sy, baseline: box.top + piece.baseline * sy,
      })).filter(p => p.x + p.w > Math.max(0, clip.left) && p.x < Math.min(innerWidth, clip.right) &&
        p.y + p.h > Math.max(0, clip.top) && p.y < Math.min(innerHeight, clip.bottom));
      if (chunks.length) frames.push(chunks);
    }
    document.dispatchEvent(new CustomEvent('anno:canvas-response', { detail: JSON.stringify(frames) }));
  });
})();
