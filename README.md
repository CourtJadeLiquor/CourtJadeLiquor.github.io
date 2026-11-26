# CourtJadeLiquor.github.io
个人博客站点 https://courtjadeliquor.github.io/

## 本地构建

需要 Ruby 3.3：

```sh
bundle install
bundle exec jekyll build
```

`Gemfile.lock` 锁定构建依赖，保证本地和 GitHub Actions 使用一致的 Jekyll 版本。

## GitHub Pages 部署

在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。不要选择 **Deploy from a branch**：该模式会使用 GitHub Pages 内置的 `github-pages` gem，与本项目的 Jekyll 4.4 依赖不兼容。

`.github/workflows/pages.yml` 会在 `mysite` 分支更新时构建并部署站点。

### 更新日期
2026-11-26日
