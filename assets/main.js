// ==========================================================================
// 宫廷玉液酒 · CourtJadeLiquor — 精简主脚本
// 保留：导航折叠 / 阅读进度 / 代码复制 / 目录高亮 / reveal 动画 / 光标 aura
// 移除：数据库调用 / API / 编辑器 / 评论动态加载 / spark / ripple
// ==========================================================================

(function () {
  'use strict';

  /* ---------- Mermaid: 把 ```mermaid 代码块转成 SVG 图 ----------
     kramdown 输出 <pre><code class="language-mermaid">…</code></pre>，
     mermaid.js 只认 class="mermaid" 的元素，所以先做一次 DOM 转换再 init。 */
  if (typeof window.mermaid !== 'undefined') {
    try {
      var isLight = document.documentElement.getAttribute('data-theme') === 'github';
      window.mermaid.initialize({
        startOnLoad: false,
        theme: isLight ? 'default' : 'dark',
        securityLevel: 'loose',
        flowchart: { htmlLabels: true, curve: 'basis' },
        themeVariables: isLight ? {} : {
          background: 'transparent',
          primaryColor: '#102420',
          primaryTextColor: '#eaf3ee',
          primaryBorderColor: '#4fd1a5',
          lineColor: '#8fe3c5',
          secondaryColor: '#0d1c18',
          tertiaryColor: '#0b1714',
          textColor: '#cfded7',
          mainBkg: '#102420',
          nodeBorder: '#4fd1a5',
          clusterBkg: 'rgba(79, 209, 165, 0.06)',
          clusterBorder: 'rgba(120, 200, 172, 0.3)'
        }
      });
      var raw = document.querySelectorAll('pre code.language-mermaid');
      Array.prototype.forEach.call(raw, function (code) {
        var pre = code.parentElement;
        if (!pre) return;
        var div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = code.textContent;
        pre.replaceWith(div);
      });
      if (document.querySelectorAll('.mermaid').length) {
        window.mermaid.run();
      }
    } catch (e) { /* mermaid 渲染失败不影响页面其余部分 */ }
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------- 移动端导航 ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () { nav.classList.toggle('open'); });
  }

  /* ---------- 阅读进度条 ---------- */
  var bar = document.querySelector('.progress');
  if (bar) {
    var updateProgress = function () {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? (h.scrollTop || document.body.scrollTop) / max : 0;
      bar.style.width = Math.min(100, Math.max(0, p * 100)) + '%';
    };
    document.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  }

  /* ---------- 代码块复制按钮 ---------- */
  var codeBlocks = document.querySelectorAll('.prose pre, .prose .highlight');
  Array.prototype.forEach.call(codeBlocks, function (block) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', function () {
      var codeEl = block.querySelector('code');
      var text = codeEl ? codeEl.innerText : block.innerText;
      var done = function () {
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = '复制'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
    block.appendChild(btn);
  });

  /* ---------- 目录（TOC）当前章节高亮 ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) {
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (id) byId[id] = a;
    });
    var heads = Object.keys(byId).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var active = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (active) active.classList.remove('active');
          active = byId[e.target.id];
          if (active) active.classList.add('active');
        }
      });
    }, { rootMargin: '-72px 0px -68% 0px', threshold: 0 });
    heads.forEach(function (h) { io.observe(h); });
  }

  /* ---------- 滚动淡入 ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          ro.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(revealEls, function (el, i) {
      el.style.transitionDelay = Math.min(i % 3, 2) * 70 + 'ms';
      ro.observe(el);
    });
  } else {
    Array.prototype.forEach.call(revealEls, function (el) { el.classList.add('in'); });
  }

  /* ---------- 光标 aura（精简版，无 spark/ripple） ---------- */
  if (!reduceMotion && finePointer) {
    var aura = document.createElement('div');
    aura.className = 'cursor-aura';
    document.body.appendChild(aura);

    var targetX = -1200, targetY = -1200, curX = targetX, curY = targetY;
    var render = function () {
      curX += (targetX - curX) * 0.18;
      curY += (targetY - curY) * 0.18;
      aura.style.transform = 'translate3d(' + curX.toFixed(1) + 'px,' + curY.toFixed(1) + 'px,0)';
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    document.addEventListener('pointermove', function (ev) {
      targetX = ev.clientX; targetY = ev.clientY;
      aura.classList.add('visible');
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      aura.classList.remove('visible');
    });
  }
})();
