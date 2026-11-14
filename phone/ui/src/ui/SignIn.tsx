// The sign-in buttons (phone/SPEC.md, "From anywhere"): one per way this phone offers, in the order it gives them, so
// an iPhone shows "Continue with Apple" first. Apple's rules for its button: no smaller than the others and not below
// them, its logo on the left of the title, the system font, and on a dark page the white style (white fill, black logo
// and title). The Google button beside it takes the same white, so neither stands out; alone it keeps the look the
// screen gives it.
import { motion } from "framer-motion";
import type { SignInWay } from "../bridge";
import { WAY_NAMES } from "../signin";
import { Press, spring } from "./kit";
import { Spinner } from "./setup/parts";

/** Apple's white style: white, black logo and title, in the phone's own face. */
const APPLE_WHITE = "bg-white text-black font-system [font-feature-settings:normal]";

const whiteHere = (ways: readonly SignInWay[], way: SignInWay) => way === "apple" || ways.includes("apple");

export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Apple's logo (Simple Icons' "apple", CC0), in the title's own colour; `size` is its height. */
export function AppleMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={(size * 19.6) / 24} height={size} viewBox="2.2 0 19.6 24" fill="currentColor" aria-hidden="true" className="-mt-0.5">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

const Mark = ({ way }: { way: SignInWay }) => (way === "apple" ? <AppleMark /> : <GoogleMark />);

/** The remote's screens (Connect, Settings): white pills, 48 px, one under the other. */
export function SignInPills({
  ways,
  busy,
  onPress,
  className = "",
}: {
  ways: readonly SignInWay[];
  /** The way whose sheet is open, or anything else this card is doing: every button waits meanwhile. */
  busy: string | null;
  onPress: (way: SignInWay) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {ways.map((way) => (
        <Press
          key={way}
          label={`Continue with ${WAY_NAMES[way]}`}
          onPress={() => onPress(way)}
          disabled={!!busy}
          feel="medium"
          className={`h-12 w-full rounded-full ${whiteHere(ways, way) ? APPLE_WHITE : "bg-text text-ink"}`}
        >
          <span className="flex items-center gap-2.5 text-[15px] font-medium">
            <Mark way={way} /> {busy === way ? `Opening ${WAY_NAMES[way]}…` : `Continue with ${WAY_NAMES[way]}`}
          </span>
        </Press>
      ))}
    </div>
  );
}

/**
 * Orbit Setup's screens: as tall and round as the screen's own buttons (`size`), a spinner while a sheet is open. Google's
 * alone looks as the screen has it (`alone`, and whether a spinner on it is dark).
 */
export function SetupSignIn({
  ways,
  busy,
  onPress,
  size,
  alone,
  label = (way) => `Continue with ${WAY_NAMES[way]}`,
}: {
  ways: readonly SignInWay[];
  busy: SignInWay | null;
  onPress: (way: SignInWay) => void;
  size: string;
  alone: { className: string; dark: boolean };
  label?: (way: SignInWay) => string;
}) {
  return (
    <>
      {ways.map((way) => {
        const white = whiteHere(ways, way);
        const opening = busy === way;
        return (
          <motion.button
            key={way}
            type="button"
            aria-label={label(way)}
            aria-busy={opening || undefined}
            disabled={!!busy}
            onClick={() => onPress(way)}
            whileTap={{ scale: 0.97 }}
            transition={spring}
            className={`flex w-full shrink-0 items-center justify-center gap-2.5 ${size} ${white ? APPLE_WHITE : alone.className} ${
              opening ? "disabled:opacity-80" : "disabled:opacity-45"
            }`}
          >
            {opening ? <Spinner size={18} dark={white || alone.dark} /> : <Mark way={way} />}
            <span>{opening ? `Opening ${WAY_NAMES[way]}` : `Continue with ${WAY_NAMES[way]}`}</span>
          </motion.button>
        );
      })}
    </>
  );
}
