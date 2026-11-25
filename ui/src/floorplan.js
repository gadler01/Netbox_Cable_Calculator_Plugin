function scopeKey(suffix) {
  const p = new URLSearchParams(window.location.search);
  const site = p.get("site_id") || "global";
  const loc  = p.get("location_id") || "all";
  return "cablecalc_" + suffix + "_s" + site + "_l" + loc;
}
function scopeParams() {
  const p = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  if (p.get("site_id"))     params.set("site_id",     p.get("site_id"));
  if (p.get("location_id")) params.set("location_id", p.get("location_id"));
  return params.toString();
}
function getCookie(name) {
  const v = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return v ? v.pop() : "";
}
// NetBox's csrftoken cookie is HttpOnly, so the template passes the token in.
export function csrfToken() {
  return window.NETBOX_CSRF_TOKEN || getCookie("csrftoken");
}

export async function loadFromServer(siteId, locationId) {
  try {
    const params = new URLSearchParams();
    if (siteId)     params.set("site_id", siteId);
    if (locationId) params.set("location_id", locationId);
    if (!params.toString()) return null;
    const url = "/plugins/cable-calc/layout/?" + params;
    const res = await fetch(url);
    const data = await res.json();
    if (data.layout && data.layout.rows && data.layout.rows.length > 0) {
      return { layout: data.layout, bridges: data.bridges || [] };
    }
    return null;
  } catch(e) {
    console.error("Error loading layout:", e);
    return null;
  }
}
export async function saveToServer(layout, bridges, siteId, locationId) {
  try {
    const params = new URLSearchParams();
    if (siteId)     params.set("site_id", siteId);
    if (locationId) params.set("location_id", locationId);
    if (!params.toString()) return false;
    const res = await fetch("/plugins/cable-calc/layout/?" + params, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
      body: JSON.stringify({ layout, bridges }),
    });
    return res.ok;
  } catch(_) { return false; }
}
export function saveLayout(layout) {
  try { sessionStorage.setItem(scopeKey("layout"), JSON.stringify(layout)); } catch(_) {}
}
export function saveBridges(bridges) {
  try { sessionStorage.setItem(scopeKey("bridges"), JSON.stringify(bridges)); } catch(_) {}
}
export function loadLayout() {
  try { const s = sessionStorage.getItem(scopeKey("layout")); return s ? JSON.parse(s) : null; } catch(_) { return null; }
}
export function loadBridges() {
  try { const s = sessionStorage.getItem(scopeKey("bridges")); return s ? JSON.parse(s) : null; } catch(_) { return null; }
}
// Rows returned by a site-wide (no location_id) layout fetch are tagged with
// locationId/locationName server-side (see _load_scoped_layout in views.py)
// so the site view can group them and tell a same-location bridge (owned by
// one location's own floorplan) apart from a cross-location one (owned by
// the site-level layout file).
export function rowLocation(rows, rowId) {
  const row = (rows || []).find(r => r.id === rowId);
  return row ? (row.locationId ?? null) : null;
}
export function isCrossLocationBridge(rows, bridge) {
  return rowLocation(rows, bridge.rowIdA) !== rowLocation(rows, bridge.rowIdB);
}
export function groupRowsByLocation(rows) {
  const groups = [];
  let current = null;
  (rows || []).forEach(row => {
    const key = row.locationId ?? null;
    if (!current || current.key !== key) {
      current = { key, locationId: row.locationId ?? null, locationName: row.locationName || "Site-level", rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  });
  return groups;
}
export function autoLayout(racks, aisleWidth) {
  const aw = aisleWidth || 60;
  const rowMap = {};
  racks.forEach(function(r) {
    const k = r.row || "?";
    if (!rowMap[k]) rowMap[k] = [];
    rowMap[k].push(r);
  });
  const rowKeys = Object.keys(rowMap).sort(function(a,b){ return a.localeCompare(b,undefined,{numeric:true}); });
  const rows = [];
  const rackPositions = {};
  let y = 0;
  rowKeys.forEach(function(rowKey) {
    const rowId = "row-" + rowKey;
    rows.push({ id: rowId, label: "Row " + rowKey, y: y, aisleAfter: aw });
    const sorted = rowMap[rowKey].slice().sort(function(a,b){ return (a.pos||0)-(b.pos||0); });
    let x = 0;
    sorted.forEach(function(r) {
      rackPositions[r.id] = { x: x + (r.width_in||24)/2, rowId: rowId };
      x += r.width_in || 24;
    });
    y += aw;
  });
  return { rows: rows, rackPositions: rackPositions };
}
// Cable routing between racks. This is a line-for-line port of the server's
// _build_rack_index / _build_bridge_graph / _bridge_path / _calc_length
// routing in views.py, so the Calculator and the BOM give the same length.
// If you change one, change the other; e2e/check.js compares them.
//
// src/dst: { rackId, row, rowIndex, rackCenterOffset } (rack data fallbacks)
// racks:   rack data list (id, location_id) used for same-location aisles
// opts:    { rowSpacing, bridgeLen } for this cable's path type
// bridges: already filtered to this cable's path type (fiber/copper)
// Returns { horizIn, rowTravelIn, bridgeIn, crossAisle, missingBridge,
//           source, bridgesUsed, path }.
export function routeCable(src, dst, layout, bridges, racks, opts) {
  const rowSpacing = Number(opts.rowSpacing) || 0;
  const bridgeLen  = Number(opts.bridgeLen) || 0;
  const rows = (layout && layout.rows) || [];
  const positions = (layout && layout.rackPositions) || {};
  const rowIdx = {};
  rows.forEach((r, i) => { rowIdx[r.id] = i; });

  // Where a rack sits: its floor plan position, else the server's guess
  // from the rack name (center offset 0), like _build_rack_index.
  const rackById = {};
  (racks || []).forEach(r => { rackById[r.id] = r; });
  const rackInfo = ep => {
    const pos = positions[ep.rackId];
    if (pos && rowIdx[pos.rowId] !== undefined)
      return { row: pos.rowId, rowIndex: rowIdx[pos.rowId], x: Number(pos.x) || 0 };
    const r = rackById[ep.rackId];
    return { row: (r ? r.row : ep.row) ?? null, rowIndex: (r ? r.row_index : ep.rowIndex) ?? 0, x: 0 };
  };
  const a = rackInfo(src), b = rackInfo(dst);
  const crossAisle = a.row !== b.row;

  // Graph: real bridges, plus estimated edges between consecutive rows in
  // the same location that no real bridge joins (_build_bridge_graph).
  const graph = {}, linked = new Set();
  const key2 = (p, q) => [p, q].sort().join("\u0000");
  const addEdge = (from, edge) => { (graph[from] = graph[from] || []).push(edge); };
  (bridges || []).forEach(br => {
    const ra = br.rowIdA, rb = br.rowIdB;
    if (!ra || !rb) return;
    const raw = br.lengthIn;
    const length = (raw === undefined || raw === null || raw === "") ? null : (parseFloat(raw) || 0);
    const x = parseFloat(br.x) || 0;
    const label = br.label || ("Bridge @ " + x + '"');
    addEdge(ra, { to: rb, length, x, crossed: null, label });
    addEdge(rb, { to: ra, length, x, crossed: null, label });
    linked.add(key2(ra, rb));
  });
  const rowsByLoc = {};
  (racks || []).forEach(r => {
    const pos = positions[r.id];
    if (!pos || rowIdx[pos.rowId] === undefined) return;
    const loc = String(r.location_id ?? "none");
    (rowsByLoc[loc] = rowsByLoc[loc] || {})[pos.rowId] = rowIdx[pos.rowId];
  });
  Object.values(rowsByLoc).forEach(locRows => {
    const ordered = Object.entries(locRows).sort((p, q) => p[1] - q[1]);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const [ra, ia] = ordered[i], [rb, ib] = ordered[i + 1];
      if (linked.has(key2(ra, rb))) continue;
      addEdge(ra, { to: rb, length: null, x: null, crossed: ib - ia });
      addEdge(rb, { to: ra, length: null, x: null, crossed: ib - ia });
    }
  });
  // Equal-length routes go to the lowest-x bridge (stable sort, like Python).
  Object.values(graph).forEach(edges => edges.sort((p, q) =>
    ((p.crossed !== null) - (q.crossed !== null)) || ((p.x ?? 0) - (q.x ?? 0))));

  // Dijkstra with the same tie-breaker as _bridge_path (push order).
  let pathEdges = null;
  if (crossAisle && Object.keys(graph).length && graph[a.row] && graph[b.row]) {
    const seen = new Set();
    let counter = 0;
    const heap = [{ dist: 0, n: 0, node: a.row, path: [] }];
    while (heap.length) {
      let best = 0;
      for (let i = 1; i < heap.length; i++)
        if (heap[i].dist < heap[best].dist || (heap[i].dist === heap[best].dist && heap[i].n < heap[best].n)) best = i;
      const cur = heap.splice(best, 1)[0];
      if (seen.has(cur.node)) continue;
      seen.add(cur.node);
      if (cur.node === b.row) { pathEdges = cur.path; break; }
      (graph[cur.node] || []).forEach(e => {
        if (seen.has(e.to)) return;
        const w = e.crossed === null ? (e.length ?? bridgeLen) : e.crossed * (rowSpacing + bridgeLen);
        counter += 1;
        heap.push({ dist: cur.dist + w, n: counter, node: e.to, path: cur.path.concat([e]) });
      });
    }
  }

  let horizIn = 0, rowTravelIn = 0, bridgeIn = 0, source = "n/a";
  const path = [], bridgesUsed = [];
  if (pathEdges) {
    let curX = a.x, real = false, estimated = false;
    pathEdges.forEach(e => {
      if (e.crossed === null) {
        const h = Math.abs(e.x - curX), len = e.length ?? bridgeLen;
        path.push({ type: "horiz", dist: h }, { type: "bridge", dist: len, label: e.label });
        bridgesUsed.push(e.label);
        horizIn += h; curX = e.x; bridgeIn += len; real = true;
      } else {
        const d = e.crossed * (rowSpacing + bridgeLen);
        path.push({ type: "aisle", dist: d, label: e.crossed === 1 ? "Aisle (est.)" : `${e.crossed} aisles (est.)` });
        rowTravelIn += e.crossed * rowSpacing; bridgeIn += e.crossed * bridgeLen; estimated = true;
      }
    });
    const h = Math.abs(b.x - curX);
    path.push({ type: "horiz", dist: h });
    horizIn += h;
    source = real ? (estimated ? "floorplan+estimated" : "floorplan") : "estimated";
  } else {
    horizIn = Math.abs(b.x - a.x);
    if (crossAisle) {
      const crossed = Math.abs(a.rowIndex - b.rowIndex);
      rowTravelIn = crossed * rowSpacing; bridgeIn = crossed * bridgeLen; source = "estimated";
    }
  }
  return { horizIn, rowTravelIn, bridgeIn, crossAisle, source, bridgesUsed,
           missingBridge: !!(crossAisle && !pathEdges), path: pathEdges ? path : null };
}
