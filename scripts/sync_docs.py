#!/usr/bin/env python3
"""
同步 mycv/docs/*.md → 博客 _articles/*.md

核心：自动解析 docs 里的 GitHub 风格 file#Lstart-Lend 锚点，
从 mycv 源码中摘取对应真实代码片段，嵌入到博客 Markdown 段落末尾。

使用方式：
  cd /home/ck/workspace/CourtJadeLiquor.github.io
  python3 scripts/sync_docs.py
  bundle exec jekyll build   # 验证
  git add -A && git commit && git push

设计说明见文末注释。
"""
import os, re

# ============== 路径 ==============
SRC_DOCS = "/home/ck/workspace/mycv/docs"     # 文档根
SRC_ROOT = "/home/ck/workspace/mycv"           # 源码根
DST_ROOT = os.path.join(os.path.dirname(__file__), "..", "_articles")

# ============== 元信息映射 ==============
# 每行：(docs相对路径, 博客slug, 标题, 专栏内分组, 顺序号, 日期, 标签)
META = [
    ("architecture.md",                   "architecture",                     "hpcplatform 架构设计",              "总览",         1,  "2026-11-01", ["HPCPlatform", "架构", "设计原则"]),
    ("operator_config.md",                "operator-config",                  "配置驱动算子对象",                  "总览",         2,  "2026-11-02", ["HPCPlatform", "配置驱动", "Operator"]),
    ("architecture_review_2026-11-25.md", "architecture-review-2026-11-25",   "HPCPlatform 架构评审报告",         "总览",         3,  "2026-11-25", ["HPCPlatform", "架构评审"]),
    ("qa/README.md",                       "qa-overview",                      "问答与易错点总览",                  "问答与易错点", 10, "2026-11-03", ["HPCPlatform", "QA"]),
    ("qa/project_structure.md",            "qa-project-structure",             "公共 API 分层与模块边界",           "问答与易错点", 11, "2026-11-20", ["HPCPlatform", "模块划分"]),
    ("qa/friend_classes.md",               "qa-friend-classes",                "为什么禁用友元类",                  "问答与易错点", 12, "2026-11-22", ["HPCPlatform", "friend"]),
    ("qa/trait_vs_interface.md",          "qa-trait-vs-interface",            "Trait vs 虚接口",                   "问答与易错点", 13, "2026-11-23", ["HPCPlatform", "trait", "CRTP"]),
    ("qa/cpubackends.md",                 "qa-cpubackends",                   "CPU 内存与后端分层",                "问答与易错点", 14, "2026-11-04", ["HPCPlatform", "CPU", "内存"]),
    ("qa/tensor_views.md",                "qa-tensor-views",                  "Tensor 视图与 stride",              "问答与易错点", 15, "2026-11-05", ["HPCPlatform", "Tensor", "stride"]),
    ("qa/memory_lifecycle.md",            "qa-memory-lifecycle",              "内存生命周期",                      "问答与易错点", 16, "2026-11-06", ["HPCPlatform", "内存管理"]),
    ("qa/op_dispatch.md",                 "qa-op-dispatch",                   "算子分发与错误码",                  "问答与易错点", 17, "2026-11-07", ["HPCPlatform", "注册表", "错误码"]),
    ("qa/context_copy.md",                "qa-context-copy",                  "Context::Copy 语义",                "问答与易错点", 18, "2026-11-08", ["HPCPlatform", "Context", "Copy"]),
    ("qa/cuda_stream_visibility.md",       "qa-cuda-stream-visibility",        "CUDA 流与可见性",                   "问答与易错点", 19, "2026-11-09", ["HPCPlatform", "CUDA", "Stream"]),
    ("qa/error_model.md",                 "qa-error-model",                   "错误模型",                          "问答与易错点", 20, "2026-11-10", ["HPCPlatform", "Status", "Result"]),
    ("qa/testing.md",                     "qa-testing",                       "构建与对拍测试",                    "问答与易错点", 21, "2026-11-11", ["HPCPlatform", "构建", "测试"]),
]

DEPRECATED_SLUGS = {"roadmap"}
SRC_EXTS = {'.h', '.hpp', '.cpp', '.cu', '.cuh', '.c', '.yaml', '.yml'}
EXT_TO_LANG = {".h": "cpp", ".hpp": "cpp", ".cpp": "cpp", ".cu": "cpp", ".cuh": "cpp", ".c": "c", ".yml": "yaml", ".yaml": "yaml"}

# ============== 工具函数 ==============
def resolve_source(md_rel_dir: str, src_rel_link: str) -> str | None:
    md_dir_abs = os.path.join(SRC_DOCS, md_rel_dir) if md_rel_dir else SRC_DOCS
    p = os.path.normpath(os.path.join(md_dir_abs, src_rel_link))
    if os.path.exists(p): return p
    p2 = os.path.normpath(os.path.join(SRC_ROOT, src_rel_link))
    return p2 if os.path.exists(p2) else None

def read_range(src_path: str, start: int, end: int) -> str | None:
    try:
        with open(src_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if 1 <= start <= end <= len(lines):
            return "".join(lines[start - 1:end])
    except Exception:
        pass
    return None

def front_matter(slug, title, date, section, order, tags):
    tag_yaml = "[" + ", ".join(f'"{t}"' for t in tags) + "]" if tags else "[]"
    return f"""---
layout: article
title: "{title}"
date: {date}
column: "HPCPlatform"
section: "{section}"
order: {order}
permalink: /articles/{slug}/
tags: {tag_yaml}
---
"""

def strip_first_h1(body: str) -> str:
    lines = body.split("\n")
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
        while lines and lines[0].strip() == "":
            lines = lines[1:]
    return "\n".join(lines)

def convert_md_links(body: str, md_rel_dir: str) -> str:
    """把文档间相对 md 链接（[foo](./bar.md)）转为博客绝对路径 /articles/bar/"""
    path_to_slug = {os.path.normpath(s): slug for s, slug, *_ in META}
    def repl(m):
        text, target = m.group(1), m.group(2)
        if "http" in target or target.startswith("/") or "mailto:" in target: return m.group(0)
        if not target.endswith(".md"): return m.group(0)
        clean = target.split("#")[0].split("?")[0]
        abs_target = os.path.normpath(os.path.join(md_rel_dir, clean))
        slug = path_to_slug.get(abs_target)
        if slug is None: return m.group(0)
        anchor = target[target.index("#"):] if "#" in target else ""
        return f'[{text}](/articles/{slug}/{anchor})'
    return re.sub(r'\[([^\]]+)\]\(([^)]+\.md[^)]*)\)', repl, body)


# ============== 核心：源码片段嵌入 ==============
def extract_source_fragments(body: str, md_rel: str) -> tuple[str, int]:
    """
    把所有 [text](path#Lstart-Lend) 锚点链接：
      - 先解析 → 读源码 → 收集真实片段
      - 链接保留原位，代码块自动追加到**所在段落末尾**
    （行内引用常见 "见 [error.h](...) 注释"，代码块插行中间会破坏排版）
    """
    count = 0
    md_rel_dir = os.path.dirname(md_rel)
    MAX_LINES = 80

    link_pat = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
    fragments: dict[str, str] = {}

    def phase1_collect(m):
        nonlocal count
        full = m.group(0)
        url = m.group(2)

        if "http" in url or url.startswith("/") or "mailto:" in url or "#L" not in url:
            return full

        path_part, anchor_part = url.rsplit("#L", 1)
        m2 = re.match(r'(\d+)-L(\d+)', anchor_part)   # GitHub L21-L23
        if not m2:
            return full
        start, end = int(m2.group(1)), int(m2.group(2))

        _, ext = os.path.splitext(path_part)
        if ext.lower() not in SRC_EXTS:
            return full

        abs_src = resolve_source(md_rel_dir, path_part)
        if abs_src is None:
            return full + f"\n<!-- ⚠ 未找到源码: {path_part} -->"

        snippet = read_range(abs_src, start, end)
        if not snippet:
            return full

        # 超长片段裁剪
        if end - start + 1 > MAX_LINES:
            ls = snippet.split("\n")
            head, tail = ls[:35], ls[-15:]
            omitted = len(ls) - 50
            snippet = "\n".join(head) + f"\n    // ... (省略 {omitted} 行)\n" + "\n".join(tail)

        anchor_id = f"src-{count}"
        count += 1
        display_path = os.path.relpath(abs_src, SRC_ROOT)
        lang = EXT_TO_LANG.get(ext.lower(), "text")
        fragments[anchor_id] = (
            "```" + lang + "\n"
            f"// {display_path}:L{start}-L{end}\n"
            + snippet.rstrip() + "\n"
            "```"
        )
        return full + f"\n<!-- SRCFRAG:{anchor_id} -->"

    body = link_pat.sub(phase1_collect, body)

    # 第二段：段落末尾展开占位符
    marker_pat = re.compile(r'<!-- SRCFRAG:([^ ]+) -->')
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body) if p.strip()]
    out = []
    for para in paragraphs:
        ids = [m.group(1) for m in marker_pat.finditer(para)]
        para = marker_pat.sub('', para)
        para = re.sub(r'\n{3,}', '\n\n', para)
        if ids:
            blocks = [fragments[oid] for oid in ids if oid in fragments]
            para = para.rstrip() + "\n\n" + "\n\n".join(blocks) + "\n"
        out.append(para)
    return "\n\n".join(out), count


# ============== 主流程 ==============
def main():
    os.makedirs(DST_ROOT, exist_ok=True)
    for slug in DEPRECATED_SLUGS:
        old = os.path.join(DST_ROOT, f"{slug}.md")
        if os.path.exists(old): os.remove(old)

    total_frag = 0
    for src_rel, slug, title, section, order, date, tags in META:
        src_path = os.path.join(SRC_DOCS, src_rel)
        if not os.path.exists(src_path):
            print(f"  ✗ 不存在: {src_rel}")
            continue
        body = open(src_path, encoding="utf-8").read()
        body = strip_first_h1(body)
        body = convert_md_links(body, os.path.dirname(src_rel))
        body, n = extract_source_fragments(body, src_rel)
        total_frag += n
        fm = front_matter(slug, title, date, section, order, tags)
        with open(os.path.join(DST_ROOT, f"{slug}.md"), "w", encoding="utf-8") as f:
            f.write(fm + "\n" + body)
        tag = f"  +{n}片段" if n else ""
        print(f"  ✓ {slug}.md  [{order:02d}] {title}{tag}")

    print(f"\n完成！共嵌入 {total_frag} 个真实源码片段。")
    print(f"源: {SRC_DOCS}  →  目标: {DST_ROOT}")


"""
设计决策：
  1. 不修改 mycv/docs（源仓库保持干净），每次重新跑 sync_docs.py 重新生成博客版 Markdown。
  2. 锚点解析：GitHub 文件#L21-L23 格式（中间第二个 L 是 GitHub 特有格式）。
  3. 片段插入到段落末尾而非链接紧接位置 —— 避免破坏行内引用的排版。
  4. 超长片段（>80 行）自动裁剪，保留首尾 35+15 行，中间加 // ... (省略 N 行)。
  5. docs 之间的相对 .md 链接统一转为 /articles/slug/ 博客路径。
"""

if __name__ == "__main__":
    main()
