/**
 * What the screen actually looks like, in a real browser.
 *
 * Every other script in here drives the store and asks what it decided. That is
 * the right question for almost everything and it is blind to one whole class
 * of failure, which this exists for — and which it exists for because that
 * class shipped twice in one afternoon:
 *
 *   A layer is authored at `opacity: 0` and faded in by GSAP. Its effect runs
 *   inside a `gsap.context`, which **reverts on cleanup**. So when the effect
 *   re-runs, the fade is undone first and the element is back at 0. Any path
 *   that does not fade it in again leaves the layer invisible — while the state
 *   behind it is still live, so `bettingNow()` has every control in the app
 *   standing down over a screen with nothing on it. The only way out is a
 *   reload. It is indistinguishable, to the person holding the phone, from the
 *   app freezing.
 *
 * Nothing in the store notices, correctly: the run advances, the pot is right,
 * every assertion in verify:run passes. Nothing in the DOM notices either —
 * an element at `opacity: 0` is still present, still focusable, still
 * hit-testable, and `.click()` on it works perfectly. It is *only* visible as a
 * computed style, which is why this script reads computed styles and nothing
 * else.
 *
 * ## It is not part of `npm run verify`
 *
 * That suite is hermetic and fast and should stay both. This needs a dev server
 * on localhost and a Chrome on disk, and it skips rather than fails when either
 * is missing — a check that cannot run is not a check that failed, and one that
 * breaks CI over a missing browser gets deleted within a week.
 *
 * Run `npm run dev`, then `npm run verify:screen`.
 */
import { existsSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const URL = process.env.SCREEN_URL ?? "http://localhost:3000/";
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${line}`);
};
const skip = (why: string) => {
  console.log(`\n  skipped — ${why}\n`);
  process.exit(0);
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clicks the first enabled button whose label or text matches. */
async function click(page: Page, pattern: string, settle = 1500) {
  const hit = await page.evaluate((src: string) => {
    const rx = new RegExp(src, "i");
    const b = [...document.querySelectorAll("button")].find(
      (x) =>
        rx.test(x.getAttribute("aria-label") || x.textContent || "") &&
        !(x as HTMLButtonElement).disabled,
    ) as HTMLButtonElement | undefined;
    if (!b) return false;
    b.click();
    return true;
  }, pattern);
  if (hit) await wait(settle);
  return hit;
}

/**
 * Every open dialog, as the eye would have it.
 *
 * `opacity` off the computed style rather than the attribute, so a GSAP-written
 * inline value and a stylesheet rule are read the same way; and a count of the
 * children that are themselves not transparent, because a visible shell full of
 * invisible controls is the same failure one level down.
 */
const seen = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
      label: d.getAttribute("aria-label") ?? "prize",
      opacity: getComputedStyle(d).opacity,
      visibleButtons: [...d.querySelectorAll("button")].filter(
        (b) => getComputedStyle(b).opacity !== "0",
      ).length,
    })),
  );

/** The best call on offer, by the percentage printed in its own label. */
const bestCall = (page: Page) =>
  page.evaluate(() => {
    const calls = [...document.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((l) => /^Call the next card/.test(l))
      .map((l) => ({ l, p: Number(l.match(/— (\d+) percent/)?.[1] ?? 0) }));
    return calls.sort((a, b) => b.p - a.p)[0]?.l ?? null;
  });

const potOnOffer = (page: Page) =>
  page.evaluate(() => {
    const l = [...document.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label") ?? "")
      .find((x) => /Take the run/.test(x));
    return l ? Number(l.match(/×([\d.]+)/)?.[1] ?? 0) : 0;
  });

const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function main() {
  if (!existsSync(CHROME)) skip(`no Chrome at ${CHROME} (set CHROME=)`);
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    skip(`nothing serving ${URL} — run \`npm run dev\` first`);
  }

  console.log("What the screen looks like — the run, and the prize\n");

  /*
   * A fresh browser per attempt.
   *
   * The scene is WebGL, and software WebGL in headless Chrome gives out after a
   * few hundred rounds — the renderer dies and every later call reports a
   * detached frame. That is this harness, not the app, and restarting is
   * cheaper than chasing it.
   */
  let proved = false;
  for (let attempt = 1; attempt <= 6 && !proved; attempt++) {
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(6000);
      await click(page, "^Cards$");

      for (let round = 1; round <= 8 && !proved; round++) {
        // Clear anything a previous round's loss left open.
        await click(page, "Anything they like|^Custom", 700);
        await click(page, "^(30|45|60|90)$|^30s$|^45s$|^1m$", 700);
        await click(page, "^Draw again$|Draw a card", 1500);
        if (!(await click(page, "Higher or lower", 1800))) continue;

        const opened = await seen(page);
        const table = opened.find((d) => d.label === "Higher or lower");
        if (!table) continue;
        report(table.opacity === "1", `the bet opens visible — opacity ${table.opacity}`);

        for (let call = 1; call <= 5 && !proved; call++) {
          const best = await bestCall(page);
          if (!best) break;
          await click(page, rx(best), 2700);

          const pot = await potOnOffer(page);
          if (!pot) break; // a lost call ends the run

          /*
           * The one that matters. Pushing re-runs the deal effect, whose
           * cleanup reverts the fade that put this layer on screen.
           */
          if (call === 1) {
            await click(page, "Go again", 2700);
            const after = (await seen(page)).find((d) => d.label === "Higher or lower");
            report(
              after?.opacity === "1",
              `and stays visible when the run is pushed — opacity ${after?.opacity ?? "ABSENT"}`,
            );
            report(
              (after?.visibleButtons ?? 0) > 0,
              `with calls on it — ${after?.visibleButtons ?? 0} visible`,
            );
            continue;
          }

          if (pot < 2 && call < 5) {
            await click(page, "Go again", 2700);
            continue;
          }

          await click(page, "Take the run", 2400);
          const ladder = (await seen(page)).find((d) => d.label === "prize");
          report(
            ladder?.opacity === "1" && (ladder?.visibleButtons ?? 0) >= 4,
            `the ladder opens visible — opacity ${ladder?.opacity ?? "ABSENT"}, ${ladder?.visibleButtons ?? 0} rungs`,
          );

          // And the stage *after* the ladder, which is entered through a fade
          // to nothing and is where the same bug lived a second time.
          const affordable = await page.evaluate(() =>
            [...document.querySelectorAll("button")]
              .filter(
                (b) =>
                  /Choose from two|Pick anything|Pick theirs as/.test(b.textContent || "") &&
                  !(b as HTMLButtonElement).disabled,
              )
              .map((b) => (b.textContent || "").replace(/\s+/g, " ").slice(0, 18)),
          );
          if (!affordable.length) break;

          await click(page, rx(affordable[affordable.length - 1].split(" ")[0]), 2600);
          const picker = (await seen(page)).find((d) => d.label === "prize");
          report(
            picker?.opacity === "1" && (picker?.visibleButtons ?? 0) > 0,
            `and the screen it opens is visible too — opacity ${picker?.opacity ?? "ABSENT"}, ${picker?.visibleButtons ?? 0} choices`,
          );
          proved = true;
        }
      }
    } catch (e) {
      console.log(`  (attempt ${attempt} lost its browser: ${(e as Error).message.slice(0, 60)})`);
    } finally {
      await browser?.close();
    }
  }

  if (!proved) {
    console.log(
      "\n  inconclusive — never won enough calls to reach the prize screens.\n" +
        "  The run is chance; try again.\n",
    );
    process.exit(failures === 0 ? 0 : 1);
  }

  console.log(
    `\n${failures === 0 ? "  OK  nothing the app is waiting on is invisible\n" : `  ${failures} check(s) failed — something is on screen that cannot be seen\n`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// Not a top-level await: tsx transforms these scripts to CJS, where one is a
// build error. Every other script here is synchronous and never met it.
void main();
