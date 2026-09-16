package app.chronoeon.desktop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/** One OS alarm for the earliest due entry; delivery re-reads SQLite and queues
 * the next alarm. Boot/timezone/clock changes rebuild the disposable schedule. */
class TimingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val worker = Executors.newSingleThreadExecutor()
        worker.execute {
            try { TimingRuntime.reconcile(context.applicationContext) }
            catch (_: Exception) { /* Rebuilt on the next explicit app sync. Never launch a UI in the background. */ }
            finally { pending.finish(); worker.shutdown() }
        }
    }
}
