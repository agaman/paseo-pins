const paths = {
  pin: '<path d="M16 3H8l1 6-4 5v2h6v5m2-5h6v-2l-4-5 1-6Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  book: '<path d="M12 5c-3-3-7-3-9-2v15c3-1 6-1 9 2 3-3 6-3 9-2V3c-3-1-6-1-9 2v15Z"/>',
  review:
    '<circle cx="6" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v13m7-17h3a2 2 0 0 1 2 2v10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  refresh: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6"/>',
  checks: '<path d="m3 6 2 2 4-4m-6 9 2 2 4-4m4-5h8m-8 7h8m-8 7h8"/>',
  settings:
    '<path d="m10 3 4 0 1 3 3 1 3 3-2 3 0 3-3 3-3-1-3 1-3-3 0-3-2-3 3-3 3-1Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const initial = [
  {
    id: "preview",
    title: "Development preview",
    host: "preview.example.com",
    type: "globe",
    section: "In progress",
    unread: true,
    note: "The new onboarding flow is ready to review.",
    kept: false,
  },
  {
    id: "review",
    title: "Onboarding pull request",
    host: "github.com",
    type: "review",
    section: "In progress",
    kept: true,
  },
  {
    id: "report",
    title: "Accessibility report",
    host: "reports.example.com",
    type: "book",
    section: "Reference",
    unread: true,
    note: "Keyboard and screen-reader checks are ready.",
    kept: false,
  },
  {
    id: "handbook",
    title: "Project handbook",
    host: "docs.example.com",
    type: "book",
    section: "Reference",
    repo: true,
  },
];
let pins = structuredClone(initial),
  removed = null,
  selected = null,
  repoOpen = false;
const panel = document.querySelector(".panel"),
  list = document.querySelector("#pin-list"),
  popup = document.querySelector("#action-menu"),
  repo = document.querySelector("#repo-info");
function closeActions() {
  selected = null;
  repoOpen = false;
  popup.hidden = true;
  repo.hidden = true;
  document.querySelectorAll(".more,.repo").forEach((el) => {
    el.setAttribute("aria-expanded", "false");
  });
}
const directActions = document.body.dataset.controls === "direct";
function rowActions(p) {
  if (p.repo) return "";
  if (!directActions)
    return `<button class="icon-button more" data-dc-id="more-${p.id}" aria-label="Actions for ${p.title}" aria-expanded="false">${icon("more")}</button>`;
  return `<div class="direct-actions" data-dc-id="actions-${p.id}"><button class="icon-button keep-direct" data-dc-id="keep-${p.id}" aria-label="${p.kept ? "Allow agent removal of" : "Keep"} ${p.title}" aria-pressed="${!!p.kept}" title="${p.kept ? "Allow agent removal" : "Keep pin"}">${icon("pin")}</button><button class="icon-button remove-direct" data-dc-id="remove-${p.id}" aria-label="Remove ${p.title}" title="Remove pin">${icon("trash")}</button></div>`;
}
function row(p) {
  return `<div class="pin ${p.unread ? "unread" : ""}" data-dc-id="pin-${p.id}" data-pin="${p.id}"><div class="pin-head"><div class="resource">${icon(p.type)}${p.unread ? '<i class="dot"></i>' : ""}</div><div class="copy"><div class="pin-title">${p.title}</div><div class="host">${p.host}${p.kept && !directActions ? `<span class="kept" data-dc-id="kept-indicator"> · ${icon("pin")} Kept</span>` : ""}${p.repo ? ` · <button class="repo" data-dc-id="repository-info" aria-label="Repository source for ${p.title}" aria-expanded="false">${icon("settings")} Repo</button>` : ""}</div></div>${rowActions(p)}</div>${p.unread ? `<div class="note" data-dc-id="update-${p.id}"><p>${p.note}</p><button class="icon-button ack" aria-label="Mark ${p.title} as read">${icon("check")}</button></div>` : ""}</div>`;
}
function render() {
  list.innerHTML = ["In progress", "Reference"]
    .map((section) => {
      const items = pins.filter((p) => p.section === section);
      return items.length
        ? `<section class="section"><div class="section-title">${section}</div>${items.map(row).join("")}</section>`
        : "";
    })
    .join("");
  document.querySelector("#pins-label").textContent =
    `Pins${pins.some((p) => p.unread) ? ` (${pins.filter((p) => p.unread).length})` : ""}`;
  const undo = document.querySelector("#undo");
  undo.hidden = !removed;
  if (removed) document.querySelector("#removed-title").textContent = removed.pin.title;
  list.querySelectorAll(".keep-direct").forEach((button) => {
    button.onclick = () => {
      const id = button.closest("[data-pin]").dataset.pin;
      const pin = pins.find((p) => p.id === id);
      pin.kept = !pin.kept;
      closeActions();
      render();
      list.querySelector(`[data-pin="${id}"] .keep-direct`).focus();
    };
  });
  list.querySelectorAll(".remove-direct").forEach((button) => {
    button.onclick = () => {
      selected = button.closest("[data-pin]").dataset.pin;
      removeSelected();
    };
  });
  list.querySelectorAll(".more").forEach((button) => {
    button.onclick = () => {
      const id = button.closest("[data-pin]").dataset.pin;
      if (selected === id) return closeActions();
      closeActions();
      selected = id;
      button.setAttribute("aria-expanded", "true");
      popup.hidden = false;
      const pin = pins.find((p) => p.id === id);
      document.querySelector("#keep-label").textContent = pin.kept
        ? "Allow agent removal"
        : "Keep pin";
      position(popup, button);
    };
  });
  list.querySelectorAll(".repo").forEach((button) => {
    button.onclick = () => {
      if (repoOpen) return closeActions();
      closeActions();
      repoOpen = true;
      repo.hidden = false;
      button.setAttribute("aria-expanded", "true");
      position(repo, button);
    };
  });
  list.querySelectorAll(".ack").forEach((button) => {
    button.onclick = () => {
      closeActions();
      pins.find((p) => p.id === button.closest("[data-pin]").dataset.pin).unread = false;
      render();
    };
  });
}
function position(el, trigger) {
  const r = trigger.getBoundingClientRect(),
    p = panel.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(p.width - el.offsetWidth - 8, r.right - p.left - el.offsetWidth))}px`;
  let top = r.bottom - p.top + 4;
  if (top + el.offsetHeight > p.height - 8) top = r.top - p.top - el.offsetHeight - 4;
  el.style.top = `${Math.max(8, top)}px`;
}
function removeSelected() {
  const index = pins.findIndex((p) => p.id === selected);
  if (index < 0) return;
  removed = { pin: structuredClone(pins[index]), index };
  pins.splice(index, 1);
  closeActions();
  render();
  document.querySelector("#undo-button").focus();
}
document.querySelector("#keep-button").onclick = () => {
  const p = pins.find((p) => p.id === selected);
  p.kept = !p.kept;
  closeActions();
  render();
};
document.querySelector("#remove-button").onclick = removeSelected;
document.querySelector("#undo-button").onclick = () => {
  const id = removed.pin.id;
  pins.splice(removed.index, 0, removed.pin);
  removed = null;
  render();
  document.querySelector(`[data-pin="${id}"] ${directActions ? ".keep-direct" : ".more"}`).focus();
};
document.querySelector("#pill").onclick = () => {
  closeActions();
  panel.hidden = !panel.hidden;
  if (panel.hidden) {
    removed = null;
    render();
  }
  document.querySelector(".scrim").hidden = panel.hidden;
  document.querySelector("#pill").setAttribute("aria-expanded", String(!panel.hidden));
};
document.querySelector(".scrim").onclick = () => {
  closeActions();
  panel.hidden = true;
  removed = null;
  render();
  document.querySelector(".scrim").hidden = true;
  document.querySelector("#pill").setAttribute("aria-expanded", "false");
};
document.addEventListener("click", (e) => {
  if (!e.target.closest(".action-menu,.repo-info,.more,.repo")) closeActions();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeActions();
});
document.querySelector("#reset").onclick = () => location.reload();
document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = icon(el.dataset.icon);
});
render();
if (document.body.dataset.state === "removed") {
  selected = "preview";
  removeSelected();
  document.activeElement.blur();
} else if (document.body.dataset.state === "repo") {
  document.querySelector(".repo").click();
} else if (!directActions) {
  document.querySelector('[data-pin="preview"] .more').click();
}
