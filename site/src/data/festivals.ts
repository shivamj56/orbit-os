// The days Orbit Home dresses up for, copied from launcher/app/src/main/java/com/gathin/tvhome/HomeDays.java: the
// greeting, its line, the room's two colours, and the dates (lunar days written down through 2027, fixed days yearly).

export interface Festival {
  title: string;
  line: string;
  glow: string;
  glow2: string;
  /** Inclusive date windows, YYYY-MM-DD, for days that move. */
  dated?: [string, string][];
  /** Month-day pairs (1-based months) for days that repeat every year. */
  fixed?: [number, number][];
}

const SAFFRON = "#FF9933";
const INDIA_GREEN = "#1FA34A";
const GOLD = "#FFB23C";
const EMBER = "#FF7A1A";

export const FESTIVALS: Festival[] = [
  { title: "Happy Diwali", line: "May the lights find you", glow: GOLD, glow2: EMBER, dated: [["2027-10-28", "2027-10-30"]] },
  { title: "Happy Holi", line: "Colour everything today", glow: "#FF3FA4", glow2: "#2FD3FF", dated: [["2027-03-21", "2027-03-22"]] },
  { title: "Happy Chhath Puja", line: "Jai Chhathi Maiya", glow: "#FF8A3D", glow2: "#FFD15C", dated: [["2026-11-13", "2026-11-16"], ["2027-11-02", "2027-11-05"]] },
  { title: "Ganpati Bappa Morya", line: "Happy Ganesh Chaturthi", glow: "#FF8A00", glow2: "#FF3D3D", dated: [["2027-09-04", "2027-09-04"]] },
  { title: "Happy Navratri", line: "Nine nights of light", glow: "#FF3D6E", glow2: GOLD, dated: [["2027-10-01", "2027-10-08"]] },
  { title: "Happy Dussehra", line: "May good always win", glow: EMBER, glow2: GOLD, dated: [["2027-10-09", "2027-10-10"]] },
  { title: "Happy Janmashtami", line: "Jai Shri Krishna", glow: "#1FA2FF", glow2: "#FFD34D", dated: [["2027-08-24", "2027-08-25"]] },
  { title: "Happy Raksha Bandhan", line: "For the bond that always holds", glow: "#FF4D6D", glow2: GOLD, dated: [["2027-08-17", "2027-08-17"]] },
  { title: "Har Har Mahadev", line: "Happy Maha Shivratri", glow: "#3D6BFF", glow2: "#B9C4FF", dated: [["2027-03-06", "2027-03-06"]] },
  { title: "Happy Gurpurab", line: "Wishing you peace and light", glow: SAFFRON, glow2: "#3D6BFF", dated: [["2026-11-24", "2026-11-24"]] },
  { title: "Happy Republic Day", line: "Jai Hind", glow: SAFFRON, glow2: INDIA_GREEN, fixed: [[1, 26]] },
  { title: "Happy Independence Day", line: "Jai Hind", glow: SAFFRON, glow2: INDIA_GREEN, fixed: [[8, 15]] },
  { title: "Happy Makar Sankranti", line: "May your kites fly high", glow: "#FFB300", glow2: "#FF4D8D", fixed: [[1, 14], [1, 15]] },
  { title: "Happy Lohri", line: "The bonfire's warmth to you and yours", glow: EMBER, glow2: "#FFC24D", fixed: [[1, 13]] },
  { title: "Merry Christmas", line: "Joy to you and everyone at home", glow: "#FF3B3B", glow2: "#27D17F", fixed: [[12, 24], [12, 25]] },
  { title: "Happy New Year", line: "May this year be your best one yet", glow: GOLD, glow2: "#FFE6A8", fixed: [[1, 1]] },
];

const day = (s: string) => new Date(`${s}T00:00:00`);

/** The next day (from `now`) that Home dresses up for, with when it starts; today counts. */
export function nextFestival(now: Date): { festival: Festival; start: Date; today: boolean } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best: { festival: Festival; start: Date; today: boolean } | null = null;
  const consider = (festival: Festival, start: Date, end: Date) => {
    if (end < today) return;
    const s = start < today ? today : start;
    const isToday = start <= today && today <= end;
    if (!best || s < best.start) best = { festival, start: s, today: isToday };
  };
  for (const f of FESTIVALS) {
    for (const [a, b] of f.dated ?? []) consider(f, day(a), day(b));
    for (const [m, d] of f.fixed ?? []) {
      for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
        const t = new Date(y, m - 1, d);
        consider(f, t, t);
      }
    }
  }
  return best;
}
