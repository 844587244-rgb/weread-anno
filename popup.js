/**
 * 微信悦读 · 工具栏弹窗
 *
 * 两件事：
 *   1. 把当前版本号显示在标题旁（版本号唯一来源是 manifest.json）。
 *   2. 「给个好评」按浏览器选对应的商店页（360 系浏览器 → 360 商店，其余 → Edge 加载项商店）。
 * 链接全部是纯 <a target="_blank">，不申请任何新权限、不发任何请求。
 */
(function () {
  'use strict';

  const STORE_URLS = {
    edge: 'https://microsoftedge.microsoft.com/addons/detail/%E5%BE%AE%E4%BF%A1%E6%82%A6%E8%AF%BB/nkcckbonpafeclefhlhbencibkaabmgb',
    '360': 'https://ext.se.360.cn/#/extension-detail?id=fiidojfpifhgajiackccpgaaheiehcjd',
  };

  try {
    const version = chrome.runtime.getManifest().version;
    const el = document.getElementById('wre-pop-version');
    if (el && version) {
      el.textContent = 'v' + version;
    }
  } catch (e) {
    /* 版本号拿不到就不显示，不影响链接使用 */
  }

  document.getElementById('wre-pop-anno').addEventListener('click', async () => {
    const status = document.getElementById('wre-pop-anno-status');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const opened = tab?.id && await chrome.tabs.sendMessage(tab.id, { type: 'anno-open-page' });
      if (!opened) throw new Error('Anno 阅读页未打开');
      window.close();
    } catch {
      status.textContent = '请在微信读书页面点右下角「Anno 伴读」。';
      status.hidden = false;
    }
  });

  // 360 安全浏览器 / 极速浏览器的 UA 带 360SE / 360EE，指向 360 商店；其余走 Edge 商店
  try {
    const review = document.getElementById('wre-pop-review');
    const ua = navigator.userAgent || '';
    if (review && /360SE|360EE|QihooBrowser/i.test(ua)) {
      review.href = STORE_URLS['360'];
    }
  } catch (e) {
    /* 识别失败就保持默认的 Edge 商店链接 */
  }
})();
