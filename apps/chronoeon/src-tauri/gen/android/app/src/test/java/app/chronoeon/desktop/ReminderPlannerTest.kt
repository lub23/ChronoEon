package app.chronoeon.desktop

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

class ReminderPlannerTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private fun at(value: String) = java.time.LocalDateTime.parse(value).atZone(zone).toInstant().toEpochMilli()
    private fun entry(date: String = "2026-09-12") = ReminderRecord("e", "Meeting", date = LocalDate.parse(date), start = LocalTime.of(9, 0), reminder = "at-time")
    @Test fun oneShotGraceAndKeyMatchTheDomain() {
        val now = at("2026-09-12T09:01:00")
        val fire = ReminderPlanner.plan(listOf(entry()), now, zone).due.single()
        assertEquals("e:2026-09-12:" + at("2026-09-12T09:00:00"), fire.key)
        assertTrue(ReminderPlanner.plan(listOf(entry()), now + 15 * 60_000, zone).due.isEmpty())
        assertTrue(ReminderPlanner.plan(listOf(entry()), now, zone, setOf(fire.key)).due.isEmpty())
    }
    @Test fun schedulesBeforeTodayAndOnFutureDatesWithoutAHorizonCutoff() {
        val early = entry("2026-09-19").copy(allDay = true, reminder = "week-before-9am")
        assertEquals(1, ReminderPlanner.plan(listOf(early), at("2026-09-12T09:00:00"), zone).due.size)
        val far = entry("2036-01-01")
        assertEquals(at("2036-01-01T09:00:00"), ReminderPlanner.plan(listOf(far), at("2026-09-12T08:00:00"), zone).nextAt)
    }
    @Test fun allRelativeOffsetsAndAbsoluteAnchorsMatchWallClockRules() {
        val offsets = mapOf("at-time" to 0L, "5min" to 5L, "15min" to 15L, "30min" to 30L, "1hour" to 60L, "2hour" to 120L, "12hour" to 720L, "1day" to 1440L, "1week" to 10080L)
        for ((name, minutes) in offsets) {
            val expected = at("2026-09-12T09:00:00") - minutes * 60_000
            assertEquals(name, expected, ReminderPlanner.plan(listOf(entry().copy(reminder = name)), expected - 1, zone).nextAt)
        }
        for ((name, expected) in mapOf("day-9am" to "2026-09-12T09:00:00", "day-before-9am" to "2026-09-11T09:00:00", "day-before-5pm" to "2026-09-11T17:00:00", "week-before-9am" to "2026-09-05T09:00:00")) {
            val time = at(expected)
            assertEquals(name, time, ReminderPlanner.plan(listOf(entry().copy(reminder = name, allDay = true)), time - 1, zone).nextAt)
        }
    }
    @Test fun weeklyUsesSundayZeroAndHonorsItsEnd() {
        val weekly = entry("2026-09-01").copy(recurrence = "weekly", weekdays = setOf(0, 2), recurringEnd = LocalDate.parse("2026-09-15"))
        assertEquals(at("2026-09-13T09:00:00"), ReminderPlanner.plan(listOf(weekly), at("2026-09-12T09:00:00"), zone).nextAt)
        assertNull(ReminderPlanner.plan(listOf(weekly), at("2026-09-16T09:00:00"), zone).nextAt)
    }
    @Test fun monthlySkipsMissingDaysInsteadOfClampingToMonthEnd() {
        val monthly = entry("2026-01-31").copy(recurrence = "monthly")
        assertEquals(at("2026-03-31T09:00:00"), ReminderPlanner.plan(listOf(monthly), at("2026-02-01T09:00:00"), zone).nextAt)
    }
    @Test fun yearlyLeapDayCanJumpAcrossANonLeapCentury() {
        val yearly = entry("2096-02-29").copy(recurrence = "yearly")
        assertEquals(at("2104-02-29T09:00:00"), ReminderPlanner.plan(listOf(yearly), at("2097-03-01T09:00:00"), zone).nextAt)
    }
    @Test fun movedOccurrencesKeepTheirOriginalIdentityAndNewTime() {
        val old = LocalDate.parse("2025-01-02")
        val source = entry("2025-01-01").copy(recurrence = "daily", recurringEnd = LocalDate.parse("2025-01-03"), moves = mapOf(old to ReminderMove(LocalDate.parse("2026-09-12"), LocalTime.of(15, 30))))
        val fire = ReminderPlanner.plan(listOf(source), at("2026-09-12T15:30:01"), zone).due.single()
        assertEquals(old, fire.occurrence); assertEquals("2026-09-12", fire.date.toString())
        assertEquals("e:2025-01-02:" + at("2026-09-12T15:30:00"), fire.key)
    }
    @Test fun completedExceptionsAndCompletedSeriesDoNotLoopOrAlarm() {
        val day = LocalDate.parse("2026-09-12")
        val source = entry("2026-09-01").copy(kind = "task", recurrence = "daily", exceptions = mapOf(day to "done"))
        assertTrue(ReminderPlanner.plan(listOf(source), at("2026-09-12T09:01:00"), zone).due.isEmpty())
        assertEquals(at("2026-09-13T09:00:00"), ReminderPlanner.plan(listOf(source), at("2026-09-12T09:01:00"), zone).nextAt)
        assertNull(ReminderPlanner.plan(listOf(source.copy(status = "done")), at("2026-09-12T09:01:00"), zone).nextAt)
        val reopened = source.copy(status = "done", exceptions = mapOf(day to "open"))
        assertEquals(1, ReminderPlanner.plan(listOf(reopened), at("2026-09-12T09:01:00"), zone).due.size)
    }
    @Test fun cancelledMovedOccurrenceNeverFires() {
        val day = LocalDate.parse("2026-09-12")
        val source = entry().copy(kind = "task", recurrence = "daily", moves = mapOf(day to ReminderMove(day, LocalTime.of(13, 0))), exceptions = mapOf(day to "cancelled"))
        assertTrue(ReminderPlanner.plan(listOf(source), at("2026-09-12T13:00:00"), zone).due.isEmpty())
    }
    @Test fun receiptsExpireByTimeWithoutReplayingLargeBatches() {
        val now = at("2026-09-12T09:00:00")
        val keys = (0..999).map { "e" + it + ":2026-09-12:" + now } + listOf("old:2026-09-11:" + (now - 900_001), "invalid")
        assertEquals(1000, ReminderPlanner.recentKeys(keys, now).size)
        assertEquals(0, ReminderPlanner.recentKeys(keys, now + 900_001).size)
    }
    @Test fun springDstGapUsesTheSameForwardResolutionAsJavascriptDate() {
        val ny = ZoneId.of("America/New_York")
        val source = entry("2026-03-08").copy(start = LocalTime.of(2, 30))
        val expected = Instant.parse("2026-03-08T07:30:00Z").toEpochMilli()
        assertEquals(expected, ReminderPlanner.plan(listOf(source), expected - 1, ny).nextAt)
    }
}
