// Orbit Setup's choices: the questions (only those this TV needs), what was answered, and the plan before anything
// changes on the TV, with every group open to keep a single app.
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { catalog, type Answer, type CatalogQuestion } from "../../setup/catalog";
import {
  answer,
  back,
  changeAnswer,
  install,
  modelName,
  previousQuestion,
  seePlan,
  setGroup,
  setPackage,
  tvName,
  useSetup,
  useSetupPlan,
  useSetupQuestions,
} from "../../setup/flow";
import { choicesOf, type Plan, type PlanGroup } from "../../setup/plan";
import * as I from "../icons";
import { Sheet } from "../kit";
import { Card, DoneMark, Lead, Primary, Rise, Screen, SectionLabel, StepBar, TextButton, Title, ease } from "./parts";

const ICONS: Record<string, (p: { size?: number; className?: string }) => ReactNode> = {
  cast: I.Cast,
  usb: I.Usb,
  voice: I.Mic,
  channels: I.Channels,
  ads: I.Shield,
};

/** What the plan says of a group a person's answer switched off. */
const BECAUSE: Record<string, string> = {
  cast: "You said you don't cast from a phone",
  usb: "You said you don't play from a USB drive",
  voice: "You said you don't search by voice",
  channels: "You said you don't watch them",
};

const swap = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 36 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.38, ease } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28, transition: { duration: 0.18 } }),
};

// ---- questions ----

export function Questions() {
  const f = useSetup();
  const qs = useSetupQuestions(f);
  const summary = f.q >= qs.length;
  const q = qs[Math.min(f.q, qs.length - 1)];
  return (
    <Screen label={summary ? "Your answers" : "Questions"}>
      <StepBar step={4} onBack={back} />
      <Rise className="relative flex flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false} custom={f.qDir}>
          <motion.div
            key={summary ? "summary" : q.id}
            custom={f.qDir}
            variants={swap}
            initial="enter"
            animate="center"
            exit="exit"
            className="flex flex-1 flex-col"
          >
            {summary ? <Summary questions={qs} answers={f.answers} /> : <Question q={q} index={f.q} total={qs.length} answers={f.answers} />}
          </motion.div>
        </AnimatePresence>
      </Rise>
    </Screen>
  );
}

/** "On this TV that is Xiaomi TV+": the maker's channels are easier to answer with the app's own name. */
function onThisTv(q: CatalogQuestion, enabled: string[]): string {
  if (q.id !== "channels") return q.help;
  const labels = enabled.filter((p) => catalog.packages[p]?.group === q.group).map((p) => catalog.packages[p].label);
  return labels.length ? `On this TV that is ${labels.join(" and ")}. ${q.help}` : q.help;
}

function Question({ q, index, total, answers }: { q: CatalogQuestion; index: number; total: number; answers: Record<string, Answer> }) {
  const f = useSetup();
  const Icon = ICONS[q.id] ?? I.Tv;
  return (
    <>
      <div className="mt-[26px] flex items-center justify-between">
        <span className="text-[13px] font-semibold tracking-[0.6px] text-dusk uppercase">
          Question {index + 1} of {total}
        </span>
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: total }, (_, k) => (
            <motion.span
              key={k}
              layout
              transition={{ duration: 0.3, ease }}
              className={`h-2 rounded-full ${k === index ? "w-5 bg-ice" : k < index ? "w-2 bg-cyan" : "w-2 bg-white/16"}`}
            />
          ))}
        </div>
      </div>
      <div
        className="mt-[34px] grid h-[72px] w-[72px] place-items-center rounded-[24px] border border-ice/28"
        style={{ background: "linear-gradient(145deg, rgba(116,209,255,0.18), rgba(233,179,255,0.12))" }}
      >
        <Icon size={32} className="text-ice" />
      </div>
      <Title size={27} className="mt-[22px] leading-[1.2] tracking-[-0.4px]">
        {q.title}
      </Title>
      <p className="mt-3 text-[15px] leading-[1.5] text-mist">{onThisTv(q, f.read.enabled)}</p>
      <div className="mt-auto flex flex-col gap-3 pt-6" role="group" aria-label={q.title}>
        {choicesOf(q).map((a, k) => (
          <Choice key={a} first={k === 0} chosen={answers[q.id] === a} recommended={q.recommend === a} onPress={() => answer(q.id, a)}>
            {q[a]}
          </Choice>
        ))}
        {index > 0 ? (
          <TextButton onPress={previousQuestion} className="self-center">
            Previous question
          </TextButton>
        ) : (
          <span className="h-11" aria-hidden="true" />
        )}
      </div>
    </>
  );
}

function Choice({ children, first, chosen, recommended, onPress }: { children: ReactNode; first: boolean; chosen: boolean; recommended: boolean; onPress: () => void }) {
  return (
    <motion.button
      type="button"
      aria-pressed={chosen}
      onClick={onPress}
      whileTap={{ scale: 0.98 }}
      className={`flex min-h-16 items-center gap-3.5 rounded-[18px] border px-[18px] text-left text-[16px] font-semibold text-snow ${
        first ? "border-cyan/45 bg-cyan/10" : "border-white/12 bg-white/[0.045]"
      }`}
    >
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${first ? "border-cyan" : "border-ice/50"}`}>
        {chosen && <motion.span layoutId="setup-choice" className={`h-2.5 w-2.5 rounded-full ${first ? "bg-cyan" : "bg-ice"}`} />}
      </span>
      <span className="flex-1 py-3">{children}</span>
      {recommended && <span className="shrink-0 rounded-lg bg-cyan/18 px-2 py-1 text-[11px] font-semibold text-[#9fdfff]">Recommended</span>}
    </motion.button>
  );
}

/** An answer in the summary's few words. */
function answered(q: CatalogQuestion, a: Answer | undefined): string {
  if (!a) return "Not answered";
  if (a === "off") return "Switch off";
  return catalog.groups[q.group]?.default === "off" ? "You choose on the next screen" : "Keep";
}

function Summary({ questions, answers }: { questions: CatalogQuestion[]; answers: Record<string, Answer> }) {
  return (
    <>
      <div className="mt-[30px]">
        <DoneMark size={56} />
      </div>
      <Title className="mt-[18px]">That's everything</Title>
      <Lead className="mt-2.5">Your answers, before anything changes on the TV:</Lead>
      <Card className="mt-[18px] overflow-hidden">
        {questions.map((q, k) => {
          const label = catalog.groups[q.group]?.label ?? q.title;
          return (
            <div key={q.id} className="flex items-center gap-2.5 border-b border-white/6 py-1.5 pr-2 pl-4 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                <span className="text-[15px] font-medium">{label}</span>
                <span className="text-[13px] text-mist">{answered(q, answers[q.id])}</span>
              </div>
              <button type="button" onClick={() => changeAnswer(k)} aria-label={`Change: ${label}`} className="min-h-11 shrink-0 px-2.5 text-[14px] font-medium text-ice">
                Change
              </button>
            </div>
          );
        })}
      </Card>
      <div className="mt-auto pt-6">
        <Primary onPress={seePlan}>See the plan</Primary>
      </div>
    </>
  );
}

// ---- the plan ----

const apps = (n: number) => `${n} ${n === 1 ? "app" : "apps"}`;

/** A group's second line on the plan: why it is there, or what in it goes. */
function groupNote(g: PlanGroup): string {
  if (g.why === "required") return g.about.split(". ")[0].replace(/\.$/, "");
  if (g.why === "answer") return (g.question && BECAUSE[g.question.id]) ?? "Your answer switched these off";
  const off = g.items.filter((i) => i.off).map((i) => i.label);
  if (g.why === "choose" && !off.length) return "Nothing chosen yet. Open it to pick";
  if (!off.length) return "All kept on";
  return off.slice(0, 3).join(", ") + (off.length > 3 ? ", and more" : "");
}

/** "Stays on": the groups the answers kept, and what Orbit never touches. */
function staysOn(plan: Plan): string {
  const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  return [...plan.kept.map((g) => lower(g.label)), "the remote's buttons", "every streaming app", "firmware updates"].join(", ");
}

export function PlanScreen() {
  const f = useSetup();
  const plan = useSetupPlan(f);
  const [open, setOpen] = useState<string | null>(null);
  const model = modelName(f);
  const name = tvName(f);
  const count = plan.disable.length;
  return (
    <>
      <Screen label="The plan">
        <StepBar step={5} onBack={back} />
        <Rise className="mt-5 flex flex-col gap-1.5">
          <Title>Here's the plan</Title>
          <Lead>
            {name === "your TV" ? "Your TV" : name}
            {model ? ` · ${model}` : ""}. Nothing has changed on the TV yet.
          </Lead>
        </Rise>

        <Rise className="mt-[18px]">
          <SectionLabel aside="2 apps">Install</SectionLabel>
          <Card className="mt-2 rounded-[18px]">
            <AppRow icon={<I.Planet size={22} className="text-ice" />} title="Orbit Home" note="The new home screen and the remote helper" divider />
            <AppRow icon={<I.Channels size={20} className="text-lilac" />} title="Orbit Live TV" note="30 free Hindi channels with a guide" />
          </Card>
        </Rise>

        <Rise className="mt-[18px]">
          <SectionLabel aside={count ? `${apps(count)}, never deleted` : undefined}>Switch off</SectionLabel>
          <Card className="mt-2 overflow-hidden rounded-[18px]">
            {plan.groups.map((g, k) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpen(g.id)}
                aria-label={`${g.label}: ${g.off} of ${apps(g.items.length)} switched off. Open to change`}
                className={`flex min-h-[58px] w-full items-center gap-3 py-2 pr-3 pl-3.5 text-left active:bg-white/4 ${k < plan.groups.length - 1 ? "border-b border-white/6" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{g.label}</span>
                  <span className="truncate text-[12.5px] text-mist">{groupNote(g)}</span>
                </span>
                <motion.span
                  key={g.off}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`tabular min-w-7 shrink-0 rounded-[9px] px-1.5 py-[3px] text-center text-[13px] font-semibold ${g.off ? "bg-cyan/14 text-[#9fdfff]" : "bg-white/6 text-dusk"}`}
                >
                  {g.off}
                </motion.span>
                <I.Caret dir="right" size={16} strokeWidth={2} className="shrink-0 text-dusk" />
              </button>
            ))}
            {!plan.groups.length && <p className="px-4 py-4 text-[14px] leading-snug text-mist">Nothing on this TV needs switching off.</p>}
          </Card>
        </Rise>

        <Rise>
          <p className="mt-3.5 text-[13.5px] leading-[1.45] text-mist">
            <b className="font-semibold text-haze">Stays on:</b> {staysOn(plan)}.
          </p>
        </Rise>

        <Rise className="mt-auto flex flex-col gap-2.5 pt-6">
          <Primary onPress={install}>Set up my TV</Primary>
          <span className="text-center text-[13px] text-dusk">Undo it all later from Orbit › Settings › This TV</span>
        </Rise>
      </Screen>
      <GroupSheet group={plan.groups.find((g) => g.id === open) ?? null} onClose={() => setOpen(null)} />
    </>
  );
}

function AppRow({ icon, title, note, divider }: { icon: ReactNode; title: string; note: string; divider?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 ${divider ? "border-b border-white/6" : ""}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-night-tile">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-mist">{note}</span>
      </span>
    </div>
  );
}

/** One group of the plan: each app in it, to keep or to switch off (the required ones stay as they are). */
function GroupSheet({ group, onClose }: { group: PlanGroup | null; onClose: () => void }) {
  const [last, setLast] = useState<PlanGroup | null>(group);
  if (group && group !== last) setLast(group);
  const g = group ?? last;
  const free = g?.items.filter((i) => !i.lock) ?? [];
  const allOff = free.length > 0 && free.every((i) => i.off);
  return (
    <Sheet open={!!group} onClose={onClose} title={g?.label ?? ""}>
      {g && (
        <>
          <p className="text-[14px] leading-snug text-mist">{g.about}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-dusk">
              {g.off} of {apps(g.items.length)} switched off
            </span>
            {free.length > 1 && (
              <button type="button" onClick={() => setGroup(g.id, !allOff)} className="min-h-11 px-1 text-[14px] font-medium text-ice">
                {allOff ? "Keep all" : "Switch all off"}
              </button>
            )}
          </div>
          <ul className="mt-1 divide-y divide-white/6">
            {g.items.map((it) => (
              <li key={it.pkg} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug text-snow">{it.label}</p>
                  <p className="truncate font-mono text-[11px] text-faint">{it.pkg}</p>
                </div>
                {it.lock ? (
                  <span className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12.5px] text-mist">
                    {it.lock === "required" ? "Required" : "Stays on"}
                  </span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={it.off}
                    aria-label={`Switch off ${it.label}`}
                    onClick={() => setPackage(it.pkg, !it.off)}
                    className="grid min-h-11 shrink-0 place-items-center"
                  >
                    <span
                      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-200 ${
                        it.off ? "bg-cyan/16 text-cyan" : "bg-white/8 text-haze"
                      }`}
                    >
                      {it.off ? "Switch off" : "Keep"}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {g.items.some((i) => i.lock === "together") && (
            <p className="mt-3 text-[12.5px] leading-snug text-faint">"Stays on": it goes only together with an app that stays on.</p>
          )}
        </>
      )}
    </Sheet>
  );
}
