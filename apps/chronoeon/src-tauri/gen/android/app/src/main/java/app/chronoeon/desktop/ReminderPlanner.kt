package app.chronoeon.desktop

import java.time.LocalDate
import java.time.LocalTime
import java.time.MonthDay
import java.time.YearMonth
import java.time.ZoneId

/** Pure scheduling kernel for Android alarms. Its recurrence/reminder contract
 * is cross-checked against packages/domain; it does not store projected rows. */
data class ReminderRecord(
    val id: String, val title: String, val titleZh: String = "", val kind: String = "event",
    val date: LocalDate, val start: LocalTime? = null, val allDay: Boolean = false,
    val reminder: String = "none", val status: String = "", val recurrence: String = "none",
    val weekdays: Set<Int> = emptySet(), val recurringEnd: LocalDate? = null,
    val exceptions: Map<LocalDate, String> = emptyMap(), val moves: Map<LocalDate, ReminderMove> = emptyMap(),
    val location: String = "", val note: String = ""
)
data class ReminderMove(val date: LocalDate, val time: LocalTime? = null)
data class ReminderFire(val entry: ReminderRecord, val occurrence: LocalDate, val date: LocalDate, val time: LocalTime?, val at: Long) {
    val key: String get() = "${entry.id}:$occurrence:$at"
}
data class ReminderPlan(val due: List<ReminderFire>, val nextAt: Long?)

object ReminderPlanner {
    const val GRACE_MS = 15 * 60_000L
    private val offsets = mapOf("at-time" to 0L, "5min" to 5L, "15min" to 15L, "30min" to 30L, "1hour" to 60L,
        "2hour" to 120L, "12hour" to 720L, "1day" to 1440L, "1week" to 10080L)
    private val anchors = mapOf("day-9am" to Pair(0L, 9), "day-before-9am" to Pair(-1L, 9), "day-before-5pm" to Pair(-1L, 17), "week-before-9am" to Pair(-7L, 9))
    /** Only the grace window needs de-duplication. A fixed item-count cap would
     * replay the first items in a large simultaneous reminder batch. */
    fun recentKeys(keys: Iterable<String>, now: Long): LinkedHashSet<String> = keys.filter {
        it.substringAfterLast(':').toLongOrNull()?.let { stamp -> stamp >= now - GRACE_MS } == true
    }.toCollection(linkedSetOf())
    private fun complete(status: String) = status == "done" || status == "cancelled"
    fun occurs(entry: ReminderRecord, date: LocalDate): Boolean {
        if (date < entry.date || entry.recurringEnd?.let { date > it } == true) return false
        return when (entry.recurrence) {
            "daily" -> true
            "weekly" -> (entry.weekdays.ifEmpty { setOf(entry.date.dayOfWeek.value % 7) }).contains(date.dayOfWeek.value % 7)
            "monthly" -> date.dayOfMonth == entry.date.dayOfMonth
            "yearly" -> MonthDay.from(date) == MonthDay.from(entry.date)
            else -> date == entry.date
        }
    }
    private fun nextDate(entry: ReminderRecord, from: LocalDate): LocalDate? {
        val start = maxOf(from, entry.date)
        if (entry.recurringEnd?.let { start > it } == true) return null
        val next = when (entry.recurrence) {
            "daily" -> start
            "weekly" -> (0L..6L).map { start.plusDays(it) }.first { occurs(entry.copy(recurringEnd = null), it) }
            "monthly" -> {
                var month = YearMonth.from(start)
                while (entry.date.dayOfMonth > month.lengthOfMonth() || month.atDay(entry.date.dayOfMonth) < start) month = month.plusMonths(1)
                month.atDay(entry.date.dayOfMonth)
            }
            "yearly" -> {
                val day = MonthDay.from(entry.date); var year = start.year
                while (!day.isValidYear(year) || day.atYear(year) < start) year++
                day.atYear(year)
            }
            else -> if (entry.date >= from) entry.date else return null
        }
        return next.takeUnless { entry.recurringEnd?.let { end -> next > end } == true }
    }
    private fun fire(entry: ReminderRecord, occurrence: LocalDate, zone: ZoneId): ReminderFire? {
        val status = if (entry.kind == "task") entry.exceptions[occurrence] ?: entry.status else entry.status
        if (entry.kind == "task" && complete(status)) return null
        val move = if (entry.recurrence == "none") null else entry.moves[occurrence]
        val date = move?.date ?: occurrence
        val allDay = if (move != null) move.time == null else entry.allDay
        val time = if (move != null) move.time else entry.start
        val anchor = anchors[entry.reminder]
        val at = if (anchor != null) date.plusDays(anchor.first).atTime(anchor.second, 0).atZone(zone).toInstant().toEpochMilli()
            else {
                val offset = offsets[entry.reminder] ?: return null
                date.atTime(if (allDay) LocalTime.MIDNIGHT else time ?: LocalTime.MIDNIGHT).atZone(zone).toInstant().toEpochMilli() - offset * 60_000L
            }
        return ReminderFire(entry, occurrence, date, if (allDay) null else time, at)
    }
    fun plan(entries: List<ReminderRecord>, now: Long, zone: ZoneId = ZoneId.systemDefault(), delivered: Set<String> = emptySet()): ReminderPlan {
        val due = linkedMapOf<String, ReminderFire>(); var nextAt: Long? = null
        val from = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate().minusDays(8)
        fun consider(value: ReminderFire?) {
            if (value == null || delivered.contains(value.key)) return
            if (value.at > now) nextAt = minOf(nextAt ?: Long.MAX_VALUE, value.at)
            else if (now - value.at <= GRACE_MS) due[value.key] = value
        }
        for (entry in entries) {
            if (entry.reminder == "none") continue
            if (entry.recurrence == "none" || entry.recurrence.isEmpty()) { consider(fire(entry, entry.date, zone)); continue }
            // Finite moved occurrences can land arbitrarily far from their anchor.
            for (date in entry.moves.keys) if (occurs(entry, date)) consider(fire(entry, date, zone))
            if (entry.kind == "task" && complete(entry.status)) {
                // A completed series can only have finitely many reopened overrides.
                for ((date, status) in entry.exceptions) if (!complete(status) && !entry.moves.containsKey(date) && occurs(entry, date)) consider(fire(entry, date, zone))
                continue
            }
            var date = nextDate(entry, from)
            while (date != null) {
                val value = if (entry.moves.containsKey(date)) null else fire(entry, date, zone)
                consider(value)
                if (value != null && value.at > now && !delivered.contains(value.key)) break
                date = nextDate(entry, date.plusDays(1))
            }
        }
        return ReminderPlan(due.values.sortedBy { it.at }, nextAt)
    }
}
