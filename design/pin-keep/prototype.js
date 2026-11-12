
function announce(message){document.querySelector('.feedback').textContent=message}
function syncCount(){document.querySelectorAll('.pin-count').forEach(e=>e.textContent=document.querySelectorAll('.row.unread').length?`Pins (${document.querySelectorAll('.row.unread').length})`:'Pins')}
document.querySelectorAll('.keep').forEach(b=>b.addEventListener('click',()=>{const row=b.closest('.row');const kept=row.classList.toggle('kept');b.setAttribute('aria-pressed',String(kept));b.title=kept?'Allow removal':'Keep this pin';b.setAttribute('aria-label',(kept?'Allow removal of ':'Keep ')+row.dataset.name);announce(kept?`${row.dataset.name} is kept. Agents may update it, but cannot remove it.`:`${row.dataset.name} can be removed by agents again.`)}));
document.querySelectorAll('.read').forEach(b=>b.addEventListener('click',()=>{b.closest('.row').classList.remove('unread');syncCount();announce('Marked as read. Keep is unchanged.')}));
document.querySelectorAll('.resource,.message-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();a.closest('.row').classList.remove('unread');syncCount();announce('Link opening simulated. Keep is unchanged.')}));
document.querySelector('.mark-all').addEventListener('click',()=>{document.querySelectorAll('.unread').forEach(r=>r.classList.remove('unread'));syncCount();announce('All updates marked as read. Keep is unchanged.')});
document.querySelector('.refresh').addEventListener('click',()=>announce('Refresh would preserve kept pins. No agent runs in this design.'));
