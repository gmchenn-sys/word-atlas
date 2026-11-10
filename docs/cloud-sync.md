# 手机与电脑同步

应用保留原有手机布局及 PWA 主屏幕入口。部署到 HTTPS 网站后，电脑和手机打开同一网址，在“我的 → 账号与同步”使用同一邮箱登录。

## Supabase

1. 在项目 SQL Editor 执行 `supabase/migrations/202611100001_word_atlas_sync.sql`。表名带有 `word_atlas_` 前缀，不会修改其他应用的数据。
2. 启用 Email 登录，在 URL Configuration 中把正式网址加入 Site URL 和 Redirect URLs；本地开发可另加 `http://localhost:5188/**`。
3. 把项目 URL 和浏览器专用的 publishable/anon key 写入本地 `.env.local`。变量名见 `.env.example`。不要使用 `service_role` 或 secret key。
4. 面向其他用户开放注册前，确认 Supabase 邮件服务允许向目标邮箱发送确认与密码重置邮件；需要时配置自己的 SMTP。

RLS 限制账号只能读写自己的进度。`word_atlas_commit` 在事务中检查版本号并记录每次写入的唯一 ID，避免并发覆盖及断网重试造成的重复计数。登录凭证由 Supabase Auth 管理，不进入 Git 仓库。

## 同步行为

账号数据与原来的游客进度分开保存在设备上，退出账号不会把该账号记录暴露到游客词库。登录后可选择合并这台设备的原本地进度；原记录仍保留。新网址与 localhost 属于不同来源，需要先从旧版“我的”导出 JSON，在新版登录后恢复一次。

同步包含单词记忆状态、收藏、错词、每日统计、打字记录、未结束的学习任务，以及发音偏好、每日词数、目标记忆率、起始水平等学习设置。主题、音效、环境声等设备偏好不跨设备覆盖。

更改后自动上传；回到页面或恢复网络时重新同步。页面可见时每 15 秒拉取云端变化。两端同时学习同一个词时，采用时间更晚的记忆状态；每日统计按各自基线的增量合并。首次合并没有共同基线的旧备份时，每日统计取较大值，避免把相同备份重复累计。建议切换设备前看到“已同步”，避免同一道练习在两端同时作答。

## GitHub Pages

仓库 Variables 设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`，Pages 选择 GitHub Actions。`.github/workflows/pages.yml` 从 `codex/mobile-sync` 构建发布。其他 Fork 需相应调整工作流分支、`ATLAS_BASE` 路径和 Supabase 允许的回调网址。

运行 `npm test` 和 `npm run build` 进行本地验证。不配置 Supabase 时仍可使用原有本地学习功能。
