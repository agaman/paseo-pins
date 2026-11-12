const rows = [...document.querySelectorAll('.pin-row')];
const all = document.querySelector('[data-mark-all]');
const expand = document.querySelector('[data-expand]');
const error = document.querySelector('.summary-error');
const feedback = document.querySelector('[data-feedback]');
const mode = document.body.dataset.state;
let expanded, unread, newer, failed;
function render() {
  rows.forEach((row, index) => {
    row.hidden = !expanded && index >= 3;
    row.classList.toggle('unread', unread.has(row.dataset.key));
    row.setAttribute('aria-label', `${row.querySelector('.resource-title').textContent}. ${unread.has(row.dataset.key) ? 'Unread update. ' : ''}Opens captured link in your browser.`);
  });
  all.disabled = unread.size === 0;
  expand.firstChild.textContent = expanded ? 'Show less ' : `Show all ${rows.length} `;
  expand.setAttribute('aria-expanded', String(expanded));
  error.hidden = !failed;
  document.querySelector('[data-menu-count]').textContent = unread.size + newer ? `Pins (${unread.size + newer})` : 'Pins';
}
function acknowledge(keys) {
  keys.forEach(key => unread.delete(key));
  failed = false;
  render();
}
function reset() {
  expanded = mode === 'expanded';
  unread = new Set(mode === 'history' || mode === 'no-changes' ? [] : ['preview','review','notes','tests']);
  newer = mode === 'history' ? 1 : 0;
  failed = mode === 'error';
  feedback.textContent = mode === 'history' ? 'This preview has a newer update. Its old link stays unchanged.' : mode === 'no-changes' ? 'No qualifying changes: no pins block.' : 'Sample data only; your pins are unchanged.';
  render();
}
rows.forEach(row => row.addEventListener('click', event => {
  event.preventDefault();
  acknowledge([row.dataset.key]);
  feedback.textContent = `Opened captured link: ${row.getAttribute('href')}`;
}));
all.addEventListener('click', () => {
  acknowledge([...unread]);
  feedback.textContent = 'Marked this summary’s captured updates as read, including hidden entries.';
});
document.querySelector('[data-retry]').addEventListener('click', () => {
  acknowledge([...unread]);
  feedback.textContent = 'Retry succeeded. This summary’s captured updates are read.';
});
expand.addEventListener('click', () => { expanded = !expanded; render(); });
document.querySelector('[data-newer]').addEventListener('click', () => {
  if (mode === 'no-changes') return;
  unread.delete('preview'); newer = 1; render();
  feedback.textContent = 'The preview now has a newer update in Pins. This block still opens build-42; acknowledging it cannot clear the newer update.';
});
document.querySelector('[data-reset]').addEventListener('click', reset);
reset();
