package app.chronoeon.desktop

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** Reads the SAME app-owned SQLite database, never a second user-data store.
 * Heartbeats use compare-and-swap so they cannot overwrite UI edits/pause/delete. */
class TimingStore private constructor(private val db: SQLiteDatabase) : AutoCloseable {
    override fun close() = db.close()
    fun timer(): JSONObject? = db.rawQuery("SELECT payload_json FROM timer_session WHERE id = 'active'", null).use {
        if (it.moveToFirst()) JSONObject(it.getString(0)) else null
    }
    fun heartbeat(id: String, now: Long = System.currentTimeMillis()): JSONObject? {
        val raw = db.rawQuery("SELECT payload_json FROM timer_session WHERE id = 'active'", null).use { if (it.moveToFirst()) it.getString(0) else null } ?: return null
        val current = JSONObject(raw)
        if (current.optString("id") != id || !running(current)) return current
        current.put("lastTick", maxOf(current.optLong("lastTick"), now))
        db.compileStatement("UPDATE timer_session SET payload_json = ?, updated_at = ? WHERE id = 'active' AND payload_json = ?").use {
            it.bindString(1, current.toString()); it.bindString(2, Instant.ofEpochMilli(now).toString()); it.bindString(3, raw)
            if (it.executeUpdateDelete() != 1) return timer()
        }
        return current
    }
    fun reminders(): List<ReminderRecord> {
        val result = mutableListOf<ReminderRecord>()
        db.rawQuery("SELECT id, title, title_zh, modality, date, start_time, all_day, reminder, status, recurrence, recurring_days, recurring_end, recurrence_exceptions, recurrence_moves, location, note FROM entries WHERE reminder IS NOT NULL AND reminder <> 'none' AND (recurrence IS NOT NULL OR date >= ?)", arrayOf(LocalDate.now().minusDays(8).toString())).use { row ->
            while (row.moveToNext()) {
                try {
                    val days = JSONArray(row.text("recurring_days").ifBlank { "[]" })
                    val exceptions = JSONObject(row.text("recurrence_exceptions").ifBlank { "{}" })
                    val moves = JSONObject(row.text("recurrence_moves").ifBlank { "{}" })
                    val moved = mutableMapOf<LocalDate, ReminderMove>()
                    for (key in moves.keys()) {
                        val begin = moves.optJSONObject(key)?.optString("begin") ?: continue
                        val match = Regex("^(\\d{4}-\\d{2}-\\d{2})(?:[ T](\\d{1,2}):([0-5]\\d)(?::[0-5]\\d)?)?$").matchEntire(begin.trim()) ?: continue
                        moved[LocalDate.parse(key)] = ReminderMove(LocalDate.parse(match.groupValues[1]), if (match.groupValues[2].isEmpty()) null else LocalTime.of(match.groupValues[2].toInt(), match.groupValues[3].toInt()))
                    }
                    result.add(ReminderRecord(
                        id = row.text("id"), title = row.text("title"), titleZh = row.text("title_zh"), kind = row.text("modality"),
                        date = LocalDate.parse(row.text("date")), start = row.text("start_time").takeIf { it.isNotBlank() }?.let { LocalTime.parse(it) },
                        allDay = row.text("all_day") == "1", reminder = row.text("reminder"), status = row.text("status"),
                        recurrence = row.text("recurrence").ifBlank { "none" }, weekdays = (0 until days.length()).map { days.optInt(it, -1) }.filter { it in 0..6 }.toSet(),
                        recurringEnd = row.text("recurring_end").takeIf { it.isNotBlank() }?.let { LocalDate.parse(it) },
                        exceptions = exceptions.keys().asSequence().associate { LocalDate.parse(it) to (exceptions.optJSONObject(it)?.optString("status") ?: "") },
                        moves = moved, location = row.text("location"), note = row.text("note")
                    ))
                } catch (_: Exception) { /* An invalid imported row cannot prevent other reminders. */ }
            }
        }
        return result
    }
    private fun Cursor.text(column: String): String = getString(getColumnIndexOrThrow(column)) ?: ""
    companion object {
        fun open(context: Context): TimingStore {
            val configured = TimingRuntime.preferences(context).getString("database", null) ?: error("timing-not-configured")
            val file = File(configured).canonicalFile
            require(file.name == "chronoeon.db" && file.path.startsWith(File(context.applicationInfo.dataDir).canonicalPath + File.separator) && file.isFile) { "timing-database-unavailable" }
            val db = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.NO_LOCALIZED_COLLATORS or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING)
            db.rawQuery("PRAGMA busy_timeout = 3000", null).use { it.moveToFirst() }
            return TimingStore(db)
        }
        fun running(session: JSONObject?): Boolean {
            val segments = session?.optJSONArray("segments") ?: return false
            return segments.length() > 0 && !segments.getJSONObject(segments.length() - 1).has("end")
        }
        fun elapsed(session: JSONObject, now: Long): Long {
            val segments = session.getJSONArray("segments")
            return (0 until segments.length()).sumOf { index ->
                val segment = segments.getJSONObject(index)
                maxOf(0, (if (segment.has("end")) segment.getLong("end") else now) - segment.getLong("start"))
            }
        }
    }
}
