package app.chronoeon.desktop

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** All callers live in :timing. Preferences contain only configuration and
 * disposable delivery receipts; entries and the running session stay in SQLite. */
object TimingRuntime {
    const val ACTION_ALARM = "app.chronoeon.TIMING_ALARM"
    private const val ALARM_ID = 4712
    private const val REMINDER_CHANNEL = "chronoeon.reminders"
    fun preferences(context: Context) = context.getSharedPreferences("timing-runtime", Context.MODE_PRIVATE)
    fun chinese(context: Context) = preferences(context).getString("language", "en")?.startsWith("zh") == true
    fun launchIntent(context: Context): PendingIntent {
        val intent = Intent().setClassName(context, context.packageName + ".MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 4710, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(context, ALARM_ID,
        Intent(context, TimingReceiver::class.java).setAction(ACTION_ALARM), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun exactAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 31 || (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
    private fun remembered(context: Context, key: String): LinkedHashSet<String> {
        val array = try { JSONArray(preferences(context).getString(key, "[]") ?: "[]") } catch (_: Exception) { JSONArray() }
        return ReminderPlanner.recentKeys((0 until array.length()).map { array.optString(it) }, System.currentTimeMillis())
    }
    @Synchronized fun bindDatabase(context: Context, database: String) {
        val file = File(database).canonicalFile
        require(file.name == "chronoeon.db" && file.path.startsWith(File(context.applicationInfo.dataDir).canonicalPath + File.separator)) { "timing-invalid-database" }
        if (preferences(context).getString("database", null) != file.path) check(preferences(context).edit().putString("database", file.path).commit())
    }
    @Synchronized fun configure(context: Context, database: String, language: String, enabled: Boolean): JSONObject {
        val file = File(database).canonicalFile
        require(file.name == "chronoeon.db" && file.path.startsWith(File(context.applicationInfo.dataDir).canonicalPath + File.separator)) { "timing-invalid-database" }
        check(preferences(context).edit().putString("database", file.path).putString("language", language).putBoolean("reminders", enabled).commit()) { "timing-config-write-failed" }
        if (!enabled) preferences(context).edit().remove("pending").commit()
        reconcile(context)
        return status(context)
    }
    @Synchronized fun status(context: Context): JSONObject {
        val restricted = Build.VERSION.SDK_INT >= 28 && (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isBackgroundRestricted
        return JSONObject().put("exactAlarms", exactAllowed(context)).put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("timerRunning", TimerService.runningId != null).put("batteryRestricted", restricted)
            .put("nextAlarmAt", preferences(context).getLong("nextAlarmAt", 0))
    }
    @Synchronized fun reconcile(context: Context, inApp: Boolean = false) {
        val prefs = preferences(context)
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!prefs.getBoolean("reminders", false)) {
            alarms.cancel(alarmIntent(context)); prefs.edit().remove("nextAlarmAt").commit(); return
        }
        val delivered = remembered(context, "delivered")
        val records = TimingStore.open(context).use { it.reminders() }
        val plan = ReminderPlanner.plan(records, System.currentTimeMillis(), delivered = delivered)
        if (plan.due.isNotEmpty()) {
            val sent = notify(context, plan.due)
            if (sent || inApp) {
                val pending = remembered(context, "pending")
                plan.due.forEach { delivered.add(it.key); pending.add(it.key) }
                check(prefs.edit().putString("delivered", JSONArray(delivered.toList()).toString())
                    .putString("pending", JSONArray(pending.toList()).toString()).commit()) { "timing-receipt-write-failed" }
            }
        }
        val next = plan.nextAt
        alarms.cancel(alarmIntent(context))
        if (next != null && exactAllowed(context)) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarmIntent(context))
            prefs.edit().putLong("nextAlarmAt", next).commit()
        } else prefs.edit().remove("nextAlarmAt").commit()
    }
    @Synchronized fun consume(context: Context): JSONArray {
        reconcile(context, true)
        val pending = JSONArray(remembered(context, "pending").toList())
        return pending
    }
    @Synchronized fun acknowledge(context: Context, keys: List<String>) {
        val pending = remembered(context, "pending")
        pending.removeAll(keys.toSet())
        check(preferences(context).edit().putString("pending", JSONArray(pending.toList()).toString()).commit())
    }
    @Synchronized fun syncTimer(context: Context): JSONObject {
        val session = TimingStore.open(context).use { it.timer() }
        if (TimingStore.running(session)) androidx.core.content.ContextCompat.startForegroundService(context, Intent(context, TimerService::class.java))
        else context.stopService(Intent(context, TimerService::class.java))
        return status(context)
    }
    @Synchronized fun timerSnapshot(context: Context): JSONObject? = TimingStore.open(context).use { store ->
        val running = TimerService.runningId
        if (running != null) store.heartbeat(running) else store.timer()
    }
    private fun notify(context: Context, due: List<ReminderFire>): Boolean {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return false
        val zh = chinese(context)
        if (Build.VERSION.SDK_INT >= 26) {
            val system = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            system.createNotificationChannel(NotificationChannel(REMINDER_CHANNEL, if (zh) "日程提醒" else "Entry reminders", NotificationManager.IMPORTANCE_DEFAULT))
            if (system.getNotificationChannel(REMINDER_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
        }
        fun title(fire: ReminderFire) = (if (zh) fire.entry.titleZh.ifBlank { fire.entry.title } else fire.entry.title).ifBlank { if (zh) "日程提醒" else "Entry reminder" }
        fun send(tag: String, body: String) {
            val notification = NotificationCompat.Builder(context, REMINDER_CHANNEL).setSmallIcon(R.drawable.ic_stat_timer)
                .setContentTitle(if (zh) "时元 · 日程提醒" else "ChronoEon · Reminder").setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(launchIntent(context))
                .setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_REMINDER).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
            manager.notify(tag, 4713, notification)
        }
        return try {
            if (due.size > 3) send("chronoeon.reminders.batch", (if (zh) "${due.size} 条提醒\n" else "${due.size} reminders\n") + due.take(3).joinToString(" · ") { title(it) })
            else for (fire in due) {
                val whenText = fire.date.toString() + " " + (fire.time?.toString() ?: if (zh) "全天" else "All day")
                val detail = listOf(whenText, fire.entry.location, fire.entry.note.replace(Regex("\\s+"), " ").take(100)).filter { it.isNotBlank() }.joinToString(" · ")
                send("chronoeon.reminder." + fire.entry.id, title(fire) + "\n" + detail)
            }
            true
        } catch (_: SecurityException) { false }
    }
}
