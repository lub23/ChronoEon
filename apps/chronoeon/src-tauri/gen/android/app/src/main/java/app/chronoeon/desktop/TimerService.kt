package app.chronoeon.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.concurrent.Executors

/** Separate native process: no Activity, WebView, speech model or polling JS.
 * Android renders the notification chronometer; timestamps track elapsed time.
 * The minute heartbeat does not take a wake lock or keep a sleeping CPU awake. */
class TimerService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var foreground = false
    private var destroyed = false
    private val heartbeat = object : Runnable {
        override fun run() { refresh(); if (!destroyed) main.postDelayed(this, 60_000) }
    }
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL, if (TimingRuntime.chinese(this)) "后台计时（静音）" else "Background timer (silent)", NotificationManager.IMPORTANCE_LOW)
            channel.setSound(null, null); channel.enableVibration(false); channel.setShowBadge(false)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!foreground) {
            val card = notification(null)
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, card, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(ID, card)
            foreground = true
            main.postDelayed(heartbeat, 60_000)
        }
        refresh()
        return START_STICKY
    }
    private fun refresh() {
        if (destroyed) return
        worker.execute {
            try {
                val session = TimingStore.open(this).use { store ->
                    val current = store.timer()
                    if (!TimingStore.running(current)) current
                    else {
                        val id = current!!.getString("id")
                        val now = System.currentTimeMillis()
                        // A live service is evidence of continuity across deep sleep.
                        // A restarted service cannot invent time after a long kill.
                        if (runningId != id && now - current.optLong("lastTick", current.optLong("createdAt")) > 90_000) null
                        else store.heartbeat(id, now)
                    }
                }
                main.post {
                    if (destroyed) return@post
                    if (!TimingStore.running(session)) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return@post }
                    runningId = session!!.getString("id")
                    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(ID, notification(session))
                }
            } catch (_: Exception) {
                main.post { if (!destroyed) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() } }
            }
        }
    }
    private fun notification(session: JSONObject?): Notification {
        val zh = TimingRuntime.chinese(this)
        val now = System.currentTimeMillis()
        val title = session?.optString("title")?.takeIf { it.isNotBlank() } ?: if (zh) "计时" else "Timer"
        val builder = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle((if (zh) "正在计时 · " else "Timing · ") + title)
            .setContentText(if (zh) "静音后台计时 · 点击返回时元" else "Silent background timer · Tap to return")
            .setContentIntent(TimingRuntime.launchIntent(this)).setOnlyAlertOnce(true).setSilent(true).setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW).setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        if (session != null) builder.setWhen(now - TimingStore.elapsed(session, now)).setUsesChronometer(true).setShowWhen(true)
        return builder.build()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        destroyed = true; runningId = null
        main.removeCallbacks(heartbeat); worker.shutdownNow()
        super.onDestroy()
    }
    companion object {
        private const val CHANNEL = "chronoeon.timer.silent"
        private const val ID = 4711
        @Volatile var runningId: String? = null
            private set
    }
}
