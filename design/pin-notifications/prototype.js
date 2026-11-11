const rows = [...document.querySelectorAll('.pin-row')];
const popover = document.querySelector('.popover');
const trigger = document.querySelector('[data-trigger]');
const content = document.querySelector('.menu-content');
const workspaceMenu = document.querySelector('.workspace-menu');
const footer = document.querySelector('.menu-actions, .menu-footer');
const error = document.querySelector('.error');
const failure = document.querySelector('[data-failure]');
const feedback = document.querySelector('[data-feedback]');
const touch = document.body.classList.contains('touch');
let retry;

function render() {
  const count = rows.filter(row => row.classList.contains('unread')).length;
  document.querySelectorAll('[data-count]').forEach(label => label.textContent = count ? `Pins (${count})` : 'Pins');
  footer.hidden = !footer.classList.contains('menu-actions') && count === 0;
  document.querySelector('[data-all]').disabled = count === 0;
  for (const row of rows) {
    const unread = row.classList.contains('unread');
    row.querySelector('.ack').hidden = !unread;
    row.querySelector('.pin-link').setAttribute('aria-label', `${row.querySelector('.pin-title').textContent}${unread ? ', unread' : ''}. Opens in your browser.`);
  }
  trigger.setAttribute('aria-expanded', String(!popover.hidden));
}

function acknowledge(targets, opened = false) {
  if (failure.checked) {
    failure.checked = false;
    error.hidden = false;
    error.querySelector('span').textContent = opened ? 'Link opened, but couldn’t mark as read.' : 'Couldn’t mark as read.';
    const snapshot = targets.map(row => ({ row, revision: row.dataset.revision }));
    retry = () => acknowledge(snapshot.filter(item => item.row.dataset.revision === item.revision).map(item => item.row), opened);
    feedback.textContent = 'Simulated save failure. The unread state is preserved.';
    return;
  }
  for (const row of targets) row.classList.remove('unread');
  error.hidden = true;
  retry = undefined;
  render();
  feedback.textContent = opened ? 'Link opening simulated; its update is now read.' : 'Acknowledged. The count updates; the menu stays open.';
  if (opened) {
    popover.hidden = true;
    trigger.focus();
    render();
  }
}

trigger.addEventListener('click', () => {
  popover.hidden = !popover.hidden;
  if (touch && !popover.hidden) { content.hidden = true; workspaceMenu.hidden = false; }
  render();
});
document.querySelector('[data-forward]').addEventListener('click', () => { workspaceMenu.hidden = true; content.hidden = false; });
document.querySelector('[data-back]').addEventListener('click', () => { content.hidden = true; workspaceMenu.hidden = false; });
for (const row of rows) {
  row.dataset.revision = '0';
  row.querySelector('[data-ack]').addEventListener('click', () => {
    const link = row.querySelector('.pin-link');
    acknowledge([row]);
    if (!row.classList.contains('unread')) link.focus();
  });
  row.querySelector('[data-open]').addEventListener('click', event => {
    event.preventDefault();
    acknowledge(row.classList.contains('unread') ? [row] : [], true);
  });
}
document.querySelector('[data-all]').addEventListener('click', () => {
  acknowledge(rows.filter(row => row.classList.contains('unread')));
  if (footer.hidden) rows[0].querySelector('.pin-link').focus();
});
document.querySelector('[data-retry]').addEventListener('click', () => retry?.());
document.querySelector('[data-update]').addEventListener('click', () => {
  const row = rows[0];
  row.dataset.revision = String(Number(row.dataset.revision) + 1);
  row.classList.add('unread');
  render();
  feedback.textContent = 'A meaningful update arrived for Development preview.';
});
document.querySelector('[data-reset]').addEventListener('click', () => {
  for (const row of rows) {
    row.classList.toggle('unread', row.dataset.initialUnread === 'true');
    row.dataset.revision = '0';
  }
  popover.hidden = false;
  content.hidden = false;
  workspaceMenu.hidden = true;
  error.hidden = true;
  failure.checked = false;
  retry = undefined;
  feedback.textContent = 'Sample links only. No live pins are changed.';
  render();
});
render();
