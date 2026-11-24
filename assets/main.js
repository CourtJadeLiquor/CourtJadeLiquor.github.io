(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  /* ---------- mobile nav ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
  }

  /* ---------- reading progress ---------- */
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

  /* ---------- copy buttons on code blocks ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.prose pre'), function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = code ? code.innerText : pre.innerText;
      var done = function () {
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = '复制'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
    pre.appendChild(btn);
  });

  /* ---------- toc active state ---------- */
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

  /* ---------- reveal on scroll ---------- */
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

  /* ---------- theme-aware cursor aura ---------- */
  if (!reduceMotion && finePointer) {
    var aura = document.createElement('div');
    aura.className = 'cursor-aura';
    document.body.appendChild(aura);

    var targetX = -1200;
    var targetY = -1200;
    var curX = targetX;
    var curY = targetY;

    var render = function () {
      curX += (targetX - curX) * 0.18;
      curY += (targetY - curY) * 0.18;
      aura.style.transform = 'translate3d(' + curX.toFixed(1) + 'px,' + curY.toFixed(1) + 'px,0)';
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    var lastSpark = 0;
    var lastX = 0;
    var lastY = 0;

    document.addEventListener('pointermove', function (ev) {
      targetX = ev.clientX;
      targetY = ev.clientY;
      aura.classList.add('visible');

      var now = Date.now();
      var dx = ev.clientX - lastX;
      var dy = ev.clientY - lastY;
      if (now - lastSpark > 48 && dx * dx + dy * dy > 90) {
        lastSpark = now;
        lastX = ev.clientX;
        lastY = ev.clientY;
        spawnSpark(ev.clientX, ev.clientY);
      }
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      aura.classList.remove('visible');
    });

    document.addEventListener('pointerdown', function (ev) {
      spawnRipple(ev.clientX, ev.clientY);
    }, { passive: true });
  }

  function spawnSpark(x, y) {
    var spark = document.createElement('span');
    spark.className = 'spark';
    var offset = 10;
    spark.style.left = (x + (Math.random() * offset - offset / 2)) + 'px';
    spark.style.top = (y + (Math.random() * offset - offset / 2)) + 'px';
    spark.style.opacity = '0.9';
    document.body.appendChild(spark);
    setTimeout(function () {
      if (spark.parentNode) spark.parentNode.removeChild(spark);
    }, 780);
  }

  function spawnRipple(x, y) {
    if (reduceMotion) return;
    var ripple = document.createElement('span');
    ripple.className = 'click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.body.appendChild(ripple);
    setTimeout(function () {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 700);
  }
})();
