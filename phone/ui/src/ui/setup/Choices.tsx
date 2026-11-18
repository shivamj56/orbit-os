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
import { t, tn, rich, list, mark, firstSentence, currentLanguage } from "../../i18n";

const ICONS: Record<string, (p: { size?: number; className?: string }) => ReactNode> = {
  cast: I.Cast,
  usb: I.Usb,
  voice: I.Mic,
  channels: I.Channels,
  ads: I.Shield,
};

/** What the plan says of a group a person's answer switched off. */
const BECAUSE: Record<string, string> = {
  cast: mark("You said you don't cast from a phone"),
  usb: mark("You said you don't play from a USB drive"),
  voice: mark("You said you don't search by voice"),
  channels: mark("You said you don't watch them"),
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
    <Screen label={summary ? t("Your answers") : t("Questions")}>
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
  const help = t(q.help);
  if (q.id !== "channels") return help;
  const labels = enabled.filter((p) => catalog.packages[p]?.group === q.group).map((p) => t(catalog.packages[p].label));
  return labels.length ? `${t("On this TV that is {apps}.", { apps: list(labels, "and") })} ${help}` : help;
}

function Question({ q, index, total, answers }: { q: CatalogQuestion; index: number; total: number; answers: Record<string, Answer> }) {
  const f = useSetup();
  const Icon = ICONS[q.id] ?? I.Tv;
  return (
    <>
      <div className="mt-[26px] flex items-center justify-between">
        <span className="text-[13px] font-semibold tracking-[0.6px] text-dusk uppercase">
          {t("Question {n} of {total}", { n: index + 1, total })}
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
        {t(q.title)}
      </Title>
      <p className="mt-3 text-[15px] leading-[1.5] text-mist">{onThisTv(q, f.read.enabled)}</p>
      <div className="mt-auto flex flex-col gap-3 pt-6" role="group" aria-label={t(q.title)}>
        {choicesOf(q).map((a, k) => (
          <Choice key={a} first={k === 0} chosen={answers[q.id] === a} recommended={q.recommend === a} onPress={() => answer(q.id, a)}>
            {t(q[a])}
          </Choice>
        ))}
        {index > 0 ? (
          <TextButton onPress={previousQuestion} className="self-center">
            {t("Previous question")}
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
      {recommended && <span className="shrink-0 rounded-lg bg-cyan/18 px-2 py-1 text-[11px] font-semibold text-[#9fdfff]">{t("Recommended")}</span>}
    </motion.button>
  );
}

/** An answer in the summary's few words. */
function answered(q: CatalogQuestion, a: Answer | undefined): string {
  if (!a) return t("Not answered");
  if (a === "off") return t("Switch off");
  return catalog.groups[q.group]?.default === "off" ? t("You choose on the next screen") : t("Keep");
}

function Summary({ questions, answers }: { questions: CatalogQuestion[]; answers: Record<string, Answer> }) {
  return (
    <>
      <div className="mt-[30px]">
        <DoneMark size={56} />
      </div>
      <Title className="mt-[18px]">{t("That's everything")}</Title>
      <Lead className="mt-2.5">{t("Your answers, before anything changes on the TV:")}</Lead>
      <Card className="mt-[18px] overflow-hidden">
        {questions.map((q, k) => {
          const label = t(catalog.groups[q.group]?.label ?? q.title);
          return (
            <div key={q.id} className="flex items-center gap-2.5 border-b border-white/6 py-1.5 pr-2 pl-4 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                <span className="text-[15px] font-medium">{label}</span>
                <span className="text-[13px] text-mist">{answered(q, answers[q.id])}</span>
              </div>
              <button type="button" onClick={() => changeAnswer(k)} aria-label={t("Change: {label}", { label })} className="min-h-11 shrink-0 px-2.5 text-[14px] font-medium text-ice">
                {t("Change")}
              </button>
            </div>
          );
        })}
      </Card>
      <div className="mt-auto pt-6">
        <Primary onPress={seePlan}>{t("See the plan")}</Primary>
      </div>
    </>
  );
}

// ---- the plan ----

const apps = (n: number) => tn(n, "{n} app", "{n} apps");

/** A group's second line on the plan: why it is there, or what in it goes. */
function groupNote(g: PlanGroup): string {
  if (g.why === "required") return firstSentence(t(g.about)).replace(/[.。．।]$/u, "");
  if (g.why === "answer") {
    const because = g.question && BECAUSE[g.question.id];
    return because ? t(because) : t("Your answer switched these off");
  }
  const off = g.items.filter((i) => i.off).map((i) => t(i.label));
  if (g.why === "choose" && !off.length) return t("Nothing chosen yet. Open it to pick");
  if (!off.length) return t("All kept on");
  return off.length > 3 ? t("{apps}, and more", { apps: list(off.slice(0, 3)) }) : list(off);
}

/** "Stays on": the groups the answers kept, and what Orbit never touches. */
function staysOn(plan: Plan): string {
  // Only English starts a group's name small inside a sentence; German nouns, for one, keep their capital.
  const english = currentLanguage().code === "en";
  const lower = (s: string) => (english && /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  return list([...plan.kept.map((g) => lower(t(g.label))), t("the remote's buttons"), t("every streaming app"), t("firmware updates")]);
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
      <Screen label={t("The plan")}>
        <StepBar step={5} onBack={back} />
        <Rise className="mt-5 flex flex-col gap-1.5">
          <Title>{t("Here's the plan")}</Title>
          <Lead>
            {t("{tv}. Nothing has changed on the TV yet.", { tv: (name === "your TV" ? t("Your TV") : name) + (model ? ` · ${model}` : "") })}
          </Lead>
        </Rise>

        <Rise className="mt-[18px]">
          <SectionLabel aside={t("2 apps")}>{t("Install")}</SectionLabel>
          <Card className="mt-2 rounded-[18px]">
            <AppRow icon={<I.Planet size={22} className="text-ice" />} title="Orbit Home" note={t("The new home screen and the remote helper")} divider />
            <AppRow icon={<I.Channels size={20} className="text-lilac" />} title="Orbit Live TV" note={t("30 free Hindi channels with a guide")} />
          </Card>
        </Rise>

        <Rise className="mt-[18px]">
          <SectionLabel aside={count ? t("{apps}, never deleted", { apps: apps(count) }) : undefined}>{t("Switch off")}</SectionLabel>
          <Card className="mt-2 overflow-hidden rounded-[18px]">
            {plan.groups.map((g, k) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpen(g.id)}
                aria-label={t("{group}: {off} of {apps} switched off. Open to change", { group: t(g.label), off: g.off, apps: apps(g.items.length) })}
                className={`flex min-h-[58px] w-full items-center gap-3 py-2 pr-3 pl-3.5 text-left active:bg-white/4 ${k < plan.groups.length - 1 ? "border-b border-white/6" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{t(g.label)}</span>
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
            {!plan.groups.length && <p className="px-4 py-4 text-[14px] leading-snug text-mist">{t("Nothing on this TV needs switching off.")}</p>}
          </Card>
        </Rise>

        <Rise>
          <p className="mt-3.5 text-[13.5px] leading-[1.45] text-mist">
            {rich(t("<b>Stays on:</b> {list}."), { b: (s) => <b className="font-semibold text-haze">{s}</b>, list: staysOn(plan) })}
          </p>
        </Rise>

        <Rise className="mt-auto flex flex-col gap-2.5 pt-6">
          <Primary onPress={install}>{t("Set up my TV")}</Primary>
          <span className="text-center text-[13px] text-dusk">{t("Undo it all later from Orbit › Settings › This TV")}</span>
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
    <Sheet open={!!group} onClose={onClose} title={g ? t(g.label) : ""}>
      {g && (
        <>
          <p className="text-[14px] leading-snug text-mist">{t(g.about)}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-dusk">
              {t("{off} of {apps} switched off", { off: g.off, apps: apps(g.items.length) })}
            </span>
            {free.length > 1 && (
              <button type="button" onClick={() => setGroup(g.id, !allOff)} className="min-h-11 px-1 text-[14px] font-medium text-ice">
                {allOff ? t("Keep all") : t("Switch all off")}
              </button>
            )}
          </div>
          <ul className="mt-1 divide-y divide-white/6">
            {g.items.map((it) => (
              <li key={it.pkg} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug text-snow">{t(it.label)}</p>
                  <p className="truncate font-mono text-[11px] text-faint">{it.pkg}</p>
                </div>
                {it.lock ? (
                  <span className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12.5px] text-mist">
                    {it.lock === "required" ? t("Required") : t("Stays on")}
                  </span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={it.off}
                    aria-label={t("Switch off {label}", { label: t(it.label) })}
                    onClick={() => setPackage(it.pkg, !it.off)}
                    className="grid min-h-11 shrink-0 place-items-center"
                  >
                    <span
                      className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-200 ${
                        it.off ? "bg-cyan/16 text-cyan" : "bg-white/8 text-haze"
                      }`}
                    >
                      {it.off ? t("Switch off") : t("Keep")}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {g.items.some((i) => i.lock === "together") && (
            <p className="mt-3 text-[12.5px] leading-snug text-faint">{t("\"Stays on\": it goes only together with an app that stays on.")}</p>
          )}
        </>
      )}
    </Sheet>
  );
}
