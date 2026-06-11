// ════════════════════════ DATA HELPERS ════════════════
// تهران + ۳۰ استان دیگر — cached
var _ALL_PROVS=null;
function getAllProvinces(){
  if(!_ALL_PROVS)_ALL_PROVS=[{id:'tehran',row:0,name:'تهران',potential:1,biopsyPct:19.8,owner:null}].concat(PROVINCES);
  return _ALL_PROVS;
}
function getProvType(provId){return provId==='tehran'?'center':'pc';}
// Cache: PC_RAW یک بار normalize می‌شود — null = نیاز به rebuild دارد
var _PC_CACHE=null;
function _buildPCCache(){
  if(_PC_CACHE!==null&&Object.keys(_PC_CACHE).length>0)return;
  _PC_CACHE={};
  PROVINCES.forEach(function(p){
    var pname=p.name.replace(/[ي]/g,'ی').replace(/[ك]/g,'ک');
    var raw=PC_RAW[pname]||PC_RAW[p.id]||[];
    _PC_CACHE[p.id]=raw.map(function(r){
      if(Array.isArray(r)){
        return{id:p.id+'||'+r[0],row:r[0],name:(r[1]||'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک'),potential:r[2],type:r[3]||'',lead:r[4]||'سرنخ',province_id:p.id,owner:p.owner};
      } else {
        var rid=r.row||r[0]||0;
        return{id:r.id||(p.id+'||'+rid),row:rid,name:(r.name||r[1]||'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک'),potential:r.potential||r[2]||1,type:r.type||r[3]||'',lead:r.lead||r[4]||'سرنخ',province_id:p.id,owner:p.owner};
      }
    });
  });
  _PC_CACHE['tehran']=CENTERS; 

  // ── Populate CNC cache ──────────────────────────────
  _loadCNC();var _chg=false;
  Object.keys(_PC_CACHE).forEach(function(pv){
    (_PC_CACHE[pv]||[]).forEach(function(ct){
      if(!ct||!ct.id||!ct.name)return;
      var rk=(pv==='tehran'?'center_':'pc_')+ct.id;
      if(!_CNC[rk]){_CNC[rk]=ct.name;_chg=true;}
    });
  });
  if(_chg)try{localStorage.setItem('_cnc',JSON.stringify(_CNC));}catch(e){}
}function getProvCenters(provId){
  _buildPCCache();
  var useHardcoded=!(DB.hiddenProvs&&DB.hiddenProvs[provId]);
  var base=useHardcoded?(_PC_CACHE[provId]||[]):[];
  var extras=(DB.extra||[]).filter(function(c){return c.province_id===provId;});
  if(!extras.length)return base; // no copy needed
  return base.concat(extras);
}
function clearPCCache(){_PC_CACHE=null;}
function isStalled(type,id){
  var e=getE(type,id);var st=e.status||'بدون تماس';
  if(st==='قرارداد بسته شد'||st==='غیرفعال')return false;
  var last=e._lastActivity||e._ts||0;if(!last)return false;
  return(nowTs()-last)>(30*24*3600*1000);
}
function isOverdue(type,id){
  var e=getE(type,id);var fd=e.followupDate||'';
  var st=e.status||'بدون تماس';if(st==='قرارداد بسته شد'||st==='غیرفعال')return false;
  return fd&&fd<todayStr();
}

