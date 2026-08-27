import { useState, useRef, useCallback, useEffect } from "react";
import { autoLayout, saveLayout, saveBridges } from "./floorplan.js";

const GRID = 12;
const SCALE = 0.5;
const ROW_H = 72;
const AISLE_H = 48;
const TRAY_Y = 12;
const MIN_RACK_PX = 80;
const ROW_COLORS = ["#e8f4fd","#e8fdf0","#fdf8e8","#fdeae8","#f0e8fd","#e8fdfd"];
const rowColor = idx => ROW_COLORS[idx % ROW_COLORS.length];
const snap = (val,grid) => Math.round(val/grid)*grid;
const inToPx = inches => inches*SCALE;
const pxToIn = px => px/SCALE;

function BridgeForm({rows, bridge, onSave, onCancel}) {
  const [form, setForm] = useState(bridge || {label:"",x:120,rowIdA:(rows[0]&&rows[0].id)||"",rowIdB:(rows[1]&&rows[1].id)||"",lengthIn:36,pathType:"copper"});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  return (
    <div className="card mb-2">
      <div className="card-body p-2">
        <div className="row g-2 align-items-end">
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>Label</label>
            <input className="form-control form-control-sm" value={form.label} onChange={e=>set("label",e.target.value)} placeholder="Bridge A"/></div>
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
              {rows.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div className="col-2"><label className="form-label mb-1" style={{fontSize:11}}>To row</label>
            <select className="form-select form-select-sm" value={form.rowIdB} onChange={e=>set("rowIdB",e.target.value)}>
              {rows.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
          <div className="col-1 d-flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={()=>onSave(form)}>Save</button>
            <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>X</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FloorPlan({racks,layout,setLayout,bridges,setBridges}) {
  const canvasRef = useRef(null);
  const dragging = useRef(null);
  const [addingBridge,setAddingBridge] = useState(false);
  const [editBridge,setEditBridge] = useState(null);
  const [canvasWidth,setCanvasWidth] = useState(900);

  useEffect(()=>{
    if (!canvasRef.current) return;
    const obs = new ResizeObserver(([e])=>setCanvasWidth(e.contentRect.width));
    obs.observe(canvasRef.current);
    return ()=>obs.disconnect();
  },[]);

  const rackMap = {};
  racks.forEach(r=>{rackMap[r.id]=r;});

  const rowBands = layout.rows.map((row,i)=>({
    ...row, bandY:i*(ROW_H+AISLE_H), aisleY:i*(ROW_H+AISLE_H)+ROW_H, color:rowColor(i)
  }));
  const totalH = rowBands.length*(ROW_H+AISLE_H);

  const positionedRacks = Object.keys(layout.rackPositions).map(idStr=>{
    const id=parseInt(idStr); const pos=layout.rackPositions[idStr];
    const rack=rackMap[id]; if(!rack) return null;
    const band=rowBands.find(b=>b.id===pos.rowId); if(!band) return null;
    const wPx=Math.max(MIN_RACK_PX,inToPx(rack.width_in||24));
    const xPx=inToPx(pos.x)-wPx/2;
    return {id,rack,pos,band,wPx,xPx};
  }).filter(Boolean);

  const positionedIds = new Set(Object.keys(layout.rackPositions).map(Number));
  const unpositioned = racks.filter(r=>!positionedIds.has(r.id));

  const onMouseDown = useCallback((e,rackId)=>{
    e.preventDefault();
    const rect=canvasRef.current.getBoundingClientRect();
    dragging.current={rackId,startXPx:e.clientX-rect.left,startX:(layout.rackPositions[rackId]&&layout.rackPositions[rackId].x)||0};
  },[layout]);

  const onMouseMove = useCallback((e)=>{
    if (!dragging.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const xPx=e.clientX-rect.left; const yPx=e.clientY-rect.top;
    const newX=snap(dragging.current.startX+pxToIn(xPx-dragging.current.startXPx),GRID);
    let targetRowId=layout.rackPositions[dragging.current.rackId]&&layout.rackPositions[dragging.current.rackId].rowId;
    for (let i=0;i<rowBands.length;i++){
      if (yPx>=rowBands[i].bandY&&yPx<rowBands[i].bandY+ROW_H){targetRowId=rowBands[i].id;break;}
    }
    setLayout(prev=>{
      const rp=Object.assign({},prev.rackPositions);
      rp[dragging.current.rackId]={x:Math.max(0,newX),rowId:targetRowId};
      return Object.assign({},prev,{rackPositions:rp});
    });
  },[layout,rowBands,setLayout]);

  const onMouseUp = useCallback(()=>{
    if (dragging.current){
      dragging.current=null;
      setLayout(current=>current);
    }
  },[setLayout]);

  const dropOnRow = useCallback((rackId,rowId)=>{
    const rack=rackMap[rackId];
    const others=Object.values(layout.rackPositions).filter(p=>p.rowId===rowId).map(p=>p.x);
    const maxX=others.length>0?Math.max(...others)+(rack&&rack.width_in||24):(rack&&rack.width_in||24)/2;
    setLayout(prev=>{const rp=Object.assign({},prev.rackPositions);rp[rackId]={x:maxX,rowId};return Object.assign({},prev,{rackPositions:rp});});
  },[layout,rackMap,setLayout]);

  const saveBridgeFn = useCallback((form)=>{
    const id=editBridge||("bridge-"+Date.now());
    const updated=editBridge?bridges.map(b=>b.id===editBridge?Object.assign({},form,{id}):b):bridges.concat([Object.assign({},form,{id})]);
    setBridges(updated);
    setAddingBridge(false);setEditBridge(null);
  },[editBridge,setBridges,bridges]);

  const deleteBridge = useCallback((id)=>{
    setBridges(bridges.filter(b=>b.id!==id));
  },[setBridges,bridges]);

  const runAutoLayout = ()=>{const l=autoLayout(racks);setLayout(l);saveLayout(l);};
  const svgW=Math.max(canvasWidth,600);
  const svgH=Math.max(totalH+ROW_H,120);

  return (
    <div>
      <div className="d-flex gap-2 align-items-center mb-2 flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={runAutoLayout}>Auto-layout from NetBox</button>
        <button className="btn btn-outline-primary btn-sm" onClick={()=>{setAddingBridge(true);setEditBridge(null);}}>+ Add bridge</button>
        <span className="text-muted ms-2" style={{fontSize:12}}>Drag racks to reposition. Grid: {GRID}" snap.</span>
      </div>

      {(addingBridge||editBridge)&&(
        <BridgeForm rows={layout.rows}
          bridge={editBridge?bridges.find(b=>b.id===editBridge):null}
          onSave={saveBridgeFn}
          onCancel={()=>{setAddingBridge(false);setEditBridge(null);}}/>
      )}

      {bridges.length>0&&(
        <div className="d-flex gap-2 flex-wrap mb-2">
          {bridges.map(b=>(
            <div key={b.id} className={`badge ${b.pathType==="fiber"?"bg-success":"bg-warning text-dark"} d-flex align-items-center gap-1`} style={{fontSize:11,fontWeight:400}}>
              <span style={{cursor:"pointer"}} onClick={()=>setEditBridge(b.id)}>
                {b.label||("Bridge @ "+b.x+'"')} ({b.lengthIn}") {b.rowIdA} to {b.rowIdB} [{b.pathType==="fiber"?"Fiber":"Copper"}]
              </span>
              <button type="button" className="btn-close ms-1" style={{fontSize:8}} onClick={()=>deleteBridge(b.id)}/>
            </div>
          ))}
        </div>
      )}

      {unpositioned.length>0&&(
        <div className="card mb-2"><div className="card-body p-2">
          <div className="text-muted mb-1" style={{fontSize:11,fontWeight:500,textTransform:"uppercase"}}>Unpositioned racks</div>
          <div className="d-flex gap-1 flex-wrap">
            {unpositioned.map(r=>(
              <div key={r.id} className="d-flex align-items-center gap-1 border rounded p-1" style={{fontSize:11}}>
                <code>{r.name}</code>
                {layout.rows.map(row=>(
                  <button key={row.id} className="btn btn-outline-secondary btn-sm py-0 px-1" style={{fontSize:10}} onClick={()=>dropOnRow(r.id,row.id)}>{row.label}</button>
                ))}
              </div>
            ))}
          </div>
        </div></div>
      )}

      <div className="card mb-2"><div className="card-body p-2">
        <div className="text-muted mb-2" style={{fontSize:11,fontWeight:500,textTransform:"uppercase"}}>Rows</div>
        <div className="d-flex gap-3 flex-wrap align-items-center">
          {layout.rows.map((row,i)=>(
            <div key={row.id} className="d-flex align-items-center gap-1" style={{fontSize:12}}>
              <span className="badge" style={{background:rowColor(i),color:"#333",border:"1px solid #ccc"}}>{row.label}</span>
              <span className="text-muted">aisle after:</span>
              <input type="number" className="form-control form-control-sm" style={{width:60}} value={row.aisleAfter||60}
                onChange={e=>{const v=parseFloat(e.target.value)||60;setLayout(prev=>({...prev,rows:prev.rows.map(r=>r.id===row.id?{...r,aisleAfter:v}:r)}));}}/>
              <span className="text-muted">in</span>
            </div>
          ))}
          <button className="btn btn-outline-secondary btn-sm" onClick={()=>{
            const id="row-"+Date.now();
            setLayout(prev=>({...prev,rows:[...prev.rows,{id,label:"Row "+(prev.rows.length+1),aisleAfter:60}]}));
          }}>+ Add row</button>
        </div>
      </div></div>

      <div ref={canvasRef} style={{overflowX:"auto",border:"1px solid #dee2e6",borderRadius:4,background:"#fff"}}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        {rowBands.length===0&&(
          <div className="text-muted text-center py-4" style={{fontSize:13}}>
            Click "Auto-layout from NetBox" or add rows to get started.
          </div>
        )}
        <svg width={svgW} height={svgH} style={{display:"block"}}>
          {rowBands.map(band=>(
            <g key={band.id}>
              <rect x={0} y={band.bandY} width={svgW} height={ROW_H} fill={band.color} stroke="#dee2e6" strokeWidth={0.5}/>
              <text x={8} y={band.bandY+15} style={{fontSize:11,fill:"#6c757d",fontWeight:500}}>{band.label}</text>
              <line x1={0} y1={band.bandY+TRAY_Y-4} x2={svgW} y2={band.bandY+TRAY_Y-4} stroke="#1D9E75" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/>
              <line x1={0} y1={band.bandY+TRAY_Y+4} x2={svgW} y2={band.bandY+TRAY_Y+4} stroke="#D85A30" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}/>
              {band.aisleY<totalH&&<rect x={0} y={band.aisleY} width={svgW} height={AISLE_H} fill="#f8f9fa" stroke="#dee2e6" strokeWidth={0.5}/>}
            </g>
          ))}

          {bridges.map(b=>{
            const bandA=rowBands.find(r=>r.id===b.rowIdA);
            const bandB=rowBands.find(r=>r.id===b.rowIdB);
            if (!bandA||!bandB) return null;
            const xPx=inToPx(b.x);
            const isFiber=b.pathType==="fiber";
            const offset=isFiber?-4:4;
            const col=isFiber?"#1D9E75":"#D85A30";
            const y1=bandA.bandY+TRAY_Y+offset; const y2=bandB.bandY+TRAY_Y+offset;
            return (
              <g key={b.id}>
                <line x1={xPx} y1={y1} x2={xPx} y2={y2} stroke={col} strokeWidth={2} strokeDasharray="6 3"/>
                <circle cx={xPx} cy={y1} r={4} fill={col}/>
                <circle cx={xPx} cy={y2} r={4} fill={col}/>
                <text x={xPx+6} y={(y1+y2)/2} style={{fontSize:10,fill:col,fontFamily:"monospace"}}>
                  {b.label||(b.x+'"')} {isFiber?"(F)":"(C)"}
                </text>
              </g>
            );
          })}

          {positionedRacks.map(({id,rack,band,wPx,xPx})=>(
            <g key={id} style={{cursor:"grab"}} onMouseDown={e=>onMouseDown(e,id)}>
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
        Bridges: (F) = fiber, (C) = copper &nbsp;&middot;&nbsp; Drag racks to reposition.
      </div>
    </div>
  );
}
