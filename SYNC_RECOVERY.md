# WebDAV 同步排障 / WebDAV sync recovery

SQLite 是唯一权威用户数据源。跨设备同步使用 WebDAV；本地索引和同步缓存可重建。排障前先在“设置 → 数据”导出备份，并保留各设备尚未同步的记录和照片。

SQLite is the authoritative store. Cross-device sync uses WebDAV; local indexes and sync caches are disposable. Export a backup under Settings → Data first, preserving unsynced records and photos on every device.

## 检查顺序 / Checks

1. 确认设备连接的是同一个 HTTPS WebDAV 地址、目录和数据集；不要用空目录覆盖有数据的远端。
   Verify the same HTTPS WebDAV URL, folder and dataset on each device; do not overwrite a populated remote with an empty dataset.
2. 检查用户名、密码、目录读写权限、设备时间和网络代理。401/403 需要修正凭据或权限，重试本身不能解决。
   Check credentials, folder read/write access, device time and proxy. Correct 401/403 authentication or permission failures before retrying.
3. 等其他设备完成同步后手动重试。服务须支持 ETag/If-Match 条件写入；应用也会在服务支持时使用 WebDAV 锁。
   Wait for other devices to finish, then retry. The server must support ETag/If-Match conditional writes; the app also uses WebDAV locks when supported.
4. 在冲突列表选择正确版本。校验失败、对象缺失或数据集不一致时保留错误详情和备份，先核对远端；不要直接删除数据库或远端目录。
   Resolve preserved conflicts in the conflict list. For checksum failures, missing objects or dataset mismatches, preserve diagnostics and backups and verify the remote before changing data.

## 常见问题 / Common failures

| 问题 / Failure | 处理 / Action |
| --- | --- |
| TLS / 证书错误 / Certificate error | 校正系统时间、代理和服务器证书链；不关闭证书验证。 / Correct time, proxy and server certificate chain; keep certificate verification enabled. |
| 服务不支持条件写入 / Missing conditional writes | 使用支持 ETag/If-Match 的 WebDAV 服务。 / Use a WebDAV provider with ETag/If-Match support. |
| 空间不足、只读目录 / Full or read-only storage | 释放空间并修复目录权限，保留应用数据。 / Free space and correct permissions while preserving app data. |
| 缺少照片 / Missing photos | 先从原设备或备份补回；双方都不存在时无法重新生成。 / Restore from the source device or backup; absent originals cannot be recreated. |
| 快照维护失败 / Snapshot maintenance failure | 先解决同一远端的网络、权限或并发问题；重建快照不能绕过校验。 / Resolve remote connectivity, access or concurrency first; rebuilding snapshots does not bypass validation. |

应用在停止编辑 15 秒后上传，每 5 分钟检查其他设备。排障时也可手动同步；不要清除应用数据来尝试恢复未同步内容。

The app uploads after 15 seconds without edits and checks peers every five minutes. Manual sync is available; clearing app data cannot recover unsynced content.
