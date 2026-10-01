# dsh-sub2api-usage

把 Sub2API 的余额 / 用量搬进 [DeepSeek Harness](https://github.com/deepseek-ai) 的左侧边栏：

| 位置 | 内容 |
| --- | --- |
| 侧边栏底部（设置旁边） | 实时余额小条（`$12.34 用量`），点击直接打开面板 |
| 侧边栏图标区 | 一个「Sub2API 用量」图标，和「插件 / 自动化任务」并列 |
| 主内容区 | 完整用量详情：余额、额度、订阅日/周/月、按天用量、模型用量、限流窗口、原始响应 |
| 面板「设置」页 | 查询接口全部可自定义：服务地址、模式、凭证、路径、字段指针、刷新间隔 |

![侧边栏底部小条与用量面板](assets/overview.png)

许可证：MIT（见 [LICENSE](LICENSE)）。

## 安装

从 GitHub 安装：

```powershell
dsh plugin --profile desktop add github:aming1029/dsh-sub2api-usage
```

或者先 `git clone` 到本地，再按路径安装：

```powershell
dsh plugin --profile desktop add file:<克隆下来的目录>
```

装好后**不用重启**：宿主的插件管理器会把它加进加载器树并即时生效，已经打开的页面通过 HMR 自动挂载。
若页面没变化，按 `F5` 刷新一次。

## 首次使用

点侧边栏的「Sub2API 用量」→「设置」，三种凭证任选一种：

| 模式 | 填什么 | 能查到 |
| --- | --- | --- |
| 站点 Key | `sk-…` | 该 Key 的钱包余额、订阅日/周/月用量、限流窗口、区间内模型与按天用量 |
| 管理员 | 后台「系统设置 → 管理员 API Key」生成的 `admin-…`；填「用户 ID」查单个用户，留空或勾选「拉取用户列表」查列表 | 任意用户的 `balance / frozen_balance / total_recharged` |
| 账号密码 | 邮箱 + 密码（或直接填一个已登录的访问令牌） | 当前登录账号 |
| 自定义请求 | 方法 / 路径 / 请求头 / 请求体 + JSON 指针 | 任何返回余额的接口 |

「自动识别」会在不指定模式时按凭证形状判断：`admin-…` → 管理员，`sk-…` → 站点 Key，JWT 或账号密码 → 用户。

填完点「保存并查询」；想先验证再保存就点「测试连接（不保存）」。

## 它打的是哪些接口

| 模式 | 请求 | 认证 |
| --- | --- | --- |
| key | `GET /v1/usage?start_date=&end_date=&timezone=` | `Authorization: Bearer sk-…` |
| admin（单用户） | `GET /api/v1/admin/users/:id` | `x-api-key: admin-…` 或管理员 `Bearer <JWT>` |
| admin（列表） | `GET /api/v1/admin/users?search=&page=&page_size=&sort_by=&sort_order=` | 同上 |
| user（账号） | `POST /api/v1/auth/login` → `GET /api/v1/auth/me` | 登录返回的 `access_token` |
| custom | 你自己写的方法 / 路径 / 请求头 / 请求体 | 你自己写 |

响应既支持标准包封 `{code, message, data}`（`code != 0` 会带着站点原文和修复建议报错），也支持裸对象。

**所有上游请求都由宿主（Node 侧）发出**：站点不需要开 CORS，凭证也不会出现在页面里。

## 自定义查询接口

「设置」里可以改的东西：

- **服务地址**：任何 sub2api 部署，`http(s)://…`，结尾斜杠无所谓。
- **路径**：用量路径 `/v1/usage`、当前用户 `/api/v1/auth/me`、管理员单用户 `/api/v1/admin/users/{id}`、管理员列表 `/api/v1/admin/users`。
- **字段指针**：余额 / 剩余额度 / 已用 / 额度上限，JSON Pointer 写法（`/data/quota/remaining`、`data.balance`、`/data/items[0]/balance` 都认）。留空则自动识别常见位置。
- **自定义请求**（模式选「自定义请求」时）：
  - 路径占位符：`{start}` `{end}` `{timezone}` `{id}`（未填的占位符会原样保留，便于发现配置遗漏）
  - 请求头写成 JSON 对象，例如 `{"x-api-key":"admin-…"}`、`{"Authorization":"Bearer sk-…"}`
  - 请求体写 JSON，GET 可留空
- **刷新与显示**：自动刷新间隔（0 = 只手动刷新）、统计区间天数、低余额提醒阈值（低于它时侧边栏图标出现小黄点）、货币符号、超时、时区。

设置页长这样：

![设置页](assets/settings.png)

「明细」页会把识别到的字段、每个上游请求的状态码、以及**原始响应**都列出来，遇到没见过的返回格式可以直接照着填指针：

![明细页](assets/detail.png)

## 配置文件

| 文件 | 内容 |
| --- | --- |
| `%DSH_HOME%\sub2api-usage.json` | 服务地址、模式、路径、指针、刷新间隔等（可安全分享） |
| `%DSH_HOME%\sub2api-usage.secrets.json` | 仅凭证与密码，权限 0600 |

`DSH_HOME` 默认是 `D:\dsh-home`（或 `~/.dsh`），也可用环境变量 `DSH_SUB2API_DIR` 指定目录。
页面的「设置」页底部会显示这两个文件的实际路径。

## 安全边界

- 上游接口只在**回环地址**上提供服务（`/sub2api-usage/api/*` 对非本机来源返回 403）：它持有凭证、且能被指向任意地址，不能暴露给局域网。
- 凭证只存在宿主侧；浏览器拿到的是 `sk-t…7890` 这样的掩码提示。
- 凭证以明文保存在 `sub2api-usage.secrets.json`（本机用户可读）。要更严格的隔离，请用系统凭据管理或限制该目录权限。
- 「测试连接」会在保存前用候选配置真发一次请求。

## 开发

```powershell
cd <克隆下来的 dsh-sub2api-usage 目录>
node --test "test/*.test.mjs"      # 64 项：纯逻辑 18 + 上游端到端 14 + 宿主路由 11 + 配置存储 10 + 客户端 11
node scripts/deploy.mjs            # 把改动同步到已安装它的 profile
```

`test/mock-sub2api.mjs` 是一个本地假站点（admin / key / user / custom / 超时 / 非 JSON 全覆盖），
既能被测试直接引用，也能单独跑起来供手工验证：

```powershell
node test/mock-sub2api.mjs 8799
# 再把插件指向 http://127.0.0.1:8799，凭证填 sk-testkey1234567890
```

结构：

```
dsh-sub2api-usage/
├── package.json          # dsh.bundle.patch + dsh.client(platform:web)
├── cordis.patch.yml      # 往 profile 加载器树里插一条 entry
├── lib/
│   ├── core.js           # 纯逻辑：配置、指针、请求计划、快照归一化（零依赖）
│   ├── query.js          # 执行计划 + 错误分类
│   ├── store.js          # 配置持久化（配置与凭证分开、原子写、单飞加载）
│   ├── index.js          # 宿主半区：/sub2api-usage/api/{state,config,query,test}
│   └── client.js         # 浏览器半区：侧边栏小条 + 面板图标 + 主面板
├── scripts/deploy.mjs    # 同步到 profile
├── assets/               # README 截图
└── test/                 # node:test 测试 + mock 站点
```

`lib/client.js` 是手写的 `window.__ModuleLoader__.load({ id, factory })` 浏览器模块（无构建步骤、无 JSX），
只 `require("react")` 这一个平台模块。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-sub2api-usage
```

或在上面的「插件」页里关掉它（会同时撤掉侧边栏小条、面板图标与主面板，路由也会下线）。
配置文件不会自动删除，需要的话手动删掉那两个 json。

## 排错

| 现象 | 处理 |
| --- | --- |
| 侧边栏显示「未配置」 | 还没填凭证，点开面板 → 设置 → 填一种凭证。 |
| 显示「查询失败」+ 面板里有红条 | 红条里有错误码、站点原文和修复建议；401/403 基本是凭证类型不对。 |
| 面板提示「宿主路由未加载」 | 插件被停用了，或者安装后没生效：`dsh plugin --profile desktop add file:…` 再试。 |
| 改了源码没反应 | 跑 `node scripts/deploy.mjs`（pnpm 装的是硬链接副本），必要时按 F5。 |
| 余额一直在但数字不动 | 「自动刷新间隔」是 0；改成 60 之类，或点「刷新」。 |

## 反馈

问题、需求、想加新的响应格式适配，都欢迎开 issue：
<https://github.com/aming1029/dsh-sub2api-usage/issues>
