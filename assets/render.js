/* 宫廷玉液酒 · Markdown 渲染器：Markdown + LaTeX + Mermaid(UML) */
(function () {
  'use strict';

  var md = null;
  var mermaidReady = false;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentMermaidTheme() {
    return document.documentElement.getAttribute('data-theme') === 'github' ? 'default' : 'dark';
  }

  function renderTex(tex, display) {
    if (window.katex && typeof window.katex.renderToString === 'function') {
      try {
        return window.katex.renderToString(tex, {
          displayMode: !!display,
          throwOnError: false,
          strict: 'ignore',
          trust: false
        });
      } catch (err) {
        /* fallthrough */
      }
    }
    return '<code>' + escapeHtml(tex) + '</code>';
  }

  function installMath(instance) {
    instance.inline.ruler.after('escape', 'math_inline', function (state, silent) {
      var start = state.pos;
      if (state.src.charCodeAt(start) !== 0x24) return false;
      if (state.src.charCodeAt(start + 1) === 0x24) return false;
      var end = state.src.indexOf('$', start + 1);
      if (end < 0) return false;
      var content = state.src.slice(start + 1, end);
      if (!content || content.length > 800 || /[\n]/.test(content)) return false;
      if (/^\s|\s$/.test(content)) return false;
      if (!/[\\^_=+\-*/<>a-zA-Z0-9]/.test(content)) return false;
      if (!silent) {
        var token = state.push('math_inline', 'math', 0);
        token.content = content;
        token.markup = '$';
      }
      state.pos = end + 1;
      return true;
    });

    instance.block.ruler.before('fence', 'math_block', function (state, startLine, endLine, silent) {
      var start = state.bMarks[startLine] + state.tShift[startLine];
      var max = state.eMarks[startLine];
      var line = state.src.slice(start, max);
      if (line.trim().indexOf('$$') !== 0) return false;

      var body = line.trim().slice(2);
      var content = '';
      var nextLine = startLine + 1;

      if (body.indexOf('$$') >= 0) {
        content = body.slice(0, body.indexOf('$$'));
      } else {
        var lines = [body];
        var closed = false;
        while (nextLine < endLine) {
          var s = state.bMarks[nextLine] + state.tShift[nextLine];
          var e = state.eMarks[nextLine];
          var cur = state.src.slice(s, e);
          var closeAt = cur.indexOf('$$');
          if (closeAt >= 0) {
            lines.push(cur.slice(0, closeAt));
            closed = true;
            nextLine += 1;
            break;
          }
          lines.push(cur);
          nextLine += 1;
        }
        if (!closed) return false;
        content = lines.join('\n');
      }

      if (silent) return true;
      var token = state.push('math_block', 'math', 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, nextLine];
      state.line = nextLine;
      return true;
    });

    instance.renderer.rules.math_inline = function (tokens, idx) {
      return renderTex(tokens[idx].content, false);
    };
    instance.renderer.rules.math_block = function (tokens, idx) {
      return '<div class="math-display">' + renderTex(tokens[idx].content, true) + '</div>\n';
    };
  }

  function init() {
    if (md || !window.markdownit) return md;
    md = window.markdownit({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false
    });
    installMath(md);

    var defaultFence = md.renderer.rules.fence;
    md.renderer.rules.fence = function (tokens, idx, options, env, self) {
      var token = tokens[idx];
      var info = String(token.info || '').trim().split(/\s+/)[0].toLowerCase();
      if (info === 'mermaid' || info === 'uml') {
        return '<div class="mermaid">' + escapeHtml(token.content) + '</div>\n';
      }
      if (info === 'math' || info === 'latex') {
        return '<div class="math-display">' + renderTex(token.content, true) + '</div>\n';
      }
      return defaultFence.call(this, tokens, idx, options, env, self);
    };

    return md;
  }

  function prepareStatic(root) {
    var blocks = root.querySelectorAll('pre > code.language-mermaid, pre > code.lang-mermaid');
    Array.prototype.forEach.call(blocks, function (code) {
      var pre = code.parentNode;
      var wrap = document.createElement('div');
      wrap.className = 'mermaid';
      wrap.textContent = code.textContent;
      if (pre.parentNode) pre.parentNode.replaceChild(wrap, pre);
    });
  }

  function runMermaid(root) {
    if (!window.mermaid) return;
    var scope = root || document;
    var nodes = scope.querySelectorAll('.mermaid');
    if (!nodes.length) return;

    Array.prototype.forEach.call(nodes, function (node) {
      if (!node.dataset.src) node.dataset.src = node.textContent;
      if (!node.textContent.trim() && node.dataset.src) node.textContent = node.dataset.src;
    });

    if (!mermaidReady) {
      mermaidReady = true;
    }
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: currentMermaidTheme(),
        securityLevel: 'strict',
        fontFamily: '"Inter","PingFang SC","Microsoft YaHei",sans-serif',
        flowchart: { htmlLabels: true, curve: 'basis' },
        class: { useMaxWidth: true }
      });
    } catch (err) { /* ignore */ }

    Array.prototype.forEach.call(nodes, function (node) {
      node.removeAttribute('data-processed');
      node.textContent = node.dataset.src || '';
    });

    var list = Array.prototype.slice.call(nodes);
    try {
      var result = window.mermaid.run({ nodes: list });
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          console.warn('[mermaid] render failed', err);
          list.forEach(function (node) {
            if (!node.hasAttribute('data-processed')) {
              node.classList.add('mermaid-error');
              node.textContent = node.dataset.src || '';
            }
          });
        });
      }
    } catch (err) {
      console.warn('[mermaid] init failed', err);
    }
  }

  function renderText(source) {
    var instance = init();
    if (!instance) return '<p>' + escapeHtml(source || '') + '</p>';
    return instance.render(String(source || ''));
  }

  function mount(el, source) {
    if (!el) return;
    el.innerHTML = renderText(source);
    runMermaid(el);
  }

  function rerenderMermaid() {
    var all = document.querySelectorAll('.mermaid');
    Array.prototype.forEach.call(all, function (node) {
      node.removeAttribute('data-processed');
      node.textContent = node.dataset.src || node.textContent;
    });
    runMermaid(document);
  }

  document.addEventListener('cjl:themechange', function () {
    rerenderMermaid();
  });

  document.addEventListener('DOMContentLoaded', function () {
    prepareStatic(document);
    if (document.querySelector('.mermaid')) runMermaid(document);
  });

  window.CJLRender = {
    init: init,
    render: renderText,
    mount: mount,
    runMermaid: runMermaid,
    rerenderMermaid: rerenderMermaid,
    escapeHtml: escapeHtml
  };
})();
