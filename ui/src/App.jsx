import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import FloorPlan from "./FloorPlan.jsx";
import { autoLayout, loadLayout, loadBridges, saveLayout, saveBridges, shortestPath, loadFromServer, saveToServer } from "./floorplan.js";

const U_HEIGHT = 1.75;
const FT_TO_M  = 0.3048;

const IFACE_TYPES = {
  "1000base-t":     {label:"1000BASE-T",   media:"cat6",  connector:"RJ45",   speed:"1G"},
  "2.5gbase-t":     {label:"2.5GBASE-T",   media:"cat6a", connector:"RJ45",   speed:"2.5G"},
  "5gbase-t":       {label:"5GBASE-T",     media:"cat6a", connector:"RJ45",   speed:"5G"},
  "10gbase-t":      {label:"10GBASE-T",    media:"cat6a", connector:"RJ45",   speed:"10G"},
  "10gbase-cx4":    {label:"10GBASE-CX4",  media:"dac",   connector:"CX4",    speed:"10G"},
  "10gbase-cr":     {label:"10GBASE-CR",   media:"dac",   connector:"SFP+",   speed:"10G"},
  "25gbase-cr":     {label:"25GBASE-CR",   media:"dac",   connector:"SFP28",  speed:"25G"},
  "40gbase-cr4":    {label:"40GBASE-CR4",  media:"dac",   connector:"QSFP+",  speed:"40G"},
  "100gbase-cr4":   {label:"100GBASE-CR4", media:"dac",   connector:"QSFP28", speed:"100G"},
  "400gbase-cr4":   {label:"400GBASE-CR4", media:"dac",   connector:"QSFP-DD",speed:"400G"},
  "10gbase-sr":     {label:"10GBASE-SR",   media:"om3",   connector:"LC",     speed:"10G"},
  "25gbase-sr":     {label:"25GBASE-SR",   media:"om4",   connector:"LC",     speed:"25G"},
  "40gbase-sr4":    {label:"40GBASE-SR4",  media:"om4",   connector:"MPO-12", speed:"40G"},
  "100gbase-sr4":   {label:"100GBASE-SR4", media:"om4",   connector:"MPO-12", speed:"100G"},
  "400gbase-sr8":   {label:"400GBASE-SR8", media:"om4",   connector:"MPO-16", speed:"400G"},
  "1000base-lx":    {label:"1000BASE-LX",  media:"os2",   connector:"LC",     speed:"1G"},
  "10gbase-lr":     {label:"10GBASE-LR",   media:"os2",   connector:"LC",     speed:"10G"},
  "10gbase-er":     {label:"10GBASE-ER",   media:"os2",   connector:"LC",     speed:"10G"},
  "25gbase-lr":     {label:"25GBASE-LR",   media:"os2",   connector:"LC",     speed:"25G"},
  "40gbase-lr4":    {label:"40GBASE-LR4",  media:"os2",   connector:"LC",     speed:"40G"},
  "100gbase-lr4":   {label:"100GBASE-LR4", media:"os2",   connector:"LC",     speed:"100G"},
  "400gbase-lr8":   {label:"400GBASE-LR8", media:"os2",   connector:"LC",     speed:"400G"},
  "10gbase-sr-aoc": {label:"10G AOC",      media:"aoc",   connector:"SFP+",   speed:"10G"},
  "25gbase-sr-aoc": {label:"25G AOC",      media:"aoc",   connector:"SFP28",  speed:"25G"},
  "100gbase-sr-aoc":{label:"100G AOC",     media:"aoc",   connector:"QSFP28", speed:"100G"},
};

const IFACE_GROUPS = {
  "Copper":           ["1000base-t","2.5gbase-t","5gbase-t","10gbase-t"],
  "DAC / Twinax":     ["10gbase-cx4","10gbase-cr","25gbase-cr","40gbase-cr4","100gbase-cr4","400gbase-cr4"],
  "Multimode Fiber":  ["10gbase-sr","25gbase-sr","40gbase-sr4","100gbase-sr4","400gbase-sr8"],
  "Single-mode":      ["1000base-lx","10gbase-lr","10gbase-er","25gbase-lr","40gbase-lr4","100gbase-lr4","400gbase-lr8"],
  "Active Optical":   ["10gbase-sr-aoc","25gbase-sr-aoc","100gbase-sr-aoc"],
};

const MEDIA = {
  cat6:  {label:"Cat6",                    color:"primary", stdLengths:[1,1.5,2,3,5,7,10,15,20,25,30], fixedLength:false, slackMult:1.0,  unit:"ft"},
  cat6a: {label:"Cat6A",                   color:"primary", stdLengths:[1,1.5,2,3,5,7,10,15,20,25,30], fixedLength:false, slackMult:1.0,  unit:"ft"},
  om3:   {label:"Multimode Fiber (OM3)",   color:"warning", stdLengths:[1,2,3,5,7,10,15,20,30,50],     fixedLength:false, slackMult:1.05, unit:"m"},
  om4:   {label:"Multimode Fiber (OM4)",   color:"warning", stdLengths:[1,2,3,5,7,10,15,20,30,50],     fixedLength:false, slackMult:1.05, unit:"m"},
  os2:   {label:"Single-mode Fiber (OS2)", color:"success", stdLengths:[1,2,3,5,7,10,15,20,30,50,100], fixedLength:false, slackMult:1.05, unit:"m"},
  dac:   {label:"Direct Attach Copper (DAC)",color:"danger",stdLengths:[0.5,1,1.5,2,3,5,7,10],         fixedLength:true,  slackMult:0,    unit:"m"},
  aoc:   {label:"Active Optical Cable (AOC)",color:"success",stdLengths:[1,2,3,5,7,10,15,20,30],       fixedLength:true,  slackMult:0,    unit:"m"},
};

const FIBER_MEDIA = new Set(["om3","om4","os2","aoc"]);
function pathType(mk)            { return FIBER_MEDIA.has(mk) ? "fiber" : "copper"; }
function overheadFor(mk,infra)   { return pathType(mk)==="fiber" ? infra.fiberOverhead : infra.copperOverhead; }
function bridgeLenFor(mk,infra)  { return pathType(mk)==="fiber" ? infra.fiberBridgeLength : infra.copperBridgeLength; }
function displayUnit(mk)         { return (MEDIA[mk]??MEDIA.cat6).unit??"ft"; }
function toDisplay(ft,mk)        { const m=MEDIA[mk]??MEDIA.cat6; return m.unit==="m"?parseFloat((ft*FT_TO_M).toFixed(2)):parseFloat(ft.toFixed(2)); }

const stdLen = (ft,mk) => {
  const m=MEDIA[mk]??MEDIA.cat6;
  const val=m.unit==="m"?ft*FT_TO_M:ft;
  return m.stdLengths.find(x=>x>=val)??parseFloat(Math.ceil(val).toFixed(1));
};
const bomColor = (ft,mk) => {
  const m=MEDIA[mk]??MEDIA.cat6;
  const val=m.unit==="m"?ft*FT_TO_M:ft;
  const r=m.stdLengths.find(x=>x>=val)??Math.ceil(val);
  return r>m.stdLengths[m.stdLengths.length-1]?"danger":m.color;
};

function calcSegment(src,dst,infra,ifaceKey,layout,bridges) {
  const {rackDepth,portDepth,slack} = infra;
  const iface  = IFACE_TYPES[ifaceKey]??IFACE_TYPES["1000base-t"];
  const media  = MEDIA[iface.media]??MEDIA.cat6;
  const overhead = overheadFor(iface.media,infra);
  const ruFromTop = (pos,u) => (u-pos)*U_HEIGHT;

  const sameRack = src.rackId&&dst.rackId&&src.rackId===dst.rackId;
  if (sameRack) {
    const vert = Math.abs((src.ru-1)*U_HEIGHT-(dst.ru-1)*U_HEIGHT);
    const srcPE = src.face==="front"?portDepth:rackDepth;
    const dstPE = dst.face==="front"?portDepth:rackDepth;
    const rawIn = vert+srcPE+dstPE;
    const rawFt = rawIn/12;
    const effSlk = media.fixedLength?0:slack*media.slackMult;
    const withSlack = rawFt*(1+effSlk/100);
    const rec = stdLen(withSlack,iface.media);
    const unit = displayUnit(iface.media);
    const calcDisplay = toDisplay(withSlack,iface.media);
    return {srcV:vert,dstV:0,horizIn:0,portDepthTot:srcPE+dstPE,rawIn,rawFt,withSlack,rec,unit,calcDisplay,
            crossAisle:false,rowsCrossed:0,bridgesUsed:[],sameRack:true,pathResult:null,iface,media};
  }

  let srcV,srcPE;
  if (src.face==="front"){srcPE=portDepth; srcV=ruFromTop(src.ru,src.rackU)+overhead;}
  else                   {srcPE=rackDepth; srcV=(src.ru-1)*U_HEIGHT+src.rackU*U_HEIGHT+overhead;}
  let dstV,dstPE;
  if (dst.face==="front"){dstPE=portDepth; dstV=ruFromTop(dst.ru,dst.rackU)+overhead;}
  else                   {dstPE=rackDepth; dstV=dst.rackU*U_HEIGHT+(dst.ru-1)*U_HEIGHT+overhead;}

  const cablePathType = pathType(iface.media);
  const relevantBridges = (bridges||[]).filter(b=>!b.pathType||b.pathType===cablePathType);
  let horizIn=0,crossAisle=false,rowsCrossed=0,pathResult=null,bridgesUsed=[];

  if (src.rackId&&dst.rackId&&layout&&layout.rackPositions&&layout.rackPositions[src.rackId]&&layout.rackPositions[dst.rackId]) {
    pathResult = shortestPath(src.rackId,dst.rackId,layout,relevantBridges,infra);
    if (pathResult&&pathResult.totalIn!==null) {
      horizIn=pathResult.totalIn; crossAisle=!pathResult.sameRow; bridgesUsed=pathResult.bridgesUsed??[];
    } else {
      horizIn=Math.abs((dst.rackCenterOffset??0)-(src.rackCenterOffset??0)); crossAisle=src.row!==dst.row;
    }
  } else {
    horizIn=Math.abs((dst.rackCenterOffset??0)-(src.rackCenterOffset??0));
    crossAisle=src.row!==dst.row;
    rowsCrossed=Math.abs((src.rowIndex??0)-(dst.rowIndex??0));
  }

  const portDepthTot=srcPE+dstPE;
  const rawIn=srcV+dstV+horizIn+portDepthTot;
  const rawFt=rawIn/12;
  const effSlk=media.fixedLength?0:slack*media.slackMult;
  const withSlack=rawFt*(1+effSlk/100);
  const rec=stdLen(withSlack,iface.media);
  const unit=displayUnit(iface.media);
  const calcDisplay=toDisplay(withSlack,iface.media);
  return {srcV,dstV,horizIn,portDepthTot,rawIn,rawFt,withSlack,rec,unit,calcDisplay,
          crossAisle,rowsCrossed,bridgesUsed,sameRack:false,pathResult,iface,media};
}

function infraFromCfg(cfg={}) {
  return {
    fiberOverhead:      cfg.fiber_overhead??18,
    fiberBridgeLength:  cfg.fiber_bridge_length??36,
    copperOverhead:     cfg.copper_overhead??12,
    copperBridgeLength: cfg.copper_bridge_length??36,
    rowSpacing:         cfg.aisle_width??60,
    rackDepth:          cfg.rack_depth??48,
    portDepth:          cfg.port_depth??4,
    slack:              cfg.default_slack_pct??10,
  };
}

function getCookie(name) {
  const v=document.cookie.match("(^|;)\\s*"+name+"\\s*=\\s*([^;]+)");
  return v?v.pop():"";
}

function exportManualCSV(hops,results) {
  const hdr=["Segment","From device","From rack","From RU","From face","To device","To rack","To RU","To face","Interface","Media","Connector","Calc","Stock","Unit","Qty"];
  const rows=hops.map((h,i)=>{const r=results[i];return[h.label,h.src.deviceName,h.src.rackName,h.src.ru,h.src.face,h.dst.deviceName,h.dst.rackName,h.dst.ru,h.dst.face,r.iface.label,r.media.label,r.iface.connector,r.calcDisplay,r.rec,r.unit,1];});
  downloadCSV("cable_bom_manual.csv",[hdr,...rows]);
}
function exportBulkCSV(cables) {
  const hdr=["Cable ID","Color","Label","From device","From iface","From rack","From RU","From face","To device","To iface","To rack","To RU","To face","Media","Connector","Calc","Stock","Unit","Cross-aisle"];
  const rows=cables.map(c=>[c.cable_id,c.cable_color?"#"+c.cable_color:"",c.cable_label,c.src_device,c.src_iface,c.src_rack,c.src_ru,c.src_face,c.dst_device,c.dst_iface,c.dst_rack,c.dst_ru,c.dst_face,c.media,c.connector,c.with_slack,c.stock_ft,c.unit??"ft",c.cross_aisle?"Yes":"No"]);
  downloadCSV("cable_bom_bulk.csv",[hdr,...rows]);
}
function downloadCSV(filename,rows) {
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download=filename;a.click();
}
function printBOM(cables,scopeLabel) {
  const w=window.open("","_blank");
  const rows=cables.map(c=>`<tr><td>${c.cable_id}</td><td>${c.cable_color?`<span style="display:inline-block;width:16px;height:16px;background:#${c.cable_color};border:1px solid #ccc;vertical-align:middle;"></span>`:""}</td><td>${c.cable_label}</td><td>${c.src_device}<br><small>${c.src_rack} U${c.src_ru}</small></td><td>${c.dst_device}<br><small>${c.dst_rack} U${c.dst_ru}</small></td><td>${c.media}</td><td>${c.connector}</td><td>${c.with_slack} ft</td><td><strong>${c.stock_ft} ${c.unit??"ft"}</strong></td></tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><title>Cable BOM</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px}th{background:#f0f0f0}</style></head><body><h2>Cable BOM — ${scopeLabel}</h2><p>${cables.length} cables | ${new Date().toLocaleString()}</p><table><thead><tr><th>ID</th><th>Color</th><th>Label</th><th>From</th><th>To</th><th>Media</th><th>Connector</th><th>Calc</th><th>Stock</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();w.print();
}

const Badge = ({color,children}) => {
  const cls={blue:"primary",green:"success",amber:"warning",red:"danger",gray:"secondary"}[color]??color??"primary";
  return <span className={`badge bg-${cls}`} style={{fontSize:11}}>{children}</span>;
};
const Pill = ({children}) => <span className="badge bg-secondary" style={{fontSize:11,fontWeight:500}}>{children}</span>;
const SegBar = ({label,inches,total,col}) => {
  if (!inches) return null;
  const pct=total>0?(inches/total)*100:0;
  return (<div className="mb-1">
    <div className="d-flex justify-content-between" style={{fontSize:11,color:"#6c757d"}}><span>{label}</span><span>{(inches/12).toFixed(1)} ft</span></div>
    <div className="progress" style={{height:5}}><div className="progress-bar" style={{width:`${pct.toFixed(1)}%`,background:col}}/></div>
  </div>);
};
const FaceToggle = ({value,onChange}) => (
  <div className="btn-group btn-group-sm">
    {["front","rear"].map(f=>(
      <button key={f} type="button" className={`btn btn-${value===f?"primary":"outline-secondary"}`}
        style={{fontSize:12,padding:"2px 10px"}} onClick={()=>onChange(f)}>{f}</button>
    ))}
  </div>
);
const DeviceSelector = ({label,value,onChange,devices,rackMap,accent}) => {
  const borderColor=accent==="src"?"#7F77DD":"#1D9E75";
  const dev=devices.find(d=>d.id===value.deviceId);
  const rack=dev?rackMap[dev.rack_id]:null;
  return (
    <div className="card h-100" style={{borderTop:`3px solid ${borderColor}`}}>
      <div className="card-body p-2">
        <div className="fw-bold text-uppercase text-muted mb-2" style={{fontSize:10,letterSpacing:"0.05em"}}>{label}</div>
        <div className="mb-2">
          <label className="form-label mb-1" style={{fontSize:12}}>Device</label>
          <select className="form-select form-select-sm" value={value.deviceId??""} onChange={e=>{
            const d=devices.find(x=>x.id===parseInt(e.target.value));
            if (!d) return;
            const r=rackMap[d.rack_id];
            onChange({deviceId:d.id,deviceName:d.name,rackId:d.rack_id,rackName:d.rack_name,
              ru:d.position??1,rackU:r?.u_height??42,face:d.face??"rear",
              row:r?.row??"?",rowIndex:r?.row_index??0,rackCenterOffset:r?.center_offset??0});
          }}>
            <option value="">— select —</option>
            {devices.map(d=><option key={d.id} value={d.id}>{d.name} ({d.rack_name})</option>)}
          </select>
        </div>
        {dev&&rack&&(<>
          <div className="d-flex gap-2 flex-wrap mb-2 p-1 rounded" style={{background:"#f8f9fa",fontSize:11}}>
            <span>Rack <strong>{rack.name}</strong></span>
            <span>Row <strong>{rack.row??"?"}</strong></span>
            <span>Width <strong>{rack.width_in?.toFixed(1)}"</strong></span>
          </div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <label className="form-label mb-0" style={{fontSize:12,minWidth:60}}>RU</label>
            <input type="number" className="form-control form-control-sm" style={{width:70}}
              min={1} max={value.rackU} value={value.ru}
              onChange={e=>onChange({...value,ru:Math.min(parseInt(e.target.value)||1,value.rackU)})}/>
            <span className="text-muted" style={{fontSize:11}}>of {value.rackU}U</span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0" style={{fontSize:12,minWidth:60}}>Face</label>
            <FaceToggle value={value.face} onChange={v=>onChange({...value,face:v})}/>
          </div>
        </>)}
      </div>
    </div>
  );
};

let _id=1;
const mkEp  = () => ({deviceId:null,deviceName:"",rackId:null,rackName:"",ru:1,rackU:42,face:"rear",row:"?",rowIndex:0,rackCenterOffset:0});
const mkHop = (label="New segment",ifaceType="1000base-t") => ({id:_id++,label,ifaceType,src:mkEp(),dst:mkEp()});

function BulkBomTab({selected,scopeLabel,cfg}) {
  const [cables,setCables]   = useState([]);
  const [loading,setLoading] = useState(false);
  const [error,setError]     = useState(null);
  const [saving,setSaving]   = useState(false);
  const [saveMsg,setSaveMsg] = useState(null);
  const [filter,setFilter]   = useState({media:"",connector:"",srcRack:"",dstRack:"",stockFt:""});
  const [sortKey,setSortKey] = useState("src_rack");
  const [sortDir,setSortDir] = useState(1);

  const fetchBOM = useCallback(async()=>{
    setLoading(true);setError(null);setCables([]);
    try {
      const params=new URLSearchParams();
      if (selected.site_id)     params.set("site_id",selected.site_id);
      if (selected.location_id) params.set("location_id",selected.location_id);
      const res=await fetch(`/plugins/cable-calc/bom/?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      setCables(data.cables??[]);
    } catch(e){setError(e.message);}
    finally{setLoading(false);}
  },[selected]);

  const saveToNetBox = useCallback(async()=>{
    setSaving(true);setSaveMsg(null);
    try {
      const lengths={};
      cables.forEach(c=>{lengths[c.cable_id]=c.stock_ft;});
      const res=await fetch("/plugins/cable-calc/bom/",{
        method:"POST",
        headers:{"Content-Type":"application/json","X-CSRFToken":getCookie("csrftoken")},
        body:JSON.stringify({lengths}),
      });
      const text=await res.text();
      let data;
      try{data=JSON.parse(text);}catch(e){throw new Error("Non-JSON response: "+text.slice(0,100));}
      setSaveMsg(`Saved ${data.updated} cables.${data.errors?.length?" Errors: "+data.errors.join(", "):""}`)
    } catch(e){setSaveMsg("Error: "+e.message);}
    finally{setSaving(false);}
  },[cables]);

  const displayed = useMemo(()=>{
    let rows=cables.filter(c=>{
      if (filter.media&&c.media!==filter.media) return false;
      if (filter.connector&&c.connector!==filter.connector) return false;
      if (filter.srcRack&&!c.src_rack?.toLowerCase().includes(filter.srcRack.toLowerCase())) return false;
      if (filter.dstRack&&!c.dst_rack?.toLowerCase().includes(filter.dstRack.toLowerCase())) return false;
      if (filter.stockFt&&c.stock_ft!==parseFloat(filter.stockFt)) return false;
      return true;
    });
    rows.sort((a,b)=>{const av=a[sortKey]??"",bv=b[sortKey]??"";return typeof av==="number"?(av-bv)*sortDir:String(av).localeCompare(String(bv))*sortDir;});
    return rows;
  },[cables,filter,sortKey,sortDir]);

  const groups = useMemo(()=>{
    const g={};
    displayed.forEach(c=>{
      const k=`${c.media}|${c.connector}|${c.stock_ft}`;
      if (!g[k]) g[k]={media:c.media,connector:c.connector,stock_ft:c.stock_ft,unit:c.unit??"ft",count:0};
      g[k].count++;
    });
    return Object.values(g).sort((a,b)=>a.media.localeCompare(b.media)||a.stock_ft-b.stock_ft);
  },[displayed]);

  const mediaOptions     = [...new Set(cables.map(c=>c.media))].sort();
  const connectorOptions = [...new Set(cables.map(c=>c.connector))].sort();
  const stockFtOptions   = [...new Set(cables.map(c=>c.stock_ft))].sort((a,b)=>a-b);
  const thStyle={cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"};
  const sort=key=>{setSortDir(sortKey===key?-sortDir:1);setSortKey(key);};
  const arrow=key=>sortKey===key?(sortDir===1?" ↑":" ↓"):"";

  return (
    <div>
      <div className="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <button className="btn btn-primary btn-sm" onClick={fetchBOM} disabled={loading}>
          {loading?"Calculating...":"Calculate all cables"}
        </button>
        {cables.length>0&&(<>
          <button className="btn btn-outline-secondary btn-sm" onClick={()=>exportBulkCSV(displayed)}>Download CSV ({displayed.length})</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={()=>printBOM(displayed,scopeLabel)}>Print / PDF</button>
          <button className="btn btn-outline-warning btn-sm" onClick={saveToNetBox} disabled={saving}>{saving?"Saving...":"Save lengths to NetBox"}</button>
        </>)}
        {!selected.site_id&&<span className="text-warning ms-2" style={{fontSize:12}}>No site selected.</span>}
      </div>

      {error&&<div className="alert alert-danger py-2">{error}</div>}
      {saveMsg&&<div className={`alert py-2 ${saveMsg.startsWith("Error")?"alert-danger":"alert-success"}`}>{saveMsg}</div>}

      {cables.length>0&&(<>
        <div className="card mb-3">
          <div className="card-header py-2 fw-bold" style={{fontSize:13}}>
            BOM summary — {displayed.length} of {cables.length} cables
            {scopeLabel&&<span className="badge bg-primary ms-2" style={{fontWeight:400}}>{scopeLabel}</span>}
          </div>
          <div className="card-body p-2">
            <table className="table table-sm table-bordered mb-0" style={{fontSize:12}}>
              <thead className="table-light"><tr><th>Media</th><th>Connector</th><th>Stock length</th><th className="text-end">Qty</th></tr></thead>
              <tbody>
                {groups.map((g,i)=>(
                  <tr key={i}>
                    <td>{g.media.toUpperCase()}</td>
                    <td><Pill>{g.connector}</Pill></td>
                    <td className="fw-bold">{g.stock_ft} {g.unit}</td>
                    <td className="text-end fw-bold">{g.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="table-light"><tr><td colSpan={3} className="fw-bold">Total</td><td className="text-end fw-bold">{displayed.length}</td></tr></tfoot>
            </table>
          </div>
        </div>

        <div className="d-flex gap-2 flex-wrap mb-2 align-items-end">
          {[["Media","media",mediaOptions.map(m=>({v:m,l:m.toUpperCase()}))],
            ["Connector","connector",connectorOptions.map(c=>({v:c,l:c}))],
            ["Stock ft","stockFt",stockFtOptions.map(l=>({v:l,l:l+" ft"}))]].map(([label,key,opts])=>(
            <div key={key}>
              <label className="form-label mb-1" style={{fontSize:11}}>{label}</label>
              <select className="form-select form-select-sm" style={{minWidth:90}}
                value={filter[key]} onChange={e=>setFilter(f=>({...f,[key]:e.target.value}))}>
                <option value="">All</option>
                {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          ))}
          {[["Src rack","srcRack"],["Dst rack","dstRack"]].map(([label,key])=>(
            <div key={key}>
              <label className="form-label mb-1" style={{fontSize:11}}>{label}</label>
              <input className="form-control form-control-sm" style={{width:100}} value={filter[key]} placeholder="filter..."
                onChange={e=>setFilter(f=>({...f,[key]:e.target.value}))}/>
            </div>
          ))}
          {Object.values(filter).some(Boolean)&&(
            <button className="btn btn-outline-secondary btn-sm align-self-end"
              onClick={()=>setFilter({media:"",connector:"",srcRack:"",dstRack:"",stockFt:""})}>Clear</button>
          )}
        </div>

        <div className="card">
          <div className="card-body p-0" style={{overflowX:"auto"}}>
            <table className="table table-sm table-bordered table-hover mb-0" style={{fontSize:11}}>
              <thead className="table-light">
                <tr>
                  <th style={thStyle} onClick={()=>sort("cable_id")}>ID{arrow("cable_id")}</th>
                  <th>Color</th>
                  <th style={thStyle} onClick={()=>sort("cable_label")}>Label{arrow("cable_label")}</th>
                  <th style={thStyle} onClick={()=>sort("src_rack")}>Src rack{arrow("src_rack")}</th>
                  <th>Src device / iface</th>
                  <th style={thStyle} onClick={()=>sort("dst_rack")}>Dst rack{arrow("dst_rack")}</th>
                  <th>Dst device / iface</th>
                  <th style={thStyle} onClick={()=>sort("media")}>Media{arrow("media")}</th>
                  <th>Connector</th>
                  <th style={thStyle} onClick={()=>sort("with_slack")}>Calc{arrow("with_slack")}</th>
                  <th style={thStyle} onClick={()=>sort("stock_ft")}>Stock{arrow("stock_ft")}</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(c=>(
                  <tr key={c.cable_id}>
                    <td><a href={`/dcim/cables/${c.cable_id}/`} target="_blank" rel="noreferrer">{c.cable_id}</a></td>
                    <td>{c.cable_color
                      ?<span title={`#${c.cable_color}`} style={{display:"inline-block",width:20,height:20,background:`#${c.cable_color}`,border:"1px solid #dee2e6",borderRadius:3,verticalAlign:"middle"}}/>
                      :<span className="text-muted">—</span>}
                    </td>
                    <td>{c.cable_label}</td>
                    <td><code>{c.src_rack}</code></td>
                    <td>{c.src_device}<br/><span className="text-muted">{c.src_iface} U{c.src_ru} {c.src_face}</span></td>
                    <td><code>{c.dst_rack}</code></td>
                    <td>{c.dst_device}<br/><span className="text-muted">{c.dst_iface} U{c.dst_ru} {c.dst_face}</span></td>
                    <td><Badge color={MEDIA[c.media]?.color??"secondary"}>{c.media?.toUpperCase()}</Badge></td>
                    <td><Pill>{c.connector}</Pill></td>
                    <td>{c.with_slack} ft</td>
                    <td><strong>{c.stock_ft} {c.unit??"ft"}</strong></td>
                    <td>{c.cross_aisle&&<Badge color="warning">X-aisle</Badge>}{c.same_rack&&<Badge color="secondary">same rack</Badge>}{c.error&&<Badge color="danger">err</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {!loading&&cables.length===0&&!error&&(
        <div className="text-muted text-center py-5" style={{fontSize:14}}>
          Select a site and click "Calculate all cables" to generate the BOM.
        </div>
      )}
    </div>
  );
}

export default function App({racks=[],devices=[],cfg={},siteTree=[],selected={}}) {
  const rackMap = useMemo(()=>Object.fromEntries(racks.map(r=>[r.id,r])),[racks]);
  const [infra,setInfra]     = useState(()=>infraFromCfg(cfg));
  const [tab,setTab]         = useState("calc");
  const [hops,setHops]       = useState([mkHop("Device to patch panel"),mkHop("Panel to panel cross-connect","10gbase-sr"),mkHop("Patch panel to device")]);
  const [expanded,setExpanded] = useState(null);
  const [pendingSite,setPendingSite]         = useState(selected.site_id??"");
  const [pendingLocation,setPendingLocation] = useState(selected.location_id??"");
  const [layout,setLayout]   = useState({rows:[],rackPositions:{}});
  const [bridges,setBridges] = useState([]);
  const layoutRef  = useRef({rows:[],rackPositions:{}});
  const bridgesRef = useRef([]);
  const [layoutReady,setLayoutReady]   = useState(false);
  const [saveStatus,setSaveStatus]     = useState(null);

  useEffect(()=>{
    setLayout({rows:[],rackPositions:{}});
    setBridges([]);
    loadFromServer().then(data=>{
      if (data&&data.layout&&data.layout.rows&&data.layout.rows.length>0) {
        setLayout(data.layout); layoutRef.current=data.layout;
        setBridges(data.bridges||[]); bridgesRef.current=data.bridges||[];
      } else if (racks.length>0) {
        const auto=autoLayout(racks); setLayout(auto); layoutRef.current=auto;
      }
      setLayoutReady(true);
    });
  },[selected.site_id,selected.location_id]);

  useEffect(()=>{layoutRef.current=layout;},[layout]);
  useEffect(()=>{bridgesRef.current=bridges;},[bridges]);

  const setLayoutAndSave = (l)=>{
    setLayout(l); saveLayout(l); layoutRef.current=l;
    setSaveStatus("saving");
    saveToServer(l,bridgesRef.current).then(ok=>setSaveStatus(ok?"saved":"error"));
  };
  const setBridgesAndSave = (b)=>{
    setBridges(b); saveBridges(b); bridgesRef.current=b;
    setSaveStatus("saving");
    saveToServer(layoutRef.current,b).then(ok=>setSaveStatus(ok?"saved":"error"));
  };

  const si=(k,v)=>setInfra(p=>({...p,[k]:v}));
  const updHop=(id,f,v)=>setHops(hops.map(h=>h.id!==id?h:{...h,[f]:v}));
  const updEp=(id,s,v)=>setHops(hops.map(h=>h.id!==id?h:{...h,[s]:v}));
  const addHop=()=>{const l=hops[hops.length-1];setHops([...hops,mkHop("New segment",l.ifaceType)]);};
  const delHop=id=>setHops(hops.filter(h=>h.id!==id));

  const results    = hops.map(h=>calcSegment(h.src,h.dst,infra,h.ifaceType,layout,bridges));
  const totalSlack = results.reduce((s,r)=>s+r.withSlack,0);
  const isHomeRun  = hops.length===1;
  const unresolved = racks.filter(r=>!r.resolved);
  const byRow = racks.reduce((acc,r)=>{const row=r.row??"?";(acc[row]=acc[row]??[]).push(r);return acc;},{});
  const bomGroups = hops.reduce((acc,hop,i)=>{
    const res=results[i];const key=`${res.iface.media}|${res.iface.connector}`;
    if(!acc[key]) acc[key]={media:res.media,connector:res.iface.connector,cables:[]};
    acc[key].cables.push(res.rec+" "+res.unit);return acc;
  },{});

  const currentSite=siteTree.find(s=>s.id===(selected.site_id??null));
  const locations=currentSite?.locations??[];
  function applyScope(){
    const params=new URLSearchParams();
    if (pendingSite)     params.set("site_id",pendingSite);
    if (pendingLocation) params.set("location_id",pendingLocation);
    window.location.search=params.toString();
  }
  const scopeLabel=[currentSite?.name,locations.find(l=>l.id===selected.location_id)?.name].filter(Boolean).join(" > ");

  return (
    <div>
      <div className="d-flex align-items-end gap-2 mb-3 p-2 border rounded" style={{background:"#f8f9fa"}}>
        <div>
          <label className="form-label mb-1" style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em",color:"#6c757d"}}>Site</label>
          <select className="form-select form-select-sm" style={{minWidth:180}} value={pendingSite}
            onChange={e=>{setPendingSite(e.target.value);setPendingLocation("");}}>
            <option value="">All sites</option>
            {siteTree.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label mb-1" style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em",color:"#6c757d"}}>Location</label>
          <select className="form-select form-select-sm" style={{minWidth:180}} value={pendingLocation}
            onChange={e=>setPendingLocation(e.target.value)} disabled={!pendingSite}>
            <option value="">All locations</option>
            {locations.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={applyScope}>Apply</button>
        {scopeLabel&&<span className="badge bg-primary ms-1" style={{fontSize:12,fontWeight:400}}>{scopeLabel}</span>}
        {!selected.site_id&&<span className="ms-auto text-warning" style={{fontSize:12}}>No site selected</span>}
      </div>

      <ul className="nav nav-tabs mb-3">
        {[["calc","Cable calculator"],["bom","Bulk BOM"],["floorplan","Floor plan"],["racks","Racks"],["infra","Infrastructure"]].map(([t,l])=>(
          <li key={t} className="nav-item">
            <button className={`nav-link${tab===t?" active":""}`} onClick={()=>setTab(t)}>{l}</button>
          </li>
        ))}
        {unresolved.length>0&&<li className="nav-item ms-auto d-flex align-items-center pe-1"><Badge color="warning">{unresolved.length} unresolved</Badge></li>}
      </ul>

      {tab==="calc"&&(<>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="text-muted" style={{fontSize:13}}>
            {hops.length} cable{hops.length!==1?"s":""}
            {isHomeRun&&<span className="ms-2"><Badge color="primary">home run</Badge></span>}
          </span>
        </div>
        {hops.map((hop,i)=>{
          const res=results[i];const isOpen=expanded===hop.id;
          const bc=bomColor(res.withSlack,res.iface.media);
          const ready=hop.src.deviceId!=null&&hop.dst.deviceId!=null;
          return (
            <div key={hop.id} className="card mb-2">
              <div className="card-header d-flex align-items-center gap-2 py-2" style={{cursor:"pointer"}}
                onClick={()=>setExpanded(isOpen?null:hop.id)}>
                <span className="badge bg-secondary rounded-circle" style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</span>
                <div className="flex-grow-1 min-w-0">
                  <input value={hop.label} onChange={e=>updHop(hop.id,"label",e.target.value)}
                    onClick={e=>e.stopPropagation()}
                    className="form-control-plaintext fw-bold p-0 border-0" style={{fontSize:13,height:"auto"}}/>
                  <div className="d-flex gap-2 align-items-center flex-wrap" style={{fontSize:11,color:"#6c757d"}}>
                    {ready?<><span>{hop.src.deviceName} to {hop.dst.deviceName}</span><Pill>{res.iface.connector}</Pill><em>{res.iface.label}</em>{res.crossAisle&&<Badge color="warning">cross-aisle</Badge>}{res.sameRack&&<Badge color="secondary">same rack</Badge>}{res.media.fixedLength&&<Badge color="danger">fixed length</Badge>}</>:<span className="text-warning">Select both devices</span>}
                  </div>
                </div>
                {ready&&<><Badge color={bc}>{res.rec} {res.unit}</Badge><span className="text-muted ms-1" style={{fontSize:11,minWidth:60,textAlign:"right"}}>{res.calcDisplay} {res.unit}</span></>}
                {hops.length>1&&<button type="button" className="btn btn-sm btn-outline-danger ms-1 py-0 px-1" style={{fontSize:11}} onClick={e=>{e.stopPropagation();delHop(hop.id);}}>x</button>}
              </div>
              {isOpen&&(
                <div className="card-body pt-2">
                  <div className="mb-3 p-2 border rounded">
                    <div className="text-uppercase text-muted fw-bold mb-2" style={{fontSize:10,letterSpacing:"0.05em"}}>Interface type</div>
                    <select className="form-select form-select-sm mb-2" value={hop.ifaceType} onChange={e=>updHop(hop.id,"ifaceType",e.target.value)}>
                      {Object.entries(IFACE_GROUPS).map(([grp,keys])=>(
                        <optgroup key={grp} label={grp}>{keys.map(k=><option key={k} value={k}>{IFACE_TYPES[k].label} - {IFACE_TYPES[k].speed}</option>)}</optgroup>
                      ))}
                    </select>
                    <div className="d-flex gap-2 align-items-center flex-wrap">
                      <Pill>{res.iface.connector}</Pill>
                      <span className="text-muted" style={{fontSize:11}}>{res.media.label}</span>
                      {res.media.fixedLength&&<Badge color="danger">fixed length - no slack</Badge>}
                    </div>
                    <div className="text-muted mt-1" style={{fontSize:11}}>Stock lengths: {res.media.stdLengths.map(l=>`${l} ${res.unit}`).join(", ")}</div>
                  </div>
                  <div className="row g-2 mb-3">
                    <div className="col-6"><DeviceSelector label="From" value={hop.src} onChange={v=>updEp(hop.id,"src",v)} devices={devices} rackMap={rackMap} accent="src"/></div>
                    <div className="col-6"><DeviceSelector label="To"   value={hop.dst} onChange={v=>updEp(hop.id,"dst",v)} devices={devices} rackMap={rackMap} accent="dst"/></div>
                  </div>
                  {ready&&(
                    <div className="p-2 border rounded">
                      {res.sameRack&&<div className="alert alert-info py-1 mb-2" style={{fontSize:11}}>Same rack — cable runs inside rack only.</div>}
                      <SegBar label={res.sameRack?"In-rack vertical":"Source vertical to tray"} inches={res.srcV} total={res.rawIn} col="#7F77DD"/>
                      {!res.sameRack&&<SegBar label="Dest vertical from tray" inches={res.dstV} total={res.rawIn} col="#1D9E75"/>}
                      {!res.sameRack&&<SegBar label="Horizontal tray run"     inches={res.horizIn} total={res.rawIn} col="#378ADD"/>}
                      <SegBar label="Port depth both ends" inches={res.portDepthTot} total={res.rawIn} col="#888780"/>
                      {res.pathResult&&res.pathResult.path&&!res.sameRack&&(
                        <div className="mt-2 pt-2 border-top" style={{fontSize:11,color:"#6c757d"}}>
                          <strong>Tray path ({pathType(res.iface.media)}):</strong>{" "}
                          {res.pathResult.path.map((seg,i)=>(
                            <span key={i}>{seg.type==="horiz"?`${(seg.dist/12).toFixed(1)} ft`:<span className="badge bg-warning text-dark mx-1">{seg.label} ({(seg.dist/12).toFixed(1)} ft)</span>}{i<res.pathResult.path.length-1?" → ":""}</span>
                          ))}
                        </div>
                      )}
                      {res.pathResult?.error&&<div className="alert alert-warning py-1 mt-2 mb-0" style={{fontSize:11}}>Path: {res.pathResult.error}</div>}
                      <div className="d-flex justify-content-between mt-2 pt-2 border-top" style={{fontSize:12}}>
                        <span className="text-muted">Raw {res.rawFt.toFixed(2)} ft {res.media.fixedLength?"(no slack)":`+ ${(infra.slack*res.media.slackMult).toFixed(0)}% slack`}</span>
                        <span className="fw-bold">{res.calcDisplay} {res.unit} <Badge color={bc}>{res.rec} {res.unit} stock</Badge></span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button className="btn btn-outline-primary btn-sm w-100 mb-3" onClick={addHop}>+ Add cable segment</button>
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center py-2">
            <span className="fw-bold" style={{fontSize:13}}>Bill of materials</span>
            {isHomeRun&&<Badge color="primary">home run</Badge>}
          </div>
          <div className="card-body p-2">
            {Object.keys(bomGroups).length>1&&(
              <div className="d-flex gap-2 flex-wrap mb-3">
                {Object.values(bomGroups).map((g,idx)=>(
                  <div key={idx} className="border rounded p-2" style={{fontSize:12}}>
                    <div className="fw-bold mb-1">{g.media.label} — {g.connector}</div>
                    <div className="text-muted">{g.cables.length} cable{g.cables.length>1?"s":""} - {g.cables.join(", ")}</div>
                  </div>
                ))}
              </div>
            )}
            <table className="table table-sm table-bordered mb-2" style={{fontSize:12}}>
              <thead className="table-light"><tr><th>#</th><th>Cable</th><th className="text-end">Calc</th><th className="text-end">Stock</th><th className="text-end">Qty</th></tr></thead>
              <tbody>
                {hops.map((hop,i)=>{
                  const res=results[i];const bc=bomColor(res.withSlack,res.iface.media);
                  const ready=hop.src.deviceId!=null&&hop.dst.deviceId!=null;
                  return (
                    <tr key={hop.id}>
                      <td className="text-muted">{i+1}</td>
                      <td>
                        <div className="fw-bold d-flex gap-1 align-items-center flex-wrap">{hop.label}{isHomeRun&&<Badge color="primary">home run</Badge>}</div>
                        <div className="d-flex gap-1 align-items-center flex-wrap text-muted" style={{fontSize:11}}>
                          {ready?<><Pill>{res.iface.connector}</Pill><span>{res.iface.label} - {res.media.label}</span>{res.crossAisle&&<Badge color="warning">cross-aisle</Badge>}{res.sameRack&&<Badge color="secondary">same rack</Badge>}</>:<span className="text-warning">incomplete</span>}
                        </div>
                      </td>
                      <td className="text-end text-muted">{ready?`${res.calcDisplay} ${res.unit}`:"-"}</td>
                      <td className="text-end">{ready?<Badge color={bc}>{res.rec} {res.unit}</Badge>:"-"}</td>
                      <td className="text-end fw-bold">1</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="table-light"><tr><td colSpan={2} className="fw-bold">Total</td><td className="text-end text-muted">{totalSlack.toFixed(1)} ft raw</td><td/><td className="text-end fw-bold">{hops.length}</td></tr></tfoot>
            </table>
            <button className="btn btn-outline-secondary btn-sm" onClick={()=>exportManualCSV(hops,results)}>Download BOM as CSV</button>
          </div>
        </div>
      </>)}

      {tab==="bom"&&<BulkBomTab selected={selected} scopeLabel={scopeLabel} cfg={cfg}/>}

      {tab==="floorplan"&&(
        <div>
          <div className="d-flex justify-content-end mb-2">
            {saveStatus==="saving"&&<span className="badge bg-secondary">Saving...</span>}
            {saveStatus==="saved" &&<span className="badge bg-success">Layout saved</span>}
            {saveStatus==="error" &&<span className="badge bg-danger">Save failed</span>}
          </div>
          <FloorPlan racks={racks||[]} layout={layout||{rows:[],rackPositions:{}}}
            setLayout={setLayoutAndSave} bridges={bridges||[]} setBridges={setBridgesAndSave}/>
        </div>
      )}

      {tab==="racks"&&(<>
        <div className="alert alert-info py-2" style={{fontSize:12}}>Row and position resolved server-side from rack names in views.py.</div>
        {unresolved.length>0&&<div className="alert alert-warning py-2" style={{fontSize:12}}>{unresolved.length} racks unresolved.</div>}
        <div className="card mb-3">
          <div className="card-header py-2 fw-bold" style={{fontSize:13}}>All racks</div>
          <div className="card-body p-0">
            <table className="table table-sm table-bordered mb-0" style={{fontSize:12}}>
              <thead className="table-light"><tr><th/><th>Name</th><th>Site</th><th>Location</th><th>Row</th><th>Pos</th><th>Width</th><th>Height</th><th>Offset</th></tr></thead>
              <tbody>
                {racks.map(r=>(
                  <tr key={r.id}>
                    <td><span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:r.resolved?"#198754":"#dc3545"}}/></td>
                    <td><code>{r.name}</code></td><td className="text-muted">{r.site_name}</td><td className="text-muted">{r.location_name||"-"}</td>
                    <td>{r.row??<span className="text-danger">-</span>}</td><td>{r.pos??<span className="text-danger">-</span>}</td>
                    <td>{r.width_in?.toFixed(1)}"</td><td>{r.u_height}U</td><td className="text-muted">{r.center_offset?.toFixed(1)}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header py-2 fw-bold" style={{fontSize:13}}>Row layout preview</div>
          <div className="card-body">
            {Object.entries(byRow).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([row,rks])=>(
              <div key={row} className="mb-3">
                <div className="text-muted fw-bold mb-2" style={{fontSize:12}}>Row {row} — {rks.length} rack{rks.length!==1?"s":""}</div>
                <div className="d-flex gap-1 flex-wrap">
                  {[...rks].sort((a,b)=>(a.pos??0)-(b.pos??0)).map(r=>{
                    const w=Math.max(44,Math.min(88,(r.width_in??24)*1.1));
                    return (
                      <div key={r.id} style={{width:w,padding:"4px",borderRadius:4,textAlign:"center",border:`1px solid ${r.resolved?"#dee2e6":"#dc3545"}`,background:r.resolved?"#f8f9fa":"#fff5f5",fontSize:10}}>
                        <div className="fw-bold" style={{fontFamily:"monospace",color:r.resolved?"#212529":"#dc3545"}}>{r.name}</div>
                        <div className="text-muted">{r.resolved?`p${r.pos}`:"!"}</div>
                        <div className="text-muted">{r.width_in?.toFixed(0)}"</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}

      {tab==="infra"&&(
        <div className="card">
          <div className="card-header py-2 fw-bold" style={{fontSize:13}}>Infrastructure defaults</div>
          <div className="card-body">
            <div className="alert alert-secondary py-2 mb-3" style={{fontSize:12}}>Loaded from PLUGINS_CONFIG. Changes apply to this session only.</div>
            {[
              ["fiberOverhead",      "Fiber tray height",       "Rack top to fiber tray (OM3/OM4/OS2/AOC)","in"],
              ["fiberBridgeLength",  "Fiber bridge length",     "Per cross-aisle fiber bridge",            "in"],
              ["copperOverhead",     "Ladder rack height",      "Rack top to ladder rack (Cat6/DAC)",      "in"],
              ["copperBridgeLength", "Copper bridge length",    "Per cross-aisle copper bridge",           "in"],
              ["rowSpacing",         "Aisle width",             "Between rows",                            "in"],
              ["rackDepth",          "Rack depth",              "Rear-exit cable path",                    "in"],
              ["portDepth",          "Port depth",              "Front-exit path",                         "in"],
              ["slack",              "Slack / service loop",    "",                                        "%"],
            ].map(([k,label,hint,unit])=>(
              <div key={k} className="row align-items-center mb-2">
                <div className="col-5"><label className="form-label mb-0" style={{fontSize:13}}>{label}{hint&&<><br/><small className="text-muted">{hint}</small></>}</label></div>
                <div className="col-4 d-flex align-items-center gap-1">
                  <input type="number" className="form-control form-control-sm" style={{width:80,textAlign:"right"}}
                    value={infra[k]} onChange={e=>si(k,parseFloat(e.target.value)||0)}/>
                  <span className="text-muted" style={{fontSize:12}}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
