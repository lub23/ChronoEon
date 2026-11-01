# ChronoEon 0.1.2 / 时元 0.1.2

- Fix Ask elapsed time: stop at stream completion, exclude local persistence, and use a monotonic clock. Browser, desktop and Android stop reading at `[DONE]` without waiting for HTTP EOF; trailing token usage is retained.
- Show streamed reasoning, tool calls and expandable results in a collapsible process card. Resolve relative date ranges on the device before querying records.
- Improve capture of current-time ranges, cross-midnight times and meals; use local record habits and include notes in draft summaries.
- Improve mobile conversation drawers and image paste; reuse compressed WebP, speed up native image compression and transfer WebDAV objects with four concurrent requests.
- Refine idea/item groups, category details, batch-replace filters and transitions; add four light/dark accent palettes.
- Restore reproducible local Windows/APK commands with automatic installed-toolchain discovery, APK signature verification and one output per version.
- Refresh build and recovery documentation; remove obsolete Git-sync, certificate-bundle and legacy Android-numbering claims. User-data schema and existing records are unchanged.

- 修复随心问耗时：使用单调时钟，流式回复完成即停止计时，排除本地保存；浏览器、桌面和 Android 收到 `[DONE]` 即结束读取，不再等待 HTTP 连接关闭，并保留结束前的 token 用量。
- 流式展示思考、工具调用与可展开结果，完成后折叠过程卡片；在本机计算相对日期范围，再检索记录。
- 完善随心记当前时间范围、跨午夜及用餐时间解析，参考本地历史习惯，草稿摘要补充备注。
- 优化手机对话侧栏与图片粘贴，复用压缩 WebP，加快原生图片压缩，WebDAV 对象以四并发传输。
- 调整灵感/物品分组、分类明细、批量替换筛选与切换过渡，新增四组明暗主题色。
- 保留 Windows/APK 本地手动构建与调试命令，自动发现已安装工具链，验证 APK 签名，同版本输出覆盖。
- 更新构建和同步排障文档，删除过时 Git 同步、证书包与 Android 历史编号说明；用户数据结构和已有记录不变。

---

# ChronoEon 0.1.1 / 时元 0.1.1

- Edit AI providers inline; preserve common fields when changing type, mark required fields and validate before saving.
- Use native password fields with inset visibility icons and editable common request-header suggestions; simplify mobile sync settings.
- Show schedule start times in category details and reserve a fading note/bill footer on item cards.
- Route Android AI completion and streaming through system HTTPS, matching model discovery while retaining certificate checks.
- Load settings, chat and statistics on demand; show a startup surface and release idle mobile compositing layers.

- AI 服务商在对应行展开；切换类型保留通用字段，标识必填项并在保存时校验。
- 密码默认隐藏，框内眼睛切换，支持原生复制粘贴；请求头支持常用字段建议，精简移动端同步布局。
- 日程分类明细仅显示起始时间；物品卡片预留备注和账单两行，长文字渐隐。
- Android 测试、聊天及流式回复统一使用系统 HTTPS，与模型获取保持一致并保留证书校验。
- 设置、聊天与统计按需加载，增加启动占位并释放移动端静止页面的合成层。

---

# ChronoEon · 时元 v0.1.0

时元是一款本地优先的日程、任务、日记、灵感、收支与物品管理应用，支持 Windows、macOS、Linux 和 Android。

- **时间与任务**：列表、日、周、月视图，多日历、分类、标签、重复安排、提醒与计时记录。
- **记录与灵感**：日记和随心记、照片附件、按组整理的灵感藤蔓。
- **收支与物品**：收支分类、支付方式、统计与热力图；物品照片、金额、地点与备注管理。
- **智能助手**：离线自然语言快速录入；可选自定义 AI 服务，识别文字和图片生成待确认草稿，随心问结合本地记录检索并流式回答。
- **搜索与整理**：全局搜索、多条件筛选、跨条目及物品的批量替换预览、操作历史与恢复。
- **数据与同步**：SQLite 本地存储，WebDAV 跨设备同步、冲突保留、快照与回收站；条目 CSV 和设置 JSON 导入导出。
- **个性化**：简体中文 / English、明暗主题，适配桌面和手机。

下载下方对应平台的安装包。Windows 提供 exe / MSI，macOS 提供通用 DMG，Linux 提供 AppImage / deb，Android 提供 arm64 APK。

---

ChronoEon is a local-first app for schedules, tasks, journals, ideas, expenses and belongings, available on Windows, macOS, Linux and Android.

- **Time and tasks**: list, day, week and month views; multiple calendars, categories, tags, recurring entries, reminders and time tracking.
- **Journals and ideas**: quick notes, diary entries, photo attachments and grouped ideas on the vine.
- **Expenses and belongings**: income/expense categories, payment methods, statistics and heatmaps; item photos, costs, locations and notes.
- **AI assistance**: offline natural-language capture; optional custom AI providers for text/image drafts and streamed answers grounded in local record searches. Review drafts before saving.
- **Search and organization**: global search, filters, reviewed batch replacements across entries and items, recoverable operation history.
- **Data and sync**: local SQLite storage; WebDAV synchronization, preserved conflicts, snapshots and Recycle Bin; CSV entry and JSON settings import/export.
- **Personalization**: English / Simplified Chinese, light/dark themes and desktop/mobile layouts.

Choose an installer below: Windows exe / MSI, universal macOS DMG, Linux AppImage / deb, or Android arm64 APK.
