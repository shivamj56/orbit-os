package com.gathin.tvhome;

import java.time.LocalDate;
import java.time.MonthDay;

/**
 * The days Home dresses up for by itself: the greeting says so, and the room's light and the dust in it take the day's two
 * colours. Days on the Gregorian calendar repeat every year. The lunar ones move, so each has its own dates, written down in
 * November 2026 from panchang listings that agreed with each other; where they disagreed by a day the window covers both.
 * Chhath 2027 is reckoned as the sixth and seventh day after Diwali, as it falls. Past 2027 only the fixed days remain until
 * this list is extended.
 */
final class HomeDays {

    static final class Day {
        final String title, line;
        /** The room's two colours on this day, 0xAARRGGBB. */
        final int glow, glow2;
        /** Whether the owner's name goes after the title ("Happy Diwali, Shiv"); not after a salutation. */
        final boolean named;

        Day(String title, String line, int glow, int glow2, boolean named) {
            this.title = title;
            this.line = line;
            this.glow = glow;
            this.glow2 = glow2;
            this.named = named;
        }
    }

    private static final int SAFFRON = 0xFFFF9933, INDIA_GREEN = 0xFF1FA34A, GOLD = 0xFFFFB23C, EMBER = 0xFFFF7A1A;

    private static final Day NEW_YEAR = new Day("Happy New Year", "May this year be your best one yet", GOLD, 0xFFFFE6A8, true);
    private static final Day LOHRI = new Day("Happy Lohri", "The bonfire's warmth to you and yours", EMBER, 0xFFFFC24D, true);
    private static final Day SANKRANTI = new Day("Happy Makar Sankranti", "May your kites fly high", 0xFFFFB300, 0xFFFF4D8D, true);
    private static final Day REPUBLIC = new Day("Happy Republic Day", "Jai Hind", SAFFRON, INDIA_GREEN, true);
    private static final Day INDEPENDENCE = new Day("Happy Independence Day", "Jai Hind", SAFFRON, INDIA_GREEN, true);
    private static final Day CHRISTMAS = new Day("Merry Christmas", "Joy to you and everyone at home", 0xFFFF3B3B, 0xFF27D17F, true);
    private static final Day NEW_YEARS_EVE = new Day("Happy New Year's Eve", "One more night of this year", GOLD, 0xFFE9B3FF, true);

    private static final Day CHHATH = new Day("Happy Chhath Puja", "Jai Chhathi Maiya", 0xFFFF8A3D, 0xFFFFD15C, true);
    private static final Day GURPURAB = new Day("Happy Gurpurab", "Wishing you peace and light", SAFFRON, 0xFF3D6BFF, true);
    private static final Day SHIVRATRI = new Day("Har Har Mahadev", "Happy Maha Shivratri", 0xFF3D6BFF, 0xFFB9C4FF, false);
    private static final Day HOLI = new Day("Happy Holi", "Colour everything today", 0xFFFF3FA4, 0xFF2FD3FF, true);
    private static final Day RAKHI = new Day("Happy Raksha Bandhan", "For the bond that always holds", 0xFFFF4D6D, GOLD, true);
    private static final Day JANMASHTAMI = new Day("Happy Janmashtami", "Jai Shri Krishna", 0xFF1FA2FF, 0xFFFFD34D, true);
    private static final Day GANESH = new Day("Ganpati Bappa Morya", "Happy Ganesh Chaturthi", 0xFFFF8A00, 0xFFFF3D3D, false);
    private static final Day NAVRATRI = new Day("Happy Navratri", "Nine nights of light", 0xFFFF3D6E, 0xFFFFB23C, true);
    private static final Day DUSSEHRA = new Day("Happy Dussehra", "May good always win", EMBER, GOLD, true);
    private static final Day DIWALI = new Day("Happy Diwali", "May the lights find you", GOLD, EMBER, true);

    /** Lunar days: first and last date, inclusive, and the day. */
    private static final Object[][] DATED = {
            {"2026-11-13", "2026-11-16", CHHATH},
            {"2026-11-24", "2026-11-24", GURPURAB},
            {"2027-03-06", "2027-03-06", SHIVRATRI},
            {"2027-03-21", "2027-03-22", HOLI},
            {"2027-08-17", "2027-08-17", RAKHI},
            {"2027-08-24", "2027-08-25", JANMASHTAMI},
            {"2027-09-04", "2027-09-04", GANESH},
            {"2027-10-01", "2027-10-08", NAVRATRI},
            {"2027-10-09", "2027-10-10", DUSSEHRA},
            {"2027-10-28", "2027-10-30", DIWALI},
            {"2027-11-02", "2027-11-05", CHHATH},
    };

    private HomeDays() {
    }

    /** The day's dress, or null on an ordinary day. */
    static Day on(LocalDate date) {
        for (Object[] row : DATED) {
            if (!date.isBefore(LocalDate.parse((String) row[0])) && !date.isAfter(LocalDate.parse((String) row[1]))) return (Day) row[2];
        }
        MonthDay md = MonthDay.from(date);
        if (md.equals(MonthDay.of(1, 1))) return NEW_YEAR;
        if (md.equals(MonthDay.of(1, 13))) return LOHRI;
        if (md.equals(MonthDay.of(1, 14)) || md.equals(MonthDay.of(1, 15))) return SANKRANTI;
        if (md.equals(MonthDay.of(1, 26))) return REPUBLIC;
        if (md.equals(MonthDay.of(8, 15))) return INDEPENDENCE;
        if (md.equals(MonthDay.of(12, 24)) || md.equals(MonthDay.of(12, 25))) return CHRISTMAS;
        if (md.equals(MonthDay.of(12, 31))) return NEW_YEARS_EVE;
        return null;
    }
}
