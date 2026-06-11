// ════════════════════════ CHECKLIST ══════════════════
function renderChecklist(){
  if(!_ckDate)_ckDate=todayStr();
  var el=document.getElementById('ckDate');if(el)el.textContent=_ckDate;
  var key=_ckDate+'_'+currentUser;
  if(!DB.checklist[key])DB.checklist[key]={items:[],note:''};
  var saved=DB.checklist[key];
  var doneIds=(saved.items||[]).filter(function(i){return i.done;}).map(function(i){return i.id;});
  var sc=document.getElementById('ckSc');if(sc)sc.textContent=doneIds.length;
  var ckList=document.getElementById('ckList');if(!ckList)return;
  ckList.innerHTML=getCKItems().map(function(item){
    var done=doneIds.indexOf(item.id)!==-1;
    return'<div class="ck-item'+(done?' done':'')+(item.mgr?' mgr':'')+'" onclick="toggleCk('+item.id+')">'
      +'<input type="checkbox" class="ck-cb"'+(done?' checked':'')+'> <span>'+item.t+'</span></div>';
  }).join('')
  +'<textarea class="ck-note" placeholder="یادداشت روز..." onchange="saveCkNote(this.value)">'+esc(saved.note||'')+'</textarea>';
}
function toggleCk(id){
  var key=_ckDate+'_'+currentUser;if(!DB.checklist[key])DB.checklist[key]={items:[],note:''};
  var items=DB.checklist[key].items||[];var idx=items.findIndex(function(i){return i.id===id;});
  if(idx===-1)items.push({id:id,done:true});else items[idx].done=!items[idx].done;
  DB.checklist[key].items=items;saveDB();renderChecklist();
}
function saveCkNote(v){var key=_ckDate+'_'+currentUser;if(!DB.checklist[key])DB.checklist[key]={items:[],note:''};DB.checklist[key].note=v;saveDB();}
function ckNav(delta){var p=_ckDate.split('/').map(Number);var d=jAdd(p[0],p[1],p[2],delta);_ckDate=d[0]+'/'+p2(d[1])+'/'+p2(d[2]);renderChecklist();}
function ckToday(){_ckDate=todayStr();renderChecklist();}

