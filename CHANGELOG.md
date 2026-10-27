# Changelog / 更新记录

## 3.0.3 — 2026-10-27

### English

- Capture sends images and optional text to the active AI model, using representative local naming and category habits. Text stays on-device by default, with an explicit Refine with AI action and editable review.
- Ask bounds and deduplicates read-only tool requests and keeps simple answers concise. Photo-only messages are supported.
- WebDAV is the sole sync transport. Compressed immutable changes and content-addressed photos remain incremental; conditional GETs reduce idle traffic. Atomic first publication and conditional updates support Nutstore's WebDAV behavior.
- Automatically reclaim unreferenced local photos while protecting live items, pending capture reviews and seven-day recovery history.
- New original blue/gold time-orbit and 元 icon, improved syntax help, and distinct bilingual bill, schedule and item statistics headings.
- Remove the mini window, its shortcuts and the idea-to-task action. Settings explain image parsing and first-device/multi-device synchronization.

### 简体中文

- 随心记图片和可选文字共用当前 AI 模型，参考少量代表性历史记录的命名与分类习惯；文字默认本地解析，可点击“AI 优化”并核对字段。
- 随心问限制并去重只读工具调用，简单问题简洁回答；支持只发图片。
- 同步全面转为 WebDAV，使用压缩增量日志与内容寻址图片，条件读取减少空闲流量；首次原子发布及条件更新适配坚果云的实际行为。
- 自动回收无引用本地照片，保留有效物品、待确认草稿和七天可恢复历史引用。
- 新增原创蓝黄时间环与“元”字图标，优化快捷语法，账单、日程及物品统计使用各自中英文标题。
- 删除迷你视图及快捷键、灵感转任务操作，设置说明图片解析与首次及多设备同步。

## 3.0.2 — 2026-10-19

### English
- Second UX review: correct the Assets page title and filtered empty states; give calendar dates full localized accessible names and photo-viewer controls 44px touch targets.
- Display each photo as soon as it resolves, without waiting for the rest of the album. Make every matching asset and entry reachable through paged search results.
- Fix ascending/descending asset costs, date-picker bounds and complete weeks (including live week-start changes), and category names submitted with whitespace or Chinese IME Enter.
- Distinguish opening a release page from installing an update and restore update checks after the system handoff.
- UX review: keep select popups on the modal dismissal stack with one keyboard focus stop; show years for cross-year/historical dates and clear saving feedback in record/asset editors.
- Give photo removal a 44px touch target while keeping its compact appearance; show a missing-photo state when image bytes cannot load.
- Fix arrow-key navigation across mixed search results, tag completion after candidate updates, and calendar name validation/Chinese IME submission.
- Merge photo imports into the latest selection with deduplication and an in-flight lock; keep the interface usable when preference storage is denied or full, and remove obsolete preference-key reads.
- Day and week views project the visible range once instead of rescanning every entry per day; chat message bubbles no longer re-render for each draft keystroke and search filtering is deferred.
- Dialogs trap Tab and return focus to the control that opened them; Escape and Android back still close exactly one layer.
- Sync reuses the attachment hash set for five minutes, skips unchanged rows when applying a snapshot, prefetches entity states during flush and writes the sequence/lamport counters once per flush.
- Operation history loads with one grouped query; schema v16 adds ordering and calendar range indexes; startup uses `quick_check` instead of the full integrity check.
- Add a confirmed Data → Unused photos cleanup: only canonical files older than 24 hours and unreferenced by live or seven-day-history data are removed.
- Move the remaining AI provider and operation-history copy into the shared catalog, remove dead animation/blur CSS left behind by the motion kill switch (about 10 KB in the built stylesheet), and split chat rows, the location input and the toast into focused modules.

### 简体中文
- 第二轮体验审查：修正物品页标题及搜索空状态；日期格提供完整本地化名称，照片预览控件触屏区域增至 44px。
- 照片逐张就绪即显示，不再等待整组；搜索支持加载更多，可访问全部匹配物品与记录。
- 修复物品金额升降序、日期选择边界和月末整周（含即时周起始设置）、分类空白命名与中文输入法回车误提交。
- 区分打开发行页与安装更新，系统交接后恢复检查更新按钮。
- 体验审查：下拉选择器统一接入弹层关闭机制，键盘仅停留在触发器；跨年及非当前年日期显示年份，记录/物品编辑器明确显示保存中状态。
- 照片移除按钮提供 44px 触屏区域并保持紧凑外观；图片读取失败显示缺失提示。
- 修复混排搜索结果方向键导航、候选更新后的标签补全，以及日历名称校验与中文输入法误提交。
- 照片导入按最新选择合并、去重并防止重复进行；偏好存储被拒绝或配额已满时界面仍可用，移除旧偏好键读取。
- 日/周视图一次投影可见日期范围，不再逐日重扫全部记录；聊天消息气泡不会因输入框每次按键而重渲染，全局搜索改为延迟过滤。
- 弹窗限制 Tab 焦点并在关闭后还给触发控件；Escape 与 Android 返回仍只关闭一层。
- 同步在 5 分钟内复用附件哈希集合，应用快照时跳过未变化的行，flush 时预取实体状态并将 sequence/lamport 计数改为每次 flush 写入一次。
- 操作历史改为单次分组查询；schema v16 增加排序与日历范围索引；启动检查改用 `quick_check`，不再执行全量完整性检查。
- 数据设置新增确认式“清理未引用图片”：仅删除超过 24 小时、且不被现存数据或 7 天历史引用的规范文件。
- 其余 AI 服务与操作历史文案迁入共享文案表；移除动效总开关遗留的动画/模糊死代码（构建后样式约减少 10 KB），并把聊天消息行、地点输入和提示条拆成独立模块。

## 3.0.1 — 2026-10-13

### English
- Select DayView items with one click/tap and edit with a double click/tap on desktop and mobile; selected resize edges remain visible.
- Fix native Ask context limits, long-conversation requests and reasoning-only responses; compact and deduplicate complete local records for analysis.
- Include food records across entry types in dietary reviews. Fix mobile timer layout and capture recurrence/notes suggestions.
- Include the pending capture, provider settings, history and device refinements validated by the complete test suite.

### 简体中文
- 桌面和移动端日视图统一为单击选中、双击编辑，选中后清晰显示调整边界。
- 修复原生随心问上下文限制、长对话请求及仅返回思考内容的问题；分析上下文完整压缩、去重。
- 饮食回顾检索跨类型记录；修复移动端计时布局、随心记重复截止显示及备注候选。
- 纳入通过完整测试的随心记、模型设置、操作历史及设备功能优化。

## 0.3.0 — 2026-10-04

### English
- Reliable mobile calendar gestures: outward swipes at the week boundary, deliberate long-press resizing, local 5/10-minute resize increments, and edge autoscroll for cross-day selection.
- Independent seven-day operation history and recycle bin. Inspect and restore changes with conflict checks; rebuilding sync snapshots never empties recovery data.
- Sync only user catalogs, calendar defaults and currency configuration. Language, theme, display, input and device preferences stay local.
- Local-first capture: explicit commands, focus-safe vertical caret completions, history-backed location candidates, asset-aware filtering/search, comma-safe record splitting, recurrence/reminders, manual-edit protection, and confirmed bill/asset links.
- Improved narrow-screen English layouts. Desktop release CI now uses Node 24, required by `node:sqlite`; Android also runs the full check gate.

### 简体中文
- 修复周视图滚动边界切换；日视图边缘需长按才调整时段，支持本机 5/10 分钟粒度及跨天选择时的边缘自动滚动。
- 新增独立保留 7 天的操作历史，可查看与恢复并检查后续修改冲突。回收站同样独立保留 7 天，重建快照不清空两者。
- 仅同步用户分类、日历默认配置和币种配置；语言、主题、显示、输入与设备偏好留在本机。
- 升级本地随心记：快捷命令、聚焦时跟随光标的竖向补全、历史地点候选、物品筛选/搜索、逗号不拆分记录、重复/提醒、人工修改保护，以及确认后的账目/物品关联。
- 改善英文窄屏布局。桌面发布使用支持 `node:sqlite` 的 Node 24；Android 发布也执行完整检查。

### Quick capture / 快捷录入
- `/task`, `/event`, `/bill`, `/idea`, `/asset` select the type / 指定类型。
- `@"Meeting room"` location / 地点；`#work` tag / 标签；`%category` category / 分类（支持补全）。
- `!high` importance / 重要性；`!!high` urgency / 紧急性；`&name` choose a linked item / 选择关联对象。
- Example / 示例：`/task 明天下午3点开会 @"会议室 A" #工作 !high 提前15分钟提醒`。
- Ambiguous fields require confirmation; unsupported combinations remain unsaved rather than being guessed. / 歧义字段需确认，不支持的组合不会被猜测保存。
