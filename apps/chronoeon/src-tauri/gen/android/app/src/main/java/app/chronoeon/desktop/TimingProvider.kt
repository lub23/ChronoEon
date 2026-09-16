package app.chronoeon.desktop

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import org.json.JSONObject

/** Non-exported process boundary. Opening the app is not required to run alarms,
 * and the lightweight :timing process never loads Tauri or the speech model. */
class TimingProvider : ContentProvider() {
    override fun onCreate() = true
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        val context = context ?: error("timing-context-unavailable")
        extras?.getString("database")?.let { TimingRuntime.bindDatabase(context, it) }
        val result: Any = when (method) {
            "sync" -> TimingRuntime.configure(context, extras!!.getString("database")!!, extras.getString("language", "en"), extras.getBoolean("reminders"))
            "timerSync" -> TimingRuntime.syncTimer(context)
            "timerSnapshot" -> JSONObject().put("session", TimingRuntime.timerSnapshot(context) ?: JSONObject.NULL)
            "consumeReminders" -> JSONObject().put("keys", TimingRuntime.consume(context))
            "ackReminders" -> { TimingRuntime.acknowledge(context, extras?.getStringArrayList("keys") ?: emptyList()); JSONObject() }
            "status" -> TimingRuntime.status(context)
            else -> error("timing-command-unknown")
        }
        return Bundle().apply { putString("result", result.toString()) }
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
}
