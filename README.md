# YouMind Nano Banana Pro Sync

这个项目参考本地 `YouMind GPT image 2` 项目，建立 Nano Banana Pro 提示词的自动化链路：

1. 从 `https://youmind.com/youhome-api/prompts` 拉取 `model=nano-banana-pro` 的公开分页数据。
2. 用 `lark-cli` 增量同步一份内容到飞书多维表格。
3. 从飞书优先、YouMind 快照兜底生成 `site/data/prompts.json`。
4. 通过 GitHub Actions 把 `site/` 部署到 GitHub Pages。

## 本地运行

```bash
npm run fetch
npm run build:site
npm run dev
```

本地预览地址：`http://localhost:4174`

为了开发时避免拉取全量数据，可以限制页数：

```bash
YOUMIND_MAX_PAGES=4 YOUMIND_PAGE_LIMIT=60 YOUMIND_PAGE_DELAY_MS=0 npm run fetch
SITE_SOURCE_MODE=public-only npm run build:site
```

## 飞书多维表格

如果要创建新的飞书多维表格：

```bash
npm run bootstrap:lark
```

运行后会生成 `.nano-banana-pro.local.json`，里面包含 `baseToken` 和 `tableId`。

如果已有表格，配置环境变量或本地配置后运行：

```bash
npm run ensure:lark
npm run sync:lark
```

自托管 runner 可用：

```bash
npm run sync:lark:local-auth
```

## GitHub Actions

已配置 `.github/workflows/sync-and-deploy.yml`。

如果要用 `lark-cli` 同步到飞书，建议使用自托管 runner，并在仓库 Variables 设置：

- `ENABLE_SELF_HOSTED_LARK_SYNC=1`
- `COMMIT_GENERATED_SITE=1`（可选：把 `data/prompts.zh-CN.json` 和 `site/data/prompts.json` 回写到 fork）

runner labels：

- `self-hosted`
- `macOS`
- `ARM64`
- `youmind-sync`

仓库 Secrets：

- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`

GitHub Pages 设置里把 Source 设为 `GitHub Actions`。workflow 会上传 `site/` 作为 Pages artifact。
