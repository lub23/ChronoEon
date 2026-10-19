# Changelog / 更新记录

## 3.0.2 — 2026-10-19

### English
- Day and week views project the visible range once instead of rescanning every entry per day; chat message bubbles no longer re-render for each draft keystroke and search filtering is deferred.
- Dialogs trap Tab and return focus to the control that opened them; Escape and Android back still close exactly one layer.
- Sync reuses the attachment hash set for five minutes, skips unchanged rows when applying a snapshot, prefetches entity states during flush and writes the sequence/lamport counters once per flush.
- Operation history loads with one grouped query; schema v16 adds ordering and calendar range indexes; startup uses `quick_check` instead of the full integrity check.
- Add a confirmed Data → Unused photos cleanup: only canonical files older than 24 hours and unreferenced by live or seven-day-history data are removed.
- Move the remaining AI provider and operation-history copy into the shared catalog, remove dead animation/blur CSS left behind by the motion kill switch (about 10 KB in the built stylesheet), and split chat rows, the location input and the toast into focused modules.

### 简体中文
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
