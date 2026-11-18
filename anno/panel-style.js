const annoPanelStyle = `
  .anno-page-panel {
    box-sizing:border-box; pointer-events:auto; position:absolute; z-index:2;
    width:min(344px,calc(100vw - 24px)); max-height:min(460px,calc(100dvh - 24px));
    display:flex; flex-direction:column; color:var(--ink); background:var(--surface);
    border:1px solid var(--border); border-radius:12px; font:14px/1.6 system-ui,sans-serif;
    box-shadow:0 8px 26px #0002; overflow:hidden;
  }
  .anno-page-panel[data-layout="rail"] {
    inset:66px 24px 26px auto; width:312px; max-height:none;
    box-shadow:none; background:color-mix(in srgb,var(--surface),transparent 24%);
    border-color:transparent; border-left-color:var(--border); border-radius:0;
  }
  .anno-page-panel * { box-sizing:border-box }
  .anno-page-panel header,.anno-page-panel footer {
    display:flex; gap:8px; align-items:center; padding:8px 12px; flex:none;
  }
  .anno-page-panel header { border-bottom:1px solid var(--border) }
  .anno-page-panel footer { border-top:1px solid var(--border); font-size:12px }
  .anno-page-panel header button {
    color:var(--muted); border-color:transparent; background:transparent;
  }
  .anno-page-panel header button[aria-pressed="true"] { color:var(--ink); background:var(--soft) }
  .anno-page-panel [data-close] { margin-left:auto; font-size:20px; line-height:1 }
  .anno-page-panel .anno-panel-scroll { min-height:0; flex:1; overflow:auto; overscroll-behavior:contain; padding:10px 12px }
  .anno-page-panel button,.anno-page-panel textarea,.anno-page-panel select {
    font:inherit; color:inherit; background:var(--surface); border:1px solid var(--border);
    border-radius:6px; padding:4px 8px;
  }
  .anno-page-panel button { cursor:pointer; font-size:12px }
  .anno-page-panel button:hover { border-color:var(--muted) }
  .anno-page-panel select { min-width:0; flex:1; color:var(--muted); color-scheme:inherit }
  .anno-page-panel a { color:var(--muted); text-decoration:none; white-space:nowrap }
  .anno-page-panel article {
    padding:11px; margin:0 0 10px; border:1px solid var(--border); border-radius:8px;
    background:var(--surface); overflow-wrap:anywhere;
  }
  .anno-page-panel article[data-mode="速读"] .meta { color:var(--skim) }
  .anno-page-panel article[data-mode="精读"] .meta { color:var(--close) }
  .anno-page-panel article[data-mode="难点"] .meta { color:var(--error) }
  .anno-page-panel article .meta,.anno-page-panel .hint { font-size:12px; color:var(--muted) }
  .anno-page-panel .anno-card-source {
    display:block; width:100%; margin:6px 0 8px; padding:5px 8px; border-color:transparent;
    border-left-color:var(--border); border-radius:2px; background:var(--soft);
    text-align:left; white-space:normal; overflow-wrap:anywhere; color:var(--muted);
  }
  .anno-page-panel .prose { white-space:pre-wrap; margin:6px 0 10px }
  .anno-page-panel .message { border-top:1px solid var(--border); padding-top:6px; margin-top:8px }
  .anno-page-panel .error { color:var(--error); font-size:12px }
  .anno-page-panel textarea { min-height:54px; width:100%; display:block; resize:vertical; margin:8px 0 5px }
`;
