/**
 * 反代改写纯函数（规格 §2.2；零依赖，便于独立验证）。
 * 域名映射（动态，不枚举猜域名——真机登录后跳转链会经过任意校内域）：
 *  - cvs.seu.edu.cn       → 反代根
 *  - auth.seu.edu.cn 等已知认证域 → /__cas 前缀
 *  - 其余任意 *.seu.edu.cn → /__h/<host> 前缀
 *  - 非 *.seu.edu.cn      → null（禁止透传跳出反代，防 SSRF）
 */

export const PORT = 3778;
export const CVS_HOST = "cvs.seu.edu.cn";
/** 已知认证中心域（登录页资源走 /__cas 固定前缀） */
export const CAS_HOSTS = ["auth.seu.edu.cn"];

/** host → 反代路径前缀；非校内域返回 null（禁止） */
export function prefixForHost(host: string): string | null {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h)) return null; // 防 userinfo/怪字符 SSRF
  if (h === CVS_HOST) return "";
  if (CAS_HOSTS.includes(h)) return "/__cas";
  if (h === "seu.edu.cn" || h.endsWith(".seu.edu.cn")) return `/__h/${h}`;
  return null;
}

/** 逐属性拆分（保留顺序），重拼时去掉 Domain 与 Secure（让 Cookie 落 localhost） */
export function rewriteSetCookie(value: string): string {
  const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => {
    const name = p.split("=")[0].trim().toLowerCase();
    return name !== "domain" && name !== "secure";
  });
  return kept.join("; ");
}

/** Location 改写：校内域名映射回反代；已指向反代的 localhost 地址原样放行（官方 return_uri 回跳）；外域 null（不透传） */
export function rewriteLocation(location: string): string | null {
  if (/^https?:\/\//i.test(location)) {
    const m = location.match(/^https?:\/\/([^/:?#]+)(:\d+)?([/?#].*)?$/i);
    if (!m) return null;
    const host = m[1].toLowerCase();
    const rest = m[3] ?? "/";
    // 官方登录完成后按 return_uri 跳回 localhost:3778 —— 已是反代地址，原样放行
    if (host === "localhost" || host === "127.0.0.1") {
      return `http://localhost:${PORT}${rest}`;
    }
    const prefix = prefixForHost(host);
    if (prefix === null) return null;
    return `http://localhost:${PORT}${prefix}${rest}`;
  }
  // 协议相对 //host/path
  if (location.startsWith("//")) {
    return rewriteLocation("https:" + location);
  }
  // 站内相对路径：原样（调用方按当前前缀补齐）
  if (location.startsWith("/")) return location;
  return null;
}

/** 内嵌导航收敛脚本：官方页的课程卡片用 target="_blank" / window.open 打开新页，
 *  在 iframe 里会变成弹出新标签页。此脚本注入到 HTML 响应最前面（官方脚本执行前），
 *  把一切「打开新窗口」的导航收敛为「当前 iframe 内跳转」：
 *   1. 覆盖 window.open → 改为 location.href；
 *   2. 捕获阶段拦截 a/area 的非 _self 跳转（SPA 动态渲染的卡片也能拦到）；
 *   3. MutationObserver 持续把新加节点的 target="_blank" 归一为 _self，并去掉 <base target>。
 *  纯函数、零依赖，便于独立验证（scripts/verify-revproxy-fn.mjs）。 */
export const FRAME_NAV_SCRIPT = `<script data-ifcope-frame-nav>(function(){
  var nav = function(u){ try{ if(u && String(u).slice(0,11) !== 'javascript:') window.location.href = u; }catch(e){} };
  try{ window.open = function(u){ nav(u); return null; }; }catch(e){}
  document.addEventListener('click', function(e){
    try{
      var a = e.target && e.target.closest ? e.target.closest('a[href],area[href]') : null;
      if(!a) return;
      var t = (a.getAttribute('target') || '').toLowerCase();
      if(t && t !== '_self'){
        if(e.cancelable) e.preventDefault();
        e.stopPropagation();
        nav(a.getAttribute('href'));
      }
    }catch(err){}
  }, true);
  var fix = function(root){
    try{
      if(!root || !root.querySelectorAll) return;
      var bs = root.querySelectorAll('base');
      for(var i = 0; i < bs.length; i++) bs[i].removeAttribute('target');
      var as = root.querySelectorAll('a[target],area[target]');
      for(var j = 0; j < as.length; j++){
        var tv = (as[j].getAttribute('target') || '').toLowerCase();
        if(tv && tv !== '_self') as[j].setAttribute('target', '_self');
      }
    }catch(err){}
  };
  var start = function(){
    fix(document);
    try{
      new MutationObserver(function(ms){
        for(var k = 0; k < ms.length; k++){
          var ns = ms[k].addedNodes;
          for(var n = 0; n < ns.length; n++) if(ns[n].nodeType === 1) fix(ns[n]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }catch(e){}
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
/* —— 向宿主页（3777）上报：当前 URL/标题 + 登录态 ——
 * iframe 是 3778 同源，fetch /__whoami 必带 Cookie（宿主跨源 fetch 不可靠）；
 * SPA 换路由不触发 load，同时鉤 history + 1s 轮询兑底。 */
(function(){
  try{ if(window.parent === window) return; }catch(e){ return; }
  var TOP = 'http://localhost:3777';
  var send = function(m){ try{ window.parent.postMessage(m, TOP); }catch(e){} };
  var lastUrl = '';
  var report = function(){
    try{
      var u = String(window.location.href);
      if(u === lastUrl) return;
      lastUrl = u;
      send({ source: 'ifcope-frame', type: 'nav', url: u, title: String(document.title || '') });
    }catch(e){}
  };
  var probeAuth = function(){
    try{
      fetch('/__whoami', { credentials: 'same-origin' })
        .then(function(r){ return r.json(); })
        .then(function(d){ send({ source: 'ifcope-frame', type: 'auth', loggedIn: !!(d && d.loggedIn) }); })
        .catch(function(){});
    }catch(e){}  };
  try{
    ['pushState', 'replaceState'].forEach(function(k){
      var orig = history[k];
      history[k] = function(){ var r = orig.apply(this, arguments); setTimeout(report, 0); return r; };
    });
  }catch(e){}
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  /* 宿主按钮指令：iframe 跨端口，宿主无法直接碰它的 history/location，
   * 由注入脚本代执行（主页 = 回平台首页路由） */
  window.addEventListener('message', function(e){
    try{
      if(e.origin !== TOP) return;
      var d = e.data;
      if(!d || d.source !== 'ifcope-host') return;
      if(d.cmd === 'home') window.location.href = '/jy-application-resourcemanage-ui/';
    }catch(err){}
  });
  window.addEventListener('load', function(){ report(); probeAuth(); });
  setInterval(report, 1000);
  setInterval(probeAuth, 5000);
  probeAuth();
})();</script>`;

/** 往 HTML 里注入导航收敛脚本（插到 <head> 最前，确保先于官方脚本执行；无 head 则前置） */
export function injectFrameNavScript(html: string): string {
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index! + headOpen[0].length;
    return html.slice(0, at) + FRAME_NAV_SCRIPT + html.slice(at);
  }
  return FRAME_NAV_SCRIPT + html;
}

/** 响应体改写：把 HTML/JS/JSON 里写死的校内绝对地址映射回反代。
 *  currentHost = 本响应来自哪个上游域（决定它的地址映射到自己的前缀）。 */
export function rewriteBodyText(text: string, currentHost: string): string {
  const map = new Map<string, string>();
  map.set(CVS_HOST, "");
  for (const h of CAS_HOSTS) map.set(h, "/__cas");
  const cur = currentHost.toLowerCase();
  const curPrefix = prefixForHost(cur);
  if (curPrefix !== null) map.set(cur, curPrefix);

  let out = text;
  for (const [host, prefix] of map) {
    const target = `http://localhost:${PORT}${prefix}`;
    out = out.split(`https://${host}`).join(target);
    out = out.split(`http://${host}`).join(target);
    out = out.split(`//${host}`).join(target);
  }
  return out;
}
