/* 宫廷玉液酒 · 全局交互：主题切换、登录注册、评论与回复 */
(function () {
  'use strict';

  var state = { user: null, loading: true, commentsThread: null };

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function api(url, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (options.headers) Object.keys(options.headers).forEach(function (k) { headers[k] = options.headers[k]; });
    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: options.body == null ? undefined : JSON.stringify(options.body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || '请求失败（' + res.status + '）');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------------- theme ---------------- */

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'github' ? 'github' : 'dark';
  }

  function applyTheme(theme, persist) {
    var next = theme === 'github' ? 'github' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (persist !== false) {
      try {
        localStorage.setItem('cjl-theme', next);
        document.cookie = 'cjl-theme=' + next + '; path=/; max-age=31536000; samesite=lax';
      } catch (err) { /* ignore */ }
    }
    updateThemeButton();
    document.dispatchEvent(new CustomEvent('cjl:themechange', { detail: { theme: next } }));
  }

  function updateThemeButton() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    var dark = currentTheme() === 'dark';
    btn.textContent = dark ? '☀' : '☾';
    btn.title = dark ? '切换为 GitHub 浅色主题' : '切换为神秘暗黑主题';
    btn.setAttribute('aria-label', btn.title);
  }

  /* ---------------- header ---------------- */

  function buildHeaderTools() {
    var inner = document.querySelector('.header-inner');
    if (!inner || inner.querySelector('.header-tools')) return;

    var tools = h('div', 'header-tools');
    var themeBtn = h('button', 'icon-btn theme-toggle');
    themeBtn.type = 'button';
    themeBtn.addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'github' : 'dark', true);
    });

    var slot = h('div', 'auth-slot');
    slot.id = 'authSlot';

    tools.appendChild(themeBtn);
    tools.appendChild(slot);

    inner.appendChild(tools);

    updateThemeButton();
    renderAuthSlot();
  }

  function renderAuthSlot() {
    var slot = document.getElementById('authSlot');
    if (!slot) return;
    slot.textContent = '';

    if (!state.user) {
      var login = h('button', 'btn btn-ghost btn-sm', '管理员登录');
      login.type = 'button';
      login.addEventListener('click', function () { openAuth(); });
      slot.appendChild(login);
      return;
    }

    var wrap = h('div', 'user-wrap');
    var chip = h('button', 'user-chip');
    chip.type = 'button';
    var avatar = h('span', 'avatar', state.user.nickname.charAt(0));
    var name = h('span', 'uname', state.user.nickname);
    chip.appendChild(avatar);
    chip.appendChild(name);
    if (state.user.role === 'admin') {
      var badge = h('span', 'comment-badge', '管理员');
      chip.appendChild(badge);
    }
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      wrap.classList.toggle('open');
    });

    var menu = h('div', 'user-menu');
    if (state.user.role === 'admin') {
      var write = h('a', null, '写作台 · 新建文章');
      write.href = rootHref('editor.html');
      menu.appendChild(write);
    }
    var posts = h('a', null, '博客文章');
    posts.href = rootHref('posts.html');
    menu.appendChild(posts);

    var logout = h('button', null, '退出登录');
    logout.type = 'button';
    logout.addEventListener('click', function () {
      api('/api/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        setUser(null);
        toast('已退出登录');
      });
    });
    menu.appendChild(logout);

    wrap.appendChild(chip);
    wrap.appendChild(menu);
    slot.appendChild(wrap);
  }

  document.addEventListener('click', function () {
    var open = document.querySelector('.user-wrap.open');
    if (open) open.classList.remove('open');
  });

  /* ---------------- auth modal ---------------- */

  var modalBuilt = false;

  function buildModal() {
    if (modalBuilt) return;
    modalBuilt = true;

    var mask = h('div', 'modal-mask');
    mask.id = 'authModal';
    var modal = h('div', 'modal');

    var close = h('button', 'modal-close', '×');
    close.type = 'button';
    close.addEventListener('click', closeAuth);

    var title = h('h2', 'modal-title', '管理员登录');
    var sub = h('p', 'modal-sub', '访客无需登录，填写昵称即可评论；仅超级管理员可发布与修改文章。');

    var loginForm = h('form', 'auth-form');
    loginForm.id = 'loginForm';
    loginForm.innerHTML =
      '<div class="field"><label for="loginIdentifier">邮箱或昵称</label>' +
      '<input id="loginIdentifier" name="identifier" autocomplete="username" placeholder="chengkong@courtjadeliquor.cn" required></div>' +
      '<div class="field"><label for="loginPassword">密码</label>' +
      '<input id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="管理员密码" required></div>' +
      '<div class="form-error" id="loginError"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">登录</button>';

    var hint = h('p', 'auth-hint');
    hint.innerHTML = '默认超级管理员：<b>澄空</b> · 邮箱 <b>chengkong@courtjadeliquor.cn</b>';

    modal.appendChild(close);
    modal.appendChild(title);
    modal.appendChild(sub);
    modal.appendChild(loginForm);
    modal.appendChild(hint);
    mask.appendChild(modal);
    document.body.appendChild(mask);

    mask.addEventListener('click', function (ev) {
      if (ev.target === mask) closeAuth();
    });

    loginForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errorEl = document.getElementById('loginError');
      var btn = loginForm.querySelector('button[type="submit"]');
      errorEl.textContent = '';
      btn.disabled = true;
      api('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: loginForm.identifier.value.trim(),
          password: loginForm.password.value
        }
      }).then(function (data) {
        setUser(data.user);
        closeAuth();
        toast('欢迎回来，' + data.user.nickname);
      }).catch(function (err) {
        errorEl.textContent = err.message;
      }).then(function () { btn.disabled = false; });
    });
  }

  function openAuth() {
    buildModal();
    var mask = document.getElementById('authModal');
    mask.classList.add('open');
    setTimeout(function () {
      var input = mask.querySelector('.auth-form:not([style*="none"]) input');
      if (input) input.focus();
    }, 80);
  }

  function closeAuth() {
    var mask = document.getElementById('authModal');
    if (mask) mask.classList.remove('open');
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeAuth();
  });

  function setUser(user) {
    state.user = user || null;
    state.loading = false;
    renderAuthSlot();
    document.dispatchEvent(new CustomEvent('cjl:authchange', { detail: { user: state.user } }));
    if (state.commentsThread) loadComments(state.commentsThread);
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(message) {
    var node = document.querySelector('.toast');
    if (!node) {
      node = h('div', 'toast');
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2600);
  }

  /* ---------------- helpers ---------------- */

  function rootHref(file) {
    var path = window.location.pathname;
    var inSub = /\/articles\//.test(path) || /\/[^/]+\/[^/]*$/.test(path);
    if (/\/articles\//.test(path)) return '../' + file;
    return file;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    } catch (err) {
      return '';
    }
  }

  function avatarNode(nickname) {
    var node = h('span', 'comment-avatar avatar', (nickname || '?').charAt(0));
    var hash = 0;
    for (var i = 0; i < (nickname || '').length; i++) hash = (hash * 31 + nickname.charCodeAt(i)) % 360;
    node.style.background = 'linear-gradient(135deg,hsl(' + (hash + 140) + ',68%,58%),hsl(' + (hash + 190) + ',62%,44%))';
    node.style.color = '#fff';
    return node;
  }

  /* ---------------- guest identity ---------------- */

  var GUEST_KEY = 'cjl-guest';

  function getGuest() {
    try {
      var raw = localStorage.getItem(GUEST_KEY);
      return raw ? JSON.parse(raw) || {} : {};
    } catch (err) {
      return {};
    }
  }

  function saveGuest(guest) {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(guest)); } catch (err) { /* ignore */ }
  }

  /* ---------------- comments ---------------- */

  function mountComments() {
    var thread = document.body.getAttribute('data-thread');
    if (!thread) {
      var holder = document.getElementById('commentsMount');
      if (holder) thread = holder.getAttribute('data-thread');
    }
    if (!thread) return;
    state.commentsThread = thread;

    var main = document.querySelector('main');
    if (!main || document.getElementById('comments')) return;

    var section = h('section', 'comments');
    section.id = 'comments';
    var container = h('div', 'container');
    var inner = h('div', 'comments-inner');
    inner.id = 'commentsInner';
    container.appendChild(inner);
    section.appendChild(container);
    main.appendChild(section);

    loadComments(thread);
  }

  function loadComments(thread) {
    var inner = document.getElementById('commentsInner');
    if (!inner) return;
    inner.textContent = '';
    inner.appendChild(h('div', 'comment-empty', '评论加载中…'));

    api('/api/comments?thread=' + encodeURIComponent(thread)).then(function (data) {
      renderComments(inner, thread, data.comments || []);
    }).catch(function (err) {
      inner.textContent = '';
      inner.appendChild(h('div', 'comment-empty', '评论加载失败：' + err.message));
    });
  }

  function renderComments(inner, thread, comments) {
    inner.textContent = '';

    var head = h('div', 'comments-head');
    head.appendChild(h('h2', null, '评论'));
    head.appendChild(h('span', null, comments.length + ' 条讨论'));
    inner.appendChild(head);

    if (!state.user) {
      inner.appendChild(h('p', 'comment-note', '无需注册，填写昵称即可参与评论与回复。评论保存在内存中，服务重启后会清空。'));
    }
    inner.appendChild(buildCommentForm(thread, null));

    if (!comments.length) {
      var empty = h('div', 'comment-empty', '还没有评论，来写下第一条吧。');
      empty.style.marginTop = '20px';
      inner.appendChild(empty);
      return;
    }

    var children = {};
    var rootItems = [];
    comments.forEach(function (c) { children[c.id] = []; });
    comments.forEach(function (c) {
      if (c.parentId && children[c.parentId]) children[c.parentId].push(c);
      else rootItems.push(c);
    });

    var list = h('div', 'comment-list');
    list.style.marginTop = '24px';

    function renderOne(comment) {
      var wrap = h('div', 'comment');
      wrap.appendChild(avatarNode(comment.nickname));
      var body = h('div', 'comment-main');

      var top = h('div', 'comment-top');
      top.appendChild(h('span', 'comment-name', comment.nickname));
      if (comment.role === 'admin') top.appendChild(h('span', 'comment-badge', '管理员'));
      top.appendChild(h('span', 'comment-time', formatTime(comment.createdAt)));
      body.appendChild(top);

      body.appendChild(h('div', 'comment-text', comment.content));

      var foot = h('div', 'comment-foot');
      var replyBtn = h('button', null, '回复');
      replyBtn.type = 'button';
      replyBtn.addEventListener('click', function () {
        var existing = body.querySelector('.reply-form');
        if (existing) { existing.remove(); return; }
        body.appendChild(buildCommentForm(thread, comment.id, function () { loadComments(thread); }));
      });
      foot.appendChild(replyBtn);
      if (state.user && state.user.role === 'admin') {
        var delBtn = h('button', null, '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', function () {
          if (!window.confirm('确定删除这条评论吗？')) return;
          api('/api/comments/' + comment.id, { method: 'DELETE' }).then(function () {
            toast('评论已删除');
            loadComments(thread);
          }).catch(function (err) { toast(err.message); });
        });
        foot.appendChild(delBtn);
      }
      if (foot.childNodes.length) body.appendChild(foot);

      var kids = children[comment.id] || [];
      if (kids.length) {
        var replies = h('div', 'replies');
        kids.forEach(function (child) { replies.appendChild(renderOne(child)); });
        body.appendChild(replies);
      }

      wrap.appendChild(body);
      return wrap;
    }

    rootItems.forEach(function (item) { list.appendChild(renderOne(item)); });
    inner.appendChild(list);
  }

  function buildCommentForm(thread, parentId, onDone) {
    var guest = getGuest();
    var form = h('form', parentId ? 'reply-form' : 'comment-form');
    if (!parentId) {
      form.appendChild(avatarNode(state.user ? state.user.nickname : (guest.nickname || '客')));
    }
    var body = h('div', 'comment-form-body');

    var nickInput = null;
    var mailInput = null;
    if (!state.user) {
      var identity = h('div', 'comment-identity');
      nickInput = h('input');
      nickInput.type = 'text';
      nickInput.maxLength = 20;
      nickInput.placeholder = '昵称（必填，2-20 字）';
      nickInput.value = guest.nickname || '';
      nickInput.setAttribute('aria-label', '昵称');
      mailInput = h('input');
      mailInput.type = 'email';
      mailInput.maxLength = 120;
      mailInput.placeholder = '邮箱（选填）';
      mailInput.value = guest.email || '';
      mailInput.setAttribute('aria-label', '邮箱');
      identity.appendChild(nickInput);
      identity.appendChild(mailInput);
      body.appendChild(identity);
    }

    var textarea = h('textarea');
    textarea.placeholder = parentId ? '写下你的回复…' : '写下你的想法…支持换行';
    textarea.maxLength = 2000;
    textarea.required = true;
    body.appendChild(textarea);

    var actions = h('div', 'comment-actions');
    var submit = h('button', 'btn btn-primary btn-sm', parentId ? '发布回复' : '发表评论');
    submit.type = 'submit';
    actions.appendChild(submit);
    body.appendChild(actions);
    form.appendChild(body);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var content = textarea.value.trim();
      if (!content) return;
      var payload = { thread: thread, parentId: parentId || null, content: content };
      if (!state.user) {
        var nickname = nickInput.value.trim();
        if (nickname.length < 2) {
          toast('请填写至少 2 个字符的昵称');
          nickInput.focus();
          return;
        }
        payload.nickname = nickname;
        payload.email = mailInput.value.trim();
        saveGuest({ nickname: nickname, email: payload.email });
      }
      submit.disabled = true;
      api('/api/comments', {
        method: 'POST',
        body: payload
      }).then(function () {
        toast(parentId ? '回复已发布' : '评论已发布');
        if (onDone) onDone();
        else loadComments(thread);
      }).catch(function (err) {
        toast(err.message);
      }).then(function () { submit.disabled = false; });
    });

    return form;
  }

  /* ---------------- boot ---------------- */

  function boot() {
    buildHeaderTools();

    var stored = null;
    try { stored = localStorage.getItem('cjl-theme'); } catch (err) { stored = null; }
    if (stored === 'github' || stored === 'dark') applyTheme(stored, false);
    else {
      try {
        document.cookie = 'cjl-theme=' + currentTheme() + '; path=/; max-age=31536000; samesite=lax';
      } catch (err) { /* ignore */ }
    }
    updateThemeButton();

    mountComments();

    api('/api/auth/me').then(function (data) {
      setUser(data.user);
    }).catch(function () {
      setUser(null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.CJLApp = {
    api: api,
    toast: toast,
    openAuth: openAuth,
    closeAuth: closeAuth,
    mountComments: mountComments,
    get user() { return state.user; },
    get ready() { return !state.loading; },
    onAuth: function (cb) {
      document.addEventListener('cjl:authchange', function (ev) { cb(ev.detail.user); });
      if (!state.loading) cb(state.user);
    }
  };
})();
