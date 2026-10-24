/* Shared in-site confirmation for relationship and account revocation actions. */
let dialog = null;
let active = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "site-confirm-dialog";
  dialog.className = "modal site-confirm-modal";
  dialog.setAttribute("aria-labelledby", "site-confirm-title");
  dialog.setAttribute("aria-describedby", "site-confirm-description");
  dialog.innerHTML = '<div class="modal-inner">' +
    '<div class="modal-head"><div><p class="eyebrow" id="site-confirm-eyebrow">請確認操作</p>' +
    '<h2 id="site-confirm-title"></h2></div>' +
    '<button type="button" class="close-modal" id="site-confirm-close" aria-label="關閉確認視窗">×</button></div>' +
    '<p class="modal-description" id="site-confirm-description"></p>' +
    '<div class="site-confirm-details" id="site-confirm-details"></div>' +
    '<p class="site-confirm-error" id="site-confirm-error" role="alert" hidden></p>' +
    '<div class="form-actions"><button type="button" class="secondary-button" id="site-confirm-cancel"></button>' +
    '<button type="button" class="primary-button" id="site-confirm-submit"></button></div></div>';
  document.body.appendChild(dialog);
  dialog.querySelector("#site-confirm-close").addEventListener("click", () => settle(false));
  dialog.querySelector("#site-confirm-cancel").addEventListener("click", () => settle(false));
  dialog.querySelector("#site-confirm-submit").addEventListener("click", async () => {
    if (!active || active.busy) return;
    active.busy = true;
    const submit = dialog.querySelector("#site-confirm-submit");
    const cancel = dialog.querySelector("#site-confirm-cancel");
    const close = dialog.querySelector("#site-confirm-close");
    const error = dialog.querySelector("#site-confirm-error");
    submit.disabled = true;
    cancel.disabled = true;
    close.disabled = true;
    submit.textContent = active.busyLabel;
    error.hidden = true;
    try {
      await active.action();
      settle(true);
    } catch (err) {
      error.textContent = String(err?.message || "操作未完成，原有連結仍保留。請稍後再試。");
      error.hidden = false;
      active.busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      close.disabled = false;
      submit.textContent = active.confirmLabel;
    }
  });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    settle(false);
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog && !active?.busy) settle(false);
  });
  dialog.addEventListener("close", () => {
    if (active) settle(false);
  });
  return dialog;
}

function settle(result) {
  if (!active) return;
  const current = active;
  active = null;
  if (dialog?.open) dialog.close();
  if (current.previousFocus?.focus) current.previousFocus.focus();
  current.resolve(result);
}

export function runSiteConfirmation({title, description, details=[], confirmLabel="確認操作", cancelLabel="保留不變", busyLabel="處理中…", action}) {
  if (typeof document === "undefined" || !document.body || typeof action !== "function") return Promise.resolve(false);
  if (active) settle(false);
  const node = ensureDialog();
  node.querySelector("#site-confirm-title").textContent = title || "請確認操作";
  node.querySelector("#site-confirm-description").textContent = description || "請確認是否要繼續。";
  node.querySelector("#site-confirm-details").replaceChildren(...details.map(text => {
    const row = document.createElement("p");
    row.textContent = text;
    return row;
  }));
  node.querySelector("#site-confirm-error").hidden = true;
  node.querySelector("#site-confirm-cancel").textContent = cancelLabel;
  node.querySelector("#site-confirm-submit").textContent = confirmLabel;
  node.querySelector("#site-confirm-submit").disabled = false;
  node.querySelector("#site-confirm-cancel").disabled = false;
  node.querySelector("#site-confirm-close").disabled = false;
  return new Promise(resolve => {
    active = {resolve, action, busy:false, busyLabel, confirmLabel, previousFocus:document.activeElement};
    node.showModal();
    node.querySelector("#site-confirm-cancel").focus();
  });
}

if (typeof window !== "undefined") window.__tutorSiteConfirm = runSiteConfirmation;
