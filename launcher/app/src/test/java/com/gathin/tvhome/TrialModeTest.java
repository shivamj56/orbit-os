package com.gathin.tvhome;

import static org.junit.Assert.assertEquals;

import java.util.Locale;

import org.junit.Test;

/** TrialMode's arithmetic: how long a trial from the phone lasts, what is left of it, and how that reads. */
public class TrialModeTest {
    @Test
    public void theLengthAskedForStaysBetweenAMinuteAndAnHour() {
        assertEquals(15 * 60_000L, TrialMode.lengthOf(900));
        assertEquals(60_000L, TrialMode.lengthOf(5));
        assertEquals(60L * 60_000L, TrialMode.lengthOf(99_999));
        assertEquals(TrialMode.DEFAULT_MS, TrialMode.lengthOf(0));
        assertEquals(TrialMode.DEFAULT_MS, TrialMode.lengthOf(-3));
    }

    @Test
    public void whatIsLeftCountsDownToNothing() {
        long length = 15 * 60_000L;
        long until = 1_000_000L + length;
        assertEquals(length, TrialMode.remaining(until, length, 1_000_000L));
        assertEquals(60_000L, TrialMode.remaining(until, length, until - 60_000L));
        assertEquals(0L, TrialMode.remaining(until, length, until));
        assertEquals(0L, TrialMode.remaining(until, length, until + 5_000L));
        assertEquals("no trial", 0L, TrialMode.remaining(0L, 0L, 1_000_000L));
    }

    @Test
    public void aClockSetBackCannotStretchTheTrial() {
        long length = 15 * 60_000L;
        long until = 10_000_000L;
        // The TV's clock went back an hour after the trial began (it set its time from the network, say).
        assertEquals(length, TrialMode.remaining(until, length, until - length - 60L * 60_000L));
    }

    @Test
    public void theClockRoundsUpToTheNextSecond() {
        assertEquals("15:00", TrialMode.clock(15 * 60_000L, Locale.ENGLISH));
        assertEquals("14:59", TrialMode.clock(15 * 60_000L - 1_000L, Locale.ENGLISH));
        assertEquals("14:59", TrialMode.clock(14 * 60_000L + 58_001L, Locale.ENGLISH));
        assertEquals("0:01", TrialMode.clock(1L, Locale.ENGLISH));
        assertEquals("0:00", TrialMode.clock(0L, Locale.ENGLISH));
        assertEquals("0:00", TrialMode.clock(-500L, Locale.ENGLISH));
        assertEquals("60:00", TrialMode.clock(60L * 60_000L, Locale.ENGLISH));
    }

    @Test
    public void theNextTickLandsOnTheNextWholeSecond() {
        assertEquals(1_000L, TrialMode.nextTick(900_000L));
        assertEquals(250L, TrialMode.nextTick(899_250L));
        assertEquals(1L, TrialMode.nextTick(1L));
    }
}
