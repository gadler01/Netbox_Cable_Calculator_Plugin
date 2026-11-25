// Browser Calculator vs server BOM: runs the browser's routing code
// (routeCable in ui/src/floorplan.js) on every cable in a site's BOM and
// compares it with the server's breakdown. Read-only.
//
// Used by check.js. Can also run alone:
//   node parity.js <session-cookie-file> [site-id] [base-url]
const fs = require("fs");
const path = require("path");

const FIBER = new Set(["om3", "om4", "os2", "aoc"]);

async function loadRouteCable() {
  const src = fs.readFileSync(path.join(__dirname, "../ui/src/floorplan.js"), "utf8");
  const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  return mod.routeCable;
}

// page must be logged in and on a cable-calc page (for window.NETBOX_CFG).
async function compareRouting(page, siteId) {
  const routeCable = await loadRouteCable();
  const data = await page.evaluate(async sid => {
    const get = async u => (await fetch(u)).json();
    return {
      cfg: window.NETBOX_CFG || {},
      racks: (await get(`/plugins/cable-calc/racks/?site_id=${sid}`)).racks,
      layout: await get(`/plugins/cable-calc/layout/?site_id=${sid}`),
      bom: (await get(`/plugins/cable-calc/bom/?site_id=${sid}&recalculate=true`)).cables,
    };
  }, siteId);

  const cfg = data.cfg;
  const rowSpacing = cfg.aisle_width ?? 60;
  const rackByName = {};
  const dupNames = new Set();
  data.racks.forEach(r => { if (rackByName[r.name]) dupNames.add(r.name); rackByName[r.name] = r; });
  const layout = (data.layout && data.layout.layout) || { rows: [], rackPositions: {} };
  const bridges = (data.layout && data.layout.bridges) || [];

  let compared = 0, skipped = 0;
  const mismatches = [];
  for (const c of data.bom) {
    if (c.same_rack || c.error || dupNames.has(c.src_rack) || dupNames.has(c.dst_rack)) { skipped++; continue; }
    const sr = rackByName[c.src_rack], dr = rackByName[c.dst_rack];
    if (!sr || !dr) { skipped++; continue; }
    const fiber = FIBER.has(c.media);
    const kind = fiber ? "fiber" : "copper";
    const bridgeLen = fiber ? (cfg.fiber_bridge_length ?? 36) : (cfg.copper_bridge_length ?? 36);
    const ep = r => ({ rackId: r.id, row: r.row, rowIndex: r.row_index, rackCenterOffset: r.center_offset });
    const res = routeCable(ep(sr), ep(dr), layout, bridges.filter(b => !b.pathType || b.pathType === kind),
                           data.racks, { rowSpacing, bridgeLen });
    const bd = c.breakdown || {};
    const diffs = [];
    const near = (a, b) => Math.abs(a - b) <= 0.011;
    if (!near(res.horizIn, bd.horizontal)) diffs.push(`horizontal ${res.horizIn.toFixed(2)} vs ${bd.horizontal}`);
    if (!near(res.rowTravelIn, bd.row_travel)) diffs.push(`row travel ${res.rowTravelIn.toFixed(2)} vs ${bd.row_travel}`);
    if (!near(res.bridgeIn, bd.bridge)) diffs.push(`bridge ${res.bridgeIn.toFixed(2)} vs ${bd.bridge}`);
    if (res.missingBridge !== !!c.missing_bridge) diffs.push(`missing bridge ${res.missingBridge} vs ${!!c.missing_bridge}`);
    if (res.source !== bd.bridge_source) diffs.push(`source ${res.source} vs ${bd.bridge_source}`);
    compared++;
    if (diffs.length) mismatches.push(`cable ${c.cable_id} (${c.src_rack} -> ${c.dst_rack}, ${kind}): ${diffs.join("; ")}`);
  }
  return { total: data.bom.length, compared, skipped, mismatches };
}

module.exports = { compareRouting };

if (require.main === module) {
  (async () => {
    const { chromium } = require("playwright");
    const [sessionFile, siteId = "105", base = "https://nbupg"] = process.argv.slice(2);
    if (!sessionFile) throw new Error("usage: node parity.js <session-cookie-file> [site-id] [base-url]");
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies([{ name: "sessionid", value: fs.readFileSync(sessionFile, "utf8").trim(), url: base }]);
    const page = await context.newPage();
    await page.goto(`${base}/plugins/cable-calc/?site_id=${siteId}`, { waitUntil: "networkidle" });
    const r = await compareRouting(page, siteId);
    console.log(`site ${siteId}: ${r.compared} compared, ${r.skipped} skipped (same rack/unknown), of ${r.total} cables`);
    r.mismatches.slice(0, 20).forEach(m => console.log("  MISMATCH " + m));
    console.log(r.mismatches.length ? `${r.mismatches.length} mismatches` : "all match");
    await browser.close();
    process.exit(r.mismatches.length ? 1 : 0);
  })().catch(e => { console.error("ERROR", e.message); process.exit(2); });
}
