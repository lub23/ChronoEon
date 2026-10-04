# Changelog / 更新记录

## 0.3.0 — 2026-10-04

### English
- Reliable mobile calendar gestures: outward swipes at the week boundary, deliberate long-press resizing, local 5/10-minute resize increments, and edge autoscroll for cross-day selection.
- Independent seven-day operation history and recycle bin. Inspect and restore changes with conflict checks; rebuilding sync snapshots never empties recovery data.
- Sync only user catalogs, calendar defaults and currency configuration. Language, theme, display, input and device preferences stay local.
- Local-first capture: explicit commands, prefix-based field completions, history-backed location candidates, comma-safe record splitting, recurrence/reminders, manual-edit protection, and confirmed bill/asset links.
- Improved narrow-screen English layouts. Desktop release CI now uses Node 24, required by `node:sqlite`; Android also runs the full check gate.

### 简体中文
- 修复周视图滚动边界切换；日视图边缘需长按才调整时段，支持本机 5/10 分钟粒度及跨天选择时的边缘自动滚动。
- 新增独立保留 7 天的操作历史，可查看与恢复并检查后续修改冲突。回收站同样独立保留 7 天，重建快照不清空两者。
- 仅同步用户分类、日历默认配置和币种配置；语言、主题、显示、输入与设备偏好留在本机。
- 升级本地随心记：快捷命令、前缀字段补全、历史地点候选、逗号不拆分记录、重复/提醒、人工修改保护，以及确认后的账目/物品关联。
- 改善英文窄屏布局。桌面发布使用支持 `node:sqlite` 的 Node 24；Android 发布也执行完整检查。

### Quick capture / 快捷录入
- `/task`, `/event`, `/bill`, `/idea`, `/asset` select the type / 指定类型。
- `@"Meeting room"` location / 地点；`#work` tag / 标签；`%category` category / 分类（支持补全）。
- `!high` importance / 重要性；`!!high` urgency / 紧急性；`&name` choose a linked item / 选择关联对象。
- Example / 示例：`/task 明天下午3点开会 @"会议室 A" #工作 !high 提前15分钟提醒`。
- Ambiguous fields require confirmation; unsupported combinations remain unsaved rather than being guessed. / 歧义字段需确认，不支持的组合不会被猜测保存。
