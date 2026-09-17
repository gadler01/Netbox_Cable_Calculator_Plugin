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

export async function loadFromServer(siteId, locationId) {
  try {
    const params = new URLSearchParams();
    if (siteId)     params.set("site_id", siteId);
    if (locationId) params.set("location_id", locationId);
    if (!params.toString()) return null;
    const url = "/plugins/cable-calc/layout/?" + params;
    //console.log("loadFromServer fetching:", url);
    const res = await fetch(url);
    //console.log("loadFromServer response status:", res.status);
    const data = await res.json();
    //console.log("loadFromServer data:", JSON.stringify(data).substring(0, 200));
    if (data.layout && data.layout.rows && data.layout.rows.length > 0) {
      return { layout: data.layout, bridges: data.bridges || [] };
    }
    return null;
  } catch(e) { 
    console.log("loadFromServer error:", e);
    return null; 
  }
}
export async function saveToServer(layout, bridges, siteId, locationId) {
  try {
    const params = new URLSearchParams();
    if (siteId)     params.set("site_id", siteId);
    if (locationId) params.set("location_id", locationId);
    if (!params.toString()) return false;
    //console.log("saveToServer called, layout rows:", layout?.rows?.length, "positions:", Object.keys(layout?.rackPositions||{}).length);
    const res = await fetch("/plugins/cable-calc/layout/?" + params, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("csrftoken") },
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
export function shortestPath(srcRackId, dstRackId, layout, bridges, infra) {
  const rackPositions = layout.rackPositions;
  const rows = layout.rows;
  const srcPos = rackPositions[srcRackId];
  const dstPos = rackPositions[dstRackId];
  if (!srcPos || !dstPos) return null;
  if (srcPos.rowId === dstPos.rowId) {
    const horizIn = Math.abs(dstPos.x - srcPos.x);
    return { totalIn: horizIn, horizIn: horizIn, bridgesUsed: [], sameRow: true,
      path: [{ type: "horiz", rowId: srcPos.rowId, fromX: srcPos.x, toX: dstPos.x, dist: horizIn }] };
  }
  const rowIndex = {};
  rows.forEach(function(r,i){ rowIndex[r.id] = Object.assign({},r,{index:i}); });
  const srcRow = rowIndex[srcPos.rowId];
  const dstRow = rowIndex[dstPos.rowId];
  if (!srcRow || !dstRow) return null;
  const srcRowIdx = srcRow.index;
  const dstRowIdx = dstRow.index;
  const minRowIdx = Math.min(srcRowIdx, dstRowIdx);
  const maxRowIdx = Math.max(srcRowIdx, dstRowIdx);
  const direction = srcRowIdx < dstRowIdx ? 1 : -1;
  const bridgesByBoundary = {};
  bridges.forEach(function(b) {
    const rA = rowIndex[b.rowIdA];
    const rB = rowIndex[b.rowIdB];
    if (!rA || !rB) return;
    const lo = Math.min(rA.index, rB.index);
    const hi = Math.max(rA.index, rB.index);
    if (hi !== lo+1) return;
    if (lo < minRowIdx || lo >= maxRowIdx) return;
    const key = lo+"-"+hi;
    if (!bridgesByBoundary[key]) bridgesByBoundary[key] = [];
    bridgesByBoundary[key].push(b);
  });
  const boundaries = [];
  let i = srcRowIdx;
  while (direction > 0 ? i < dstRowIdx : i > dstRowIdx) {
    const lo = direction > 0 ? i : i-1;
    const hi = lo+1;
    const key = lo+"-"+hi;
    if (!bridgesByBoundary[key] || bridgesByBoundary[key].length === 0) {
      return { totalIn: null, error: "No bridge between row "+lo+" and "+hi };
    }
    boundaries.push(bridgesByBoundary[key]);
    i += direction;
  }
  const queue = [{ cost:0, x:srcPos.x, bIdx:0, segs:[] }];
  let best = null;
  while (queue.length) {
    queue.sort(function(a,b){ return a.cost-b.cost; });
    const state = queue.shift();
    if (state.bIdx === boundaries.length) {
      const finalHoriz = Math.abs(dstPos.x - state.x);
      const total = state.cost + finalHoriz;
      if (best === null || total < best.totalIn) {
        const bridgeSegs = state.segs.filter(function(s){ return s.type==="bridge"; });
        best = { totalIn: total,
          horizIn: total - bridgeSegs.reduce(function(a,s){ return a+s.dist; },0),
          bridgesUsed: bridgeSegs.map(function(s){ return s.label; }),
          sameRow: false,
          path: state.segs.concat([{ type:"horiz", fromX:state.x, toX:dstPos.x, rowId:dstPos.rowId, dist:finalHoriz }]) };
      }
      continue;
    }
    boundaries[state.bIdx].forEach(function(bridge) {
      const horizToBridge = Math.abs(bridge.x - state.x);
      const bridgeCost = parseFloat(bridge.lengthIn || (infra&&infra.bridgeLength) || 36);
      queue.push({ cost: state.cost+horizToBridge+bridgeCost, x: bridge.x, bIdx: state.bIdx+1,
        segs: state.segs.concat([
          { type:"horiz", fromX:state.x, toX:bridge.x, dist:horizToBridge },
          { type:"bridge", x:bridge.x, dist:bridgeCost, label:bridge.label||("Bridge @ "+bridge.x+'"') }
        ])
      });
    });
  }
  return best || { totalIn: null, error: "No valid path found" };
}
