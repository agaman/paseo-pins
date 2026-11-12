
const say=text=>document.querySelector('.feedback').textContent=text;
function sync(){const n=document.querySelectorAll('.unread').length;document.querySelectorAll('.count').forEach(e=>e.textContent=n?`Pins (${n})`:'Pins');}
const menu=document.querySelector('.menu');
const configButtons=[...document.querySelectorAll('.config')];
let current=null,pinned=false;
function panel(button){return document.getElementById(button.getAttribute('aria-controls'));}
function closeDetails(){
 if(!current)return;
 current.setAttribute('aria-expanded','false');
 panel(current).dataset.open='false';
 current.closest('.row').classList.remove('inspect');
 current=null;pinned=false;
}
function positionDetails(){
 if(!current)return;
 const detail=panel(current),bounds=menu.getBoundingClientRect(),anchor=current.getBoundingClientRect();
 detail.style.maxHeight=(menu.clientHeight-12)+'px';
 const width=detail.offsetWidth,height=detail.offsetHeight;
 const left=Math.max(6,Math.min(anchor.right-bounds.left-width,menu.clientWidth-width-6));
 let top=anchor.bottom-bounds.top+5;
 if(top+height>menu.clientHeight-6)top=anchor.top-bounds.top-height-5;
 top=Math.max(6,Math.min(top,menu.clientHeight-height-6));
 detail.style.left=left+'px';detail.style.top=top+'px';
}
function openDetails(button,hold=false){
 if(current!==button)closeDetails();
 current=button;pinned=hold;
 button.setAttribute('aria-expanded','true');
 button.closest('.row').classList.add('inspect');
 panel(button).dataset.open='true';positionDetails();
}
const initiallyOpen=configButtons.find(b=>b.getAttribute('aria-expanded')==='true');
configButtons.forEach(button=>{
 const detail=panel(button);menu.append(detail);
 detail.setAttribute('role','note');button.setAttribute('aria-describedby',detail.id);
 button.setAttribute('aria-expanded','false');button.closest('.row').classList.remove('inspect');
 button.addEventListener('click',()=>{if(current===button&&pinned)closeDetails();else openDetails(button,true)});
 button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&current!==button)openDetails(button)});
 button.addEventListener('focus',()=>openDetails(button));
 button.addEventListener('blur',()=>{if(current===button&&!pinned)closeDetails()});
});
document.addEventListener('pointermove',e=>{
 if(!current||pinned||e.pointerType!=='mouse')return;
 const a=current.getBoundingClientRect(),b=panel(current).getBoundingClientRect();
 const inside=r=>e.clientX>=r.left-6&&e.clientX<=r.right+6&&e.clientY>=r.top-6&&e.clientY<=r.bottom+6;
 if(!inside(a)&&!inside(b))closeDetails();
});
document.addEventListener('pointerdown',e=>{if(current&&!current.contains(e.target)&&!panel(current).contains(e.target))closeDetails()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetails()});
window.addEventListener('resize',positionDetails);
if(initiallyOpen)openDetails(initiallyOpen,true);
document.querySelectorAll('a.resource,.config-resource a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();a.closest('.row').classList.remove('unread');a.closest('.row').querySelector('.update')?.remove();sync();say('Link opening simulated. This design does not change real pins.')}));
document.querySelector('.read').addEventListener('click',e=>{const row=e.currentTarget.closest('.row');row.classList.remove('unread');row.querySelector('.update').remove();sync();say('Update marked as read in this preview.')});
document.querySelector('.mark-all').addEventListener('click',()=>{document.querySelectorAll('.unread').forEach(row=>{row.classList.remove('unread');row.querySelector('.update')?.remove()});sync();say('All updates marked as read in this preview.')});
document.querySelector('.keep').addEventListener('click',e=>{const row=e.currentTarget.closest('.row'),kept=row.classList.toggle('kept');e.currentTarget.setAttribute('aria-pressed',String(kept));e.currentTarget.setAttribute('aria-label',kept?'Allow removal of Keyboard navigation':'Keep Keyboard navigation');say(kept?'Agent-managed pin kept.':'Agent-managed pin can be removed again.')});
document.querySelector('.refresh').addEventListener('click',()=>say('Refresh would preserve configured pins. No agent runs in this design.'));
