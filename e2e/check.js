// Headless checks against the dev NetBox cable calculator.
//
// Usage: node check.js <session-cookie-file> [base-url]
//
// The test user needs NetBox view permission on sites, locations, racks,
// devices and cables (and nothing else), or site 105 is "not found".
//
// Read-only except for "Calculate all cables" and the parity check, which
// refresh BOM cache files. Never edits rows, drags racks or saves lengths to NetBox.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { compareRouting } = require("./parity");

const SESSION_FILE = process.argv[2];
const BASE = process.argv[3] || "https://nbupg";
const OUT = path.join(__dirname, "out");
// Expect whatever cache-buster the repo's template has now.
const TEMPLATE = path.join(__dirname, "../netbox_cable_calc/templates/netbox_cable_calc/calculator.html");
const EXPECT_BUNDLE = fs.readFileSync(TEMPLATE, "utf8").match(/calculator\.bundle\.js' %\}\?(v=\d+)/)[1];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

(async () => {
  if (!SESSION_FILE) throw new Error("usage: node check.js <session-cookie-file> [base-url]");
  const sessionid = fs.readFileSync(SESSION_FILE, "utf8").trim();
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } });
  await context.addCookies([{ name: "sessionid", value: sessionid, url: BASE }]);
  const page = await context.newPage();

  const consoleErrors = [], pageErrors = [], failedRequests = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("response", r => { if (r.url().includes("/plugins/cable-calc/") && r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

  const shot = (name, fullPage = true) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage });
  const openTab = label => page.getByRole("button", { name: label, exact: true }).click();
  const setLocation = async value => {
    await page.evaluate(v => {
      // Both dropdowns are TomSelect boxes; pick the one under the "Location" label.
      const sel = [...document.querySelectorAll("#cable-calc-root select")]
        .find(s => s.parentElement.querySelector("label")?.textContent.trim().toLowerCase() === "location");
      if (!sel?.tomselect) throw new Error("location TomSelect not found");
      sel.tomselect.setValue(v);
    }, value);
  };
  const rowLabels = () => page.$$eval("#cable-calc-root input.form-control-sm[style*='width: 110px']", els => els.map(e => e.value));
  const waitForRows = async expected => {
    try {
      await page.waitForFunction(exp => {
        const vals = [...document.querySelectorAll("#cable-calc-root input.form-control-sm")].filter(e => e.style.width === "110px").map(e => e.value);
        return JSON.stringify(vals) === JSON.stringify(exp);
      }, expected, { timeout: 15000 });
    } catch (_) { /* reported by the check below */ }
    return rowLabels();
  };

  // 1. Page loads with the current bundle
  const resp = await page.goto(`${BASE}/plugins/cable-calc/?site_id=105`, { waitUntil: "networkidle" });
  check("page loads (logged in)", resp.status() === 200 && !page.url().includes("/login"), `HTTP ${resp.status()} ${page.url()}`);
  const bundleSrc = await page.$eval("script[src*='calculator.bundle.js']", s => s.getAttribute("src"));
  check(`bundle is ${EXPECT_BUNDLE}`, bundleSrc.includes(EXPECT_BUNDLE), bundleSrc);

  // 2. Site-wide floor plan: grouped by suite, no empty site-level group
  await openTab("Floor plan");
  await page.waitForSelector("text=Read-only overview", { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll("#cable-calc-root svg text").length > 0, null, { timeout: 15000 }).catch(() => {});
  const headers = await page.$$eval("#cable-calc-root svg rect[fill='#343a40'] + text", els => els.map(e => e.textContent));
  check("site view shows both suites", headers.includes("Palantir-Suite 14") && headers.includes("Palantir-Suite 15"), headers.join(", "));
  check("site view has no empty Site-level group", !headers.includes("Site-level"));
  await shot("1-site-floorplan");

  // 3. Switching location reloads that location's floor plan
  await setLocation("125");
  let rows = await waitForRows(["S15 Row 1"]);
  check("Suite 15 shows only its own row", JSON.stringify(rows) === JSON.stringify(["S15 Row 1"]), rows.join(", "));
  await shot("2-suite15-floorplan");

  await setLocation("126");
  rows = await waitForRows(["S14 Row 1", "S 14 Row 2"]);
  check("Suite 14 shows only its own rows", JSON.stringify(rows) === JSON.stringify(["S14 Row 1", "S 14 Row 2"]), rows.join(", "));
  await shot("3-suite14-floorplan");

  await setLocation("");
  const backToSite = await page.waitForSelector("text=Read-only overview", { timeout: 15000 }).then(() => true).catch(() => false);
  check("clearing location returns to site view", backToSite);

  // 4. Suite 15 BOM: cross-suite cables routed over the bridge, none flagged
  await setLocation("125");
  await waitForRows(["S15 Row 1"]);
  await openTab("Bulk BOM");
  await page.getByRole("button", { name: /Calculate all cables/ }).click();
  await page.waitForSelector("text=/BOM summary/", { timeout: 60000 }).catch(() => {});
  const bom = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("#cable-calc-root table")];
    const detail = tables[tables.length - 1];
    const trs = detail ? [...detail.querySelectorAll("tbody tr")] : [];
    const stock = trs.map(tr => parseFloat(tr.children[10]?.textContent)).filter(n => !isNaN(n));
    return {
      rows: trs.length,
      noBridge: document.querySelectorAll("#cable-calc-root span[title^='No floor plan bridge']").length,
      warning: !!document.querySelector("#cable-calc-root .alert-warning"),
      summary: document.querySelector("#cable-calc-root .card-header")?.textContent.trim(),
      minStock: Math.min(...stock), maxStock: Math.max(...stock),
    };
  });
  check("Suite 15 BOM lists 144 cables", bom.rows === 144, `${bom.rows} rows; ${bom.summary}`);
  check("Suite 15 BOM has no missing-bridge flags", bom.rows > 0 && bom.noBridge === 0 && !bom.warning, `${bom.noBridge} badges, warning=${bom.warning}`);
  check("Suite 15 BOM lengths use the bridge (80-95 ft)", bom.rows > 0 && bom.minStock >= 80 && bom.maxStock <= 95, `${bom.minStock}-${bom.maxStock} ft`);
  await shot("4-suite15-bom", false);

  // 5. Missing-bridge warning and badges render. Nothing is flagged in live
  // data, so mark 2 cables in the BOM response inside this browser only.
  await page.route("**/plugins/cable-calc/bom/**", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    (body.cables || []).slice(0, 2).forEach(c => { c.missing_bridge = true; });
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole("button", { name: /Calculate all cables/ }).click();
  await page.waitForSelector("#cable-calc-root .alert-warning", { timeout: 60000 }).catch(() => {});
  const flagged = await page.evaluate(() => ({
    badges: document.querySelectorAll("#cable-calc-root span[title^='No floor plan bridge']").length,
    warning: document.querySelector("#cable-calc-root .alert-warning")?.textContent.trim() || "",
  }));
  check("flagged cables show 2 'no bridge' badges", flagged.badges === 2, `${flagged.badges} badges`);
  const flagColor = await page.$eval("#cable-calc-root span[title^='No floor plan bridge']", e => getComputedStyle(e).color).catch(() => "");
  check("'no bridge' flag is red", flagColor === "rgb(214, 57, 57)", flagColor);
  check("flagged cables show the warning with the count", /^2 cables cross rows with no bridge route/.test(flagged.warning), flagged.warning.slice(0, 60));
  await shot("5-bom-flag-ui", false);
  await page.unroute("**/plugins/cable-calc/bom/**");

  // 6. Saves need a CSRF token and NetBox permissions. Uses a site with no
  // racks and an empty length list, so nothing can be written even if the
  // test user is later given permissions.
  const saves = await page.evaluate(async () => {
    const post = async (url, body, token) => {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-CSRFToken"] = token;
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch (_) {}
      return { status: r.status, json };
    };
    const token = window.NETBOX_CSRF_TOKEN;
    return {
      hasToken: !!token,
      layoutNoToken: await post("/plugins/cable-calc/layout/?site_id=999999999", { layout: {}, bridges: [] }, null),
      layoutWithToken: await post("/plugins/cable-calc/layout/?site_id=999999999", { layout: {}, bridges: [] }, token),
      lengthsWithToken: await post("/plugins/cable-calc/bom/", { lengths: {} }, token),
      hiddenSite: (await fetch("/plugins/cable-calc/racks/?site_id=999999999")).status,
    };
  });
  check("page provides a CSRF token", saves.hasToken);
  check("layout save without CSRF token is blocked", saves.layoutNoToken.status === 403 && !saves.layoutNoToken.json, `HTTP ${saves.layoutNoToken.status}`);
  check("layout save with token reaches the permission check", saves.layoutWithToken.status === 403 && /permission/.test(saves.layoutWithToken.json?.error || ""), `HTTP ${saves.layoutWithToken.status} ${saves.layoutWithToken.json?.error || ""}`);
  check("length save without cable permission is refused", saves.lengthsWithToken.status === 403 && /permission/.test(saves.lengthsWithToken.json?.error || ""), `HTTP ${saves.lengthsWithToken.status} ${saves.lengthsWithToken.json?.error || ""}`);

  check("a site the user can't view is not found", saves.hiddenSite === 404, `HTTP ${saves.hiddenSite}`);

  // 7. Browser Calculator routing matches the server BOM for every cable
  const parity = await compareRouting(page, 105);
  check("Calculator routing matches the server BOM (site 105)", parity.compared >= 1000 && parity.mismatches.length === 0,
        `${parity.compared} compared, ${parity.mismatches.length} differ${parity.mismatches.length ? ": " + parity.mismatches.slice(0, 2).join(" | ") : ""}`);

  // 8. No errors along the way
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  // The browser logs the 3 deliberate 403 saves and the 1 deliberate 404 above as console errors.
  const deliberate = t => /status of 40[34]/.test(t);
  const n403 = consoleErrors.filter(t => /status of 403/.test(t)).length, n404 = consoleErrors.filter(t => /status of 404/.test(t)).length;
  const otherConsole = consoleErrors.filter(t => !deliberate(t));
  check("no console errors (besides the deliberate 403s and 404)", otherConsole.length === 0 && n403 <= 3 && n404 <= 1, [...otherConsole.slice(0, 3), n403 > 3 ? `${n403} 403s` : "", n404 > 1 ? `${n404} 404s` : ""].filter(Boolean).join(" | "));
  const expectedFail = r => (r.startsWith("403 ") && /site_id=999999999|\/bom\/$/.test(r)) || (r.startsWith("404 ") && /racks\/\?site_id=999999999$/.test(r));
  const unexpected = failedRequests.filter(r => !expectedFail(r));
  check("no failed plugin requests (besides the deliberate 403s and 404)", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));

  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("ERROR", e.message); process.exit(2); });
