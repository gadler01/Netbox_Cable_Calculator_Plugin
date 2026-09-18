import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { groupRowsByLocation, isCrossLocationBridge } from "./floorplan.js";

const SCALE = 0.5;
const ROW_H = 72;
const AISLE_H = 48;
const TRAY_Y = 12;
const GROUP_HEADER_H = 28;
const MIN_RACK_PX = 80;
const ROW_COLORS = ["#e8f4fd","#e8fdf0","#fdf8e8","#fdeae8","#f0e8fd","#e8fdfd"];
const rowColor = idx => ROW_COLORS[idx % ROW_COLORS.length];
const inToPx = inches => inches*SCALE;

function rowLabel(row) {
  return `${row.locationName || "Site-level"} — ${row.label}`;
}

function CrossLocationBridgeForm({rows, bridge, onSave, onCancel}) {
  const firstOther = rows.find(r => r.id !== (rows[0] && rows[0].id) && r.locationId !== (rows[0] && rows[0].locationId));
  const [form, setForm] = useState(bridge || {
    label: "", x: 120,
    rowIdA: (rows[0] && rows[0].id) || "",
    rowIdB: (firstOther || rows[1] || {}).id || "",
    lengthIn: 36, pathType: "copper",
  });
  const [error, setError] = useState(null);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const rowById = id => rows.find(r=>r.id===id);
  const trySave = () => {
    const a = rowById(form.rowIdA), b = rowById(form.rowIdB);
    if (!a || !b) { setError("Pick a row on both ends."); return; }
    if ((a.locationId ?? null) === (b.locationId ?? null)) {
      setError("Both ends are in the same location — use that location's own Floor plan tab for this bridge.");
      return;
    }
    onSave(form);
  };
  return (
    <div className="card mb-2">
      <div className="card-body p-2">
        <div className="row g-2 align-items-end">
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>Label</label>
            <input className="form-control form-control-sm" value={form.label} onChange={e=>set("label",e.target.value)} placeholder="Inter-location run"/></div>
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>X position (in)</label>
            <input type="number" className="form-control form-control-sm" value={form.x} onChange={e=>set("x",parseFloat(e.target.value)||0)}/></div>
          <div className="col-1"><label className="form-label mb-1" style={{fontSize:11}}>Length (in)</label>
            <input type="number" className="form-control form-control-sm" value={form.lengthIn} onChange={e=>set("lengthIn",parseFloat(e.target.value)||36)}/></div>
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>Path type</label>
            <select className="form-select form-select-sm" value={form.pathType||"copper"} onChange={e=>set("pathType",e.target.value)}>
              <option value="copper">Copper / ladder rack</option>
              <option value="fiber">Fiber tray</option>
            </select></div>
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>From row</label>
            <select className="form-select form-select-sm" value={form.rowIdA} onChange={e=>set("rowIdA",e.target.value)}>
              {rows.map(r=><option key={r.id} value={r.id}>{rowLabel(r)}</option>)}</select></div>
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>To row</label>
            <select className="form-select form-select-sm" value={form.rowIdB} onChange={e=>set("rowIdB",e.target.value)}>
              {rows.map(r=><option key={r.id} value={r.id}>{rowLabel(r)}</option>)}</select></div>
          <div className="col-1 d-flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={trySave}>Save</button>
            <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>X</button>
          </div>
        </div>
        {error && <div className="alert alert-warning py-1 mt-2 mb-0" style={{fontSize:11}}>{error}</div>}
      </div>
    </div>
  );
}

export default function SiteLayout({racks, layout, bridges, setBridges, locations, siteName}) {
  const canvasRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(900);
  const [addingBridge, setAddingBridge] = useState(false);
  const [editBridge, setEditBridge] = useState(null);

  useEffect(()=>{
    if (!canvasRef.current) return;
    const obs = new ResizeObserver(([e])=>setCanvasWidth(e.contentRect.width));
    obs.observe(canvasRef.current);
    return ()=>obs.disconnect();
  },[]);

  const rows = layout.rows || [];
  const rackMap = useMemo(()=>Object.fromEntries((racks||[]).map(r=>[r.id,r])),[racks]);
  const groups = useMemo(()=>groupRowsByLocation(rows),[rows]);

  const { rowBandMap, rowBandList, groupHeaders, totalH } = useMemo(()=>{
    let y = 0, counter = 0;
    const bandList = [];
    const headers = [];
    groups.forEach(g => {
      headers.push({ y, label: g.locationName, key: g.key });
      y += GROUP_HEADER_H;
      g.rows.forEach(row => {
        bandList.push({ ...row, bandY: y, aisleY: y+ROW_H, color: rowColor(counter) });
        counter++;
        y += ROW_H + AISLE_H;
      });
    });
    return {
      rowBandMap: Object.fromEntries(bandList.map(b=>[b.id,b])),
      rowBandList: bandList,
      groupHeaders: headers,
      totalH: y,
    };
  },[groups]);

  const positionedRacks = useMemo(()=>Object.keys(layout.rackPositions||{}).map(idStr=>{
    const id = parseInt(idStr);
    const pos = layout.rackPositions[idStr];
    const rack = rackMap[id]; if (!rack) return null;
    const band = rowBandMap[pos.rowId]; if (!band) return null;
    const wPx = Math.max(MIN_RACK_PX, inToPx(rack.width_in||24));
    const xPx = inToPx(pos.x)-wPx/2;
    return { id, rack, band, wPx, xPx };
  }).filter(Boolean),[layout.rackPositions, rackMap, rowBandMap]);

  const crossBridges = useMemo(()=>(bridges||[]).filter(b=>isCrossLocationBridge(rows,b)),[bridges,rows]);

  const coveredLocationIds = new Set(groups.map(g=>g.locationId).filter(id=>id!=null).map(String));
  const missingLocations = (locations||[]).filter(l=>!coveredLocationIds.has(String(l.id)));

  const saveBridgeFn = useCallback((form)=>{
    const id = editBridge || ("sitebridge-"+Date.now());
    const updated = editBridge
      ? (bridges||[]).map(b=>b.id===editBridge?{...form,id}:b)
      : (bridges||[]).concat([{...form,id}]);
    setBridges(updated);
    setAddingBridge(false); setEditBridge(null);
  },[editBridge,bridges,setBridges]);

  const deleteBridge = useCallback((id)=>{
    setBridges((bridges||[]).filter(b=>b.id!==id));
  },[bridges,setBridges]);

  const svgW = Math.max(canvasWidth, 600);
  const svgH = Math.max(totalH, 120);

  if (rows.length===0) {
    return (
      <div className="alert alert-info py-3" style={{fontSize:13}}>
        No location in {siteName||"this site"} has a saved floor plan yet. Open a specific location's
        Floor plan tab and use "Auto-layout from NetBox" (or arrange racks manually) so it shows up here.
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex gap-2 align-items-center mb-2 flex-wrap">
        <button className="btn btn-outline-primary btn-sm" onClick={()=>{setAddingBridge(true);setEditBridge(null);}}>+ Add cross-location bridge</button>
        <span className="text-muted ms-2" style={{fontSize:12}}>
          Read-only overview of every location's floor plan. Drag racks and edit rows from that location's own Floor plan tab.
        </span>
      </div>

      {missingLocations.length>0&&(
        <div className="alert alert-warning py-2" style={{fontSize:12}}>
          {missingLocations.length} location{missingLocations.length!==1?"s":""} with no saved floor plan yet, so not shown below: {missingLocations.map(l=>l.name).join(", ")}.
        </div>
      )}

      {(addingBridge||editBridge)&&(
        <CrossLocationBridgeForm rows={rows}
          bridge={editBridge?bridges.find(b=>b.id===editBridge):null}
          onSave={saveBridgeFn}
          onCancel={()=>{setAddingBridge(false);setEditBridge(null);}}/>
      )}

      {crossBridges.length>0&&(
        <div className="d-flex gap-2 flex-wrap mb-2">
          {crossBridges.map(b=>(
            <div key={b.id} className={`badge ${b.pathType==="fiber"?"bg-success":"bg-warning text-dark"} d-flex align-items-center gap-1`} style={{fontSize:11,fontWeight:400}}>
              <span style={{cursor:"pointer"}} onClick={()=>setEditBridge(b.id)}>
                {b.label||("Bridge @ "+b.x+'"')} ({b.lengthIn}") [{b.pathType==="fiber"?"Fiber":"Copper"}]
              </span>
              <button type="button" className="btn-close ms-1" style={{fontSize:8}} onClick={()=>deleteBridge(b.id)}/>
            </div>
          ))}
        </div>
      )}

      <div ref={canvasRef} style={{overflowX:"auto",border:"1px solid #dee2e6",borderRadius:4,background:"#fff"}}>
        <svg width={svgW} height={svgH} style={{display:"block"}}>
          {groupHeaders.map(h=>(
            <g key={h.key}>
              <rect x={0} y={h.y} width={svgW} height={GROUP_HEADER_H} fill="#343a40"/>
              <text x={8} y={h.y+GROUP_HEADER_H-9} style={{fontSize:12,fill:"#fff",fontWeight:600}}>{h.label}</text>
            </g>
          ))}

          {rowBandList.map(band=>(
            <g key={band.id}>
              <rect x={0} y={band.bandY} width={svgW} height={ROW_H} fill={band.color} stroke="#dee2e6" strokeWidth={0.5}/>
              <text x={8} y={band.bandY+15} style={{fontSize:11,fill:"#6c757d",fontWeight:500}}>{band.label}</text>
              <line x1={0} y1={band.bandY+TRAY_Y-4} x2={svgW} y2={band.bandY+TRAY_Y-4} stroke="#1D9E75" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/>
              <line x1={0} y1={band.bandY+TRAY_Y+4} x2={svgW} y2={band.bandY+TRAY_Y+4} stroke="#D85A30" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/>
              {band.aisleY<totalH&&<rect x={0} y={band.aisleY} width={svgW} height={AISLE_H} fill="#f8f9fa" stroke="#dee2e6" strokeWidth={0.5}/>}
            </g>
          ))}

          {(bridges||[]).map(b=>{
            const bandA = rowBandMap[b.rowIdA];
            const bandB = rowBandMap[b.rowIdB];
            if (!bandA||!bandB) return null;
            const cross = isCrossLocationBridge(rows,b);
            const xPx = inToPx(b.x);
            const isFiber = b.pathType==="fiber";
            const offset = isFiber?-4:4;
            const col = cross ? (isFiber?"#1D9E75":"#D85A30") : "#adb5bd";
            const y1 = bandA.bandY+TRAY_Y+offset, y2 = bandB.bandY+TRAY_Y+offset;
            return (
              <g key={b.id} style={{cursor:cross?"pointer":"default"}} onClick={cross?()=>setEditBridge(b.id):undefined}>
                <line x1={xPx} y1={y1} x2={xPx} y2={y2} stroke={col} strokeWidth={2} strokeDasharray={cross?"6 3":"2 3"} opacity={cross?1:0.6}/>
                <circle cx={xPx} cy={y1} r={4} fill={col}/>
                <circle cx={xPx} cy={y2} r={4} fill={col}/>
                <text x={xPx+6} y={(y1+y2)/2} style={{fontSize:10,fill:col,fontFamily:"monospace"}}>
                  {b.label||(b.x+'"')} {isFiber?"(F)":"(C)"}{!cross&&" · same location"}
                </text>
              </g>
            );
          })}

          {positionedRacks.map(({id,rack,band,wPx,xPx})=>(
            <g key={id}>
              <rect x={xPx} y={band.bandY+4} width={wPx} height={ROW_H-8} fill="#fff" stroke="#7F77DD" strokeWidth={1.5} rx={3}/>
              <text x={xPx+wPx/2} y={band.bandY+ROW_H/2+4} textAnchor="middle"
                transform={`rotate(-90,${xPx+wPx/2},${band.bandY+ROW_H/2})`}
                style={{fontSize:11,fill:"#333",fontFamily:"monospace",pointerEvents:"none"}}>
                {rack.name}
              </text>
              <circle cx={xPx+wPx/2} cy={band.bandY+TRAY_Y} r={3} fill="#378ADD"/>
            </g>
          ))}
        </svg>
      </div>
      <div className="text-muted mt-1" style={{fontSize:11}}>
        <span style={{color:"#1D9E75"}}>&#9632;</span> Green = fiber tray &nbsp;
        <span style={{color:"#D85A30"}}>&#9632;</span> Orange = copper/ladder rack &nbsp;&middot;&nbsp;
        Bright bridges connect two locations and are editable here &middot; faded bridges belong to one location, edit them from that location's Floor plan tab.
      </div>
    </div>
  );
}
