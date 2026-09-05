// Driving the real UI, the way an operator would.
//
// Almost every domain function in this app lives inside a closure and is not
// reachable from `globalThis` -- `canMutate`, `setTableCapacity`, the seating
// logic. Tests therefore click real controls rather than calling functions,
// which is also the only way a test can prove the rule is enforced where the
// operator meets it. Selectors are data attributes, never visible text, so the
// same helper works in both UI languages.

export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

// Every screen is rebuilt wholesale by render(), and render() is called from
// places a test cannot see -- a toast dismissing, a save completing, storage
// resolving. A control can therefore be detached and replaced between the
// moment Playwright resolves it and the moment it clicks, which surfaces as a
// single long actionability timeout rather than a fast error. Re-resolving the
// locator on each attempt turns that into a retry, and caps the total wait
// well under Playwright's 30s default so a genuinely missing control fails
// quickly and says which one.
export async function click(page, selector, { attempts = 3, timeout = 7000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const target = page.locator(selector).first();
      await target.waitFor({ state: "visible", timeout });
      await target.click({ timeout });
      return;
    } catch (err) {
      last = err;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`click("${selector}") failed after ${attempts} attempts: ${String(last.message).split("\n")[0]}`);
}

// `state` and `ui` are top-level `let`/`const` bindings in a classic script,
// so they live in the global lexical scope and are NOT properties of
// globalThis. They are reachable as bare identifiers and only that way --
// checking `globalThis.state` reports undefined on a perfectly healthy app.
export async function openApp(page, baseUrl, { file = "index.html", lang } = {}) {
  await page.goto(`${baseUrl}/${file}`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => { try { return Array.isArray(state.events) && typeof render === "function"; } catch { return false; } },
    null, { timeout: 20000 }
  );
  if (lang) await page.evaluate(l => { ui.lang = l; render(); }, lang);
}

export async function createBlankEvent(page, { name = "Test Event", hotel = "Merit Royal", date = "2026-09-10", salon } = {}) {
  await click(page, '[data-action="create-event"]');
  await page.waitForSelector('input[name="name"]', { timeout: 10000 });
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="hotel"]', hotel);
  await page.fill('input[name="date"]', date);
  if (salon) {
    const field = await page.$('input[name="salon"]');
    if (field) await field.fill(salon);
  }
  await click(page, 'button[data-setup="blank"]');
  await page.waitForFunction(n => state.events.some(e => e.name === n), name, { timeout: 15000 });
  await page.waitForTimeout(400);
}

// The map-first Floor Plan has no permanent object list: tables are added
// through the floating FAB and its bulk panel.
export async function addTables(page, { quantity, type, prefix } = {}) {
  const before = await page.evaluate(() => state.events[0].tables.length);
  await click(page, ".planmap-fab");
  await page.waitForSelector('[data-v8-action="commit-add"]', { timeout: 10000 });
  if (type) { await page.selectOption('[data-bulk="type"]', type); await page.waitForTimeout(150); }
  if (quantity !== undefined) { await page.fill('[data-bulk="quantity"]', String(quantity)); await page.waitForTimeout(150); }
  if (prefix) { await page.fill('[data-bulk="prefix"]', prefix); await page.waitForTimeout(150); }
  await click(page, '[data-v8-action="commit-add"]');
  await page.waitForFunction(n => state.events[0].tables.length > n, before, { timeout: 15000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => state.events[0].tables.length);
}

export async function gotoTab(page, tab) {
  await click(page, `[data-tab="${tab}"]`);
  await page.waitForTimeout(350);
}

// The guest dialog is static markup in index.html that render() re-translates
// and re-binds on every pass, and render() fires from places a test does not
// control -- a debounced save landing, a toast clearing. Observed effects:
// a save click swallowed because the handler was not attached yet, and the
// open dialog gone by the time its footer button was resolved. Both showed up
// as an occasional slow failure rather than a real one.
//
// So the whole open-fill-save cycle is the retried unit, and success is
// defined by the data -- the guest exists -- not by any click having appeared
// to work. If it still fails, the error carries the page state that explains
// why instead of a bare Playwright timeout.
export async function addGuest(page, { name, additionalGuests = 0, vip } = {}) {
  const saved = () => page.evaluate(n => state.events[0].guests.some(g => g.name === n), name);
  let last;

  for (let attempt = 0; attempt < 3 && !(await saved()); attempt++) {
    try {
      await click(page, '[data-guest-command="add"]', { attempts: 2, timeout: 5000 });
      await page.waitForSelector("#guestForm", { state: "visible", timeout: 5000 });
      await page.fill('#guestForm input[name="name"]', name);
      if (additionalGuests) await page.fill('#guestForm input[name="additionalGuests"]', String(additionalGuests));
      if (vip) await page.selectOption('#guestForm select[name="vip"]', vip).catch(() => {});

      // Read both fields back together before saving. A fill focuses the field
      // and then inserts text; if the dialog re-renders in between, the text
      // lands wherever focus ended up instead. Observed: the party size "3"
      // typed into the name field, producing a guest called "MEHMET OZTURK3"
      // alongside the real one -- which then made a later search ambiguous and
      // failed a completely different assertion. Saving a form this test has
      // not verified is how that stray record got created.
      const form = await page.evaluate(() => ({
        name: document.querySelector('#guestForm input[name="name"]')?.value,
        additional: document.querySelector('#guestForm input[name="additionalGuests"]')?.value,
      }));
      const wantAdditional = additionalGuests ? String(additionalGuests) : form.additional;
      if (form.name !== name || form.additional !== wantAdditional) {
        last = new Error(`form held ${JSON.stringify(form)}, wanted name=${JSON.stringify(name)} additional=${JSON.stringify(wantAdditional)}`);
        await page.click("#guestForm .dialog-close").catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }

      await click(page, "#guestForm .dialog-foot .btn.primary", { attempts: 2, timeout: 4000 });
      await page.waitForFunction(n => state.events[0].guests.some(g => g.name === n), name, { timeout: 5000 });
    } catch (err) {
      last = err;
      await page.waitForTimeout(300);
    }
  }

  if (!(await saved())) {
    const diagnosis = await page.evaluate(() => ({
      addButtons: document.querySelectorAll("[data-guest-command='add']").length,
      formPresent: !!document.getElementById("guestForm"),
      dialogOpen: document.getElementById("guestDialog")?.classList.contains("open")
        || document.getElementById("guestDialog")?.open || null,
      saveButton: !!document.querySelector("#guestForm .dialog-foot .btn.primary"),
      tab: ui.tab, screen: ui.screen,
      toasts: [...document.querySelectorAll("#toastWrap *")].map(n => n.textContent.trim()).filter(Boolean).slice(-3),
    })).catch(() => null);
    throw new Error(`addGuest("${name}") never saved. page=${JSON.stringify(diagnosis)} last=${last ? String(last.message).split("\n")[0] : "none"}`);
  }

  // Exactly one record, with the party size that was asked for. A retry that
  // half-succeeded leaves a second, subtly different guest behind, and the
  // damage then shows up several assertions later in an unrelated check.
  const record = await page.evaluate(n => {
    const matches = state.events[0].guests.filter(g => g.name === n);
    return { count: matches.length, additional: matches[0]?.additionalGuests, all: state.events[0].guests.map(g => g.name) };
  }, name);
  if (record.count !== 1) throw new Error(`addGuest("${name}") produced ${record.count} records: ${JSON.stringify(record.all)}`);
  if (record.additional !== additionalGuests) {
    throw new Error(`addGuest("${name}") stored additionalGuests=${record.additional}, expected ${additionalGuests}`);
  }
  await page.waitForTimeout(200);
}

// Seat the first (or a named) guest on the first table, through the real
// seating click flow: pick a guest in the left panel, pick a table, pick a
// seat. Every step waits on the thing it needs rather than on a sleep -- the
// left panel toggle in particular is only present when the panel is
// collapsed, and waiting out Playwright's default 30s for it made this the
// slowest helper in the suite.
export async function seatGuestOnFirstTable(page, guestName) {
  await gotoTab(page, "seating");
  const toggle = page.locator('[data-panel-toggle="left"]');
  if (await toggle.count()) await toggle.first().click({ timeout: 3000 }).catch(() => {});

  const guest = guestName
    ? page.locator(`[data-seating-guest]:has-text(${JSON.stringify(guestName)})`).first()
    : page.locator("[data-seating-guest]").first();
  await guest.waitFor({ state: "visible", timeout: 10000 });
  await guest.click();

  const table = page.locator(".table-object").first();
  await table.waitFor({ state: "visible", timeout: 10000 });
  await table.click();

  const seat = page.locator('[data-empty-seat="0"]').first();
  await seat.waitFor({ state: "visible", timeout: 10000 });
  await seat.click();

  await page.waitForFunction(() => state.events[0].guests.some(g => !!g.assignment), null, { timeout: 10000 });
  await page.waitForTimeout(200);
}

// Wait for the app to stop re-rendering itself. Toasts auto-dismiss, and each
// dismissal drives a render that replaces the screen -- typing into a field
// while that happens silently drops characters, which reads downstream as the
// app having matched the wrong guests rather than as a lost keystroke.
export async function settle(page, { timeout = 6000 } = {}) {
  await page.waitForFunction(
    () => (document.getElementById("toastWrap")?.childElementCount || 0) === 0,
    null, { timeout }
  ).catch(() => {});
  await page.waitForTimeout(150);
}

// Type into a search field and confirm the query really landed.
//
// Confirming the DOM value is not enough. The Live search re-renders on every
// keystroke and restores focus one animation frame later, so a synthetic key
// sent inside that frame reaches a detached node: the field can read back the
// full text while the app's own `ui` state never saw those characters, and the
// screen is still listing everybody. A test that trusted the input value then
// pressed Enter was reasoning about a query the app was not running.
//
// So `state` names the ui field the query is supposed to reach, and the wait
// is on that. Character-by-character entry is kept because it is what an
// operator does at the door and is worth exercising.
export async function typeQuery(page, selector, text, { state: stateKey } = {}) {
  let seen;
  for (let attempt = 0; attempt < 3; attempt++) {
    await settle(page);
    const field = page.locator(selector).first();
    await field.waitFor({ state: "visible", timeout: 5000 });
    await field.click();
    await field.fill("");
    await field.type(text, { delay: 20 });
    try {
      await page.waitForFunction(
        ({ sel, want, key }) => document.querySelector(sel)?.value === want && (!key || ui[key] === want),
        { sel: selector, want: text, key: stateKey || null },
        { timeout: 3000 }
      );
      await page.waitForTimeout(200);
      return;
    } catch {
      seen = await page.evaluate(({ sel, key }) => ({
        value: document.querySelector(sel)?.value,
        state: key ? ui[key] : undefined,
      }), { sel: selector, key: stateKey || null });
    }
  }
  throw new Error(`typeQuery("${selector}", ${JSON.stringify(text)}) never landed: ${JSON.stringify(seen)}`);
}

export function firstEvent(page) {
  return page.evaluate(() => {
    const e = state.events[0];
    return {
      name: e.name,
      tables: e.tables.length,
      guests: e.guests.length,
      status: e.status,
    };
  });
}
