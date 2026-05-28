const STORAGE_KEYS = {
  records: "tutor_records_v2",
  backup: "tutor_records_backup_v2",
  gasUrl: "tutor_gas_url",
  defaultRate: "tutor_default_rate",
  role: "tutor_role"
};

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzxXvGCjmVlTZ40AT-DrtKkyJCt2dvMTw9uaGsNs-tFynycUoZg2F-n4rdgEG5kqrNeng/exec";
const LEGACY_GAS_URLS = [
  "https://script.google.com/macros/s/AKfycbx_RstDko7bgH2M3mhB2iIDLDP_6ZFXuDkbHWtChcCANoSvxXUvgzopfMom8iVBupUCGg/exec",
  "https://script.google.com/macros/s/AKfycbyVKXWn3D0pITn29mIHxt-E1tSjYksSpUGrGrSSECbMbJmfOkuICaR948y-Md56lpu4uA/exec"
];

const state = {
  records: [],
  settings: { gasUrl: "", defaultRate: 500 },
  role: "teacher",
  activeView: "calendar",
  recordMode: "actual",
  calendarDate: new Date(),
  selectedDate: formatDate(new Date()),
  filters: { startDate: "", endDate: "" },
  isCloudMode: false,
  isLoading: false
};

const demoRecords = [
  buildRecord({ id: "demo_1", date: getOffsetDateString(0), student: "小明", subject: "數學", startTime: "19:00", endTime: "20:30", hourlyRate: 500, status: "未付款", focusRating: 5, attitudeRating: 4, remarks: "二元一次聯立方程式與練習題" }),
  buildRecord({ id: "demo_2", date: getOffsetDateString(-2), student: "小明", subject: "理化", startTime: "18:30", endTime: "20:00", hourlyRate: 500, status: "未付款", focusRating: 4, attitudeRating: 5, remarks: "浮力與摩擦力觀念澄清" }),
  buildRecord({ id: "demo_3", paymentGroupId: "demo_pay_1", date: getOffsetDateString(-5), student: "小安", subject: "英文", startTime: "19:00", endTime: "21:00", hourlyRate: 600, status: "家長已付款", paymentDate: getOffsetDateString(-3), parentNote: "已轉帳", focusRating: 5, attitudeRating: 5, remarks: "課文解析與單字講解" }),
  buildRecord({ id: "demo_4", date: getOffsetDateString(-12), student: "小安", subject: "數學", startTime: "19:00", endTime: "20:30", hourlyRate: 600, status: "老師已收到", paymentDate: getOffsetDateString(-9), receivedDate: getOffsetDateString(-8), focusRating: 4, attitudeRating: 4, remarks: "數列與級數小考檢討" }),
  buildRecord({ id: "demo_leave_1", type: "leave", leaveSource: "student", date: getOffsetDateString(3), remarks: "學生請假，另約補課" })
];

const DOM = {
  settingsToggle: document.getElementById("settings-toggle"),
  settingsPanel: document.getElementById("settings-panel"),
  closeSettings: document.getElementById("close-settings"),
  gasUrlInput: document.getElementById("setting-gas-url"),
  defaultRateInput: document.getElementById("setting-default-rate"),
  btnSaveSettings: document.getElementById("btn-save-settings"),
  btnTestConnection: document.getElementById("btn-test-connection"),
  modeBadge: document.getElementById("mode-badge"),
  modeCopy: document.getElementById("mode-copy"),
  roleSwitch: document.getElementById("role-switch"),
  viewSwitch: document.getElementById("view-switch"),
  recordModeSwitch: document.getElementById("record-mode-switch"),
  workspace: document.querySelector(".workspace"),
  teacherPanel: document.getElementById("teacher-panel"),
  parentPanel: document.getElementById("parent-panel"),
  recordForm: document.getElementById("record-form"),
  recordStudent: document.getElementById("record-student"),
  recordSubject: document.getElementById("record-subject"),
  recordDate: document.getElementById("record-date"),
  recordDateLabel: document.getElementById("record-date-label"),
  recordRate: document.getElementById("record-rate"),
  recordStartTime: document.getElementById("record-start-time"),
  recordEndTime: document.getElementById("record-end-time"),
  recordPlannedStartTime: document.getElementById("record-planned-start-time"),
  recordPlannedEndTime: document.getElementById("record-planned-end-time"),
  recordFocus: document.getElementById("record-focus"),
  recordAttitude: document.getElementById("record-attitude"),
  recordRemarks: document.getElementById("record-remarks"),
  schedulePanel: document.getElementById("schedule-panel"),
  calcHours: document.getElementById("calc-hours"),
  calcAmount: document.getElementById("calc-amount"),
  btnSubmitRecord: document.getElementById("btn-submit-record"),
  statUnpaidHours: document.getElementById("stat-unpaid-hours"),
  statHours: document.getElementById("stat-total-hours"),
  statPaid: document.getElementById("stat-paid-amount"),
  recordCount: document.getElementById("record-count"),
  dataTitle: document.getElementById("data-title"),
  calendarTitle: document.getElementById("calendar-title"),
  prevMonth: document.getElementById("prev-month"),
  nextMonth: document.getElementById("next-month"),
  calendarView: document.getElementById("calendar-view"),
  calendarGrid: document.getElementById("calendar-grid"),
  listView: document.getElementById("list-view"),
  recordList: document.getElementById("record-list"),
  parentPaymentForm: document.getElementById("parent-payment-form"),
  parentPaymentStart: document.getElementById("parent-payment-start"),
  parentPaymentEnd: document.getElementById("parent-payment-end"),
  parentPaymentDate: document.getElementById("parent-payment-date"),
  parentPaymentNote: document.getElementById("parent-payment-note"),
  parentPaymentSummary: document.getElementById("parent-payment-summary"),
  parentPaymentAmount: document.getElementById("parent-payment-amount"),
  parentUnpaidList: document.getElementById("parent-unpaid-list"),
  teacherReceiveList: document.getElementById("teacher-receive-list"),
  teacherLeaveForm: document.getElementById("teacher-leave-form"),
  teacherLeaveSource: document.getElementById("teacher-leave-source"),
  teacherLeaveDate: document.getElementById("teacher-leave-date"),
  teacherLeaveEndDate: document.getElementById("teacher-leave-end-date"),
  teacherLeaveNote: document.getElementById("teacher-leave-note"),
  parentLeaveForm: document.getElementById("parent-leave-form"),
  parentLeaveDate: document.getElementById("parent-leave-date"),
  parentLeaveEndDate: document.getElementById("parent-leave-end-date"),
  parentLeaveNote: document.getElementById("parent-leave-note"),
  parentScheduleForm: document.getElementById("parent-schedule-form"),
  parentScheduleStartDate: document.getElementById("parent-schedule-start-date"),
  parentScheduleUntil: document.getElementById("parent-schedule-until"),
  parentScheduleStartTime: document.getElementById("parent-schedule-start-time"),
  parentScheduleEndTime: document.getElementById("parent-schedule-end-time"),
  loadingSpinner: document.getElementById("loading-spinner"),
  emptyState: document.getElementById("empty-state"),
  dayPanel: document.getElementById("day-panel"),
  closeDayPanel: document.getElementById("close-day-panel"),
  dayPanelDate: document.getElementById("day-panel-date"),
  dayPanelDateLabel: document.getElementById("day-panel-date-label"),
  dayPanelRecords: document.getElementById("day-panel-records"),
  dayLessonStartTime: document.getElementById("day-lesson-start-time"),
  dayLessonEndTime: document.getElementById("day-lesson-end-time"),
  btnDayAddLeave: document.getElementById("btn-day-add-leave"),
  btnDayRemoveLeave: document.getElementById("btn-day-remove-leave"),
  btnDayAddLesson: document.getElementById("btn-day-add-lesson"),
  paymentModal: document.getElementById("payment-modal"),
  closePaymentModal: document.getElementById("close-payment-modal"),
  paymentForm: document.getElementById("payment-form"),
  paymentRecordId: document.getElementById("payment-record-id"),
  paymentDate: document.getElementById("payment-date"),
  paymentNote: document.getElementById("payment-note"),
  toast: document.getElementById("toast")
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  loadSettings();
  syncCurrentMonthRange();
  initFormDefaults();
  setupEvents();
  applyRole(localStorage.getItem(STORAGE_KEYS.role) || "teacher");
  loadRecords();
}

function setupEvents() {
  DOM.settingsToggle.addEventListener("click", () => DOM.settingsPanel.classList.toggle("is-hidden"));
  DOM.closeSettings.addEventListener("click", () => DOM.settingsPanel.classList.add("is-hidden"));
  DOM.btnSaveSettings.addEventListener("click", saveSettings);
  DOM.btnTestConnection.addEventListener("click", testCloudConnection);
  DOM.recordForm.addEventListener("submit", handleAddRecord);
  [DOM.recordStartTime, DOM.recordEndTime, DOM.recordRate].forEach(el => el.addEventListener("input", calculateFormSummary));
  DOM.roleSwitch.addEventListener("click", event => handleSegmentClick(event, "role"));
  DOM.viewSwitch.addEventListener("click", event => handleSegmentClick(event, "view"));
  DOM.recordModeSwitch.addEventListener("click", event => handleSegmentClick(event, "recordMode"));
  DOM.teacherLeaveDate.addEventListener("change", () => syncLeaveEndDate(DOM.teacherLeaveDate, DOM.teacherLeaveEndDate));
  DOM.parentLeaveDate.addEventListener("change", () => syncLeaveEndDate(DOM.parentLeaveDate, DOM.parentLeaveEndDate));
  DOM.parentScheduleStartDate.addEventListener("change", () => syncLeaveEndDate(DOM.parentScheduleStartDate, DOM.parentScheduleUntil));
  DOM.prevMonth.addEventListener("click", () => changeMonth(-1));
  DOM.nextMonth.addEventListener("click", () => changeMonth(1));
  DOM.closeDayPanel.addEventListener("click", closeDayPanel);
  DOM.btnDayAddLeave.addEventListener("click", handleDayAddLeave);
  DOM.btnDayRemoveLeave.addEventListener("click", handleDayRemoveLeave);
  DOM.btnDayAddLesson.addEventListener("click", handleDayAddLesson);
  DOM.closePaymentModal.addEventListener("click", closePaymentModal);
  DOM.paymentModal.addEventListener("click", event => {
    if (event.target === DOM.paymentModal) closePaymentModal();
  });
  DOM.paymentForm.addEventListener("submit", handlePaymentSubmit);
  DOM.parentPaymentForm.addEventListener("submit", handleParentRangePayment);
  [DOM.parentPaymentStart, DOM.parentPaymentEnd].forEach(el => el.addEventListener("change", renderParentPaymentPreview));
  DOM.teacherLeaveForm.addEventListener("submit", event => handleAddLeave(event, "teacher"));
  DOM.parentLeaveForm.addEventListener("submit", event => handleAddLeave(event, "parent"));
  DOM.parentScheduleForm.addEventListener("submit", handleParentScheduleSubmit);
}

function handleSegmentClick(event, type) {
  const button = event.target.closest("button");
  if (!button) return;
  button.parentElement.querySelectorAll("button").forEach(item => {
    item.classList.toggle("is-active", item === button);
    item.setAttribute("aria-selected", item === button ? "true" : "false");
  });

  if (type === "role") applyRole(button.dataset.role);
  if (type === "view") {
    state.activeView = button.dataset.view;
    render();
  }
  if (type === "recordMode") {
    state.recordMode = button.dataset.recordMode;
    updateRecordModeUI();
  }
}

function loadSettings() {
  const savedGasUrl = localStorage.getItem(STORAGE_KEYS.gasUrl);
  state.settings.gasUrl = !savedGasUrl || LEGACY_GAS_URLS.includes(savedGasUrl) ? DEFAULT_GAS_URL : savedGasUrl;
  if (state.settings.gasUrl !== savedGasUrl) {
    localStorage.setItem(STORAGE_KEYS.gasUrl, state.settings.gasUrl);
  }
  state.settings.defaultRate = parseInt(localStorage.getItem(STORAGE_KEYS.defaultRate), 10) || 500;
  state.isCloudMode = Boolean(state.settings.gasUrl);
  DOM.gasUrlInput.value = state.settings.gasUrl;
  DOM.defaultRateInput.value = state.settings.defaultRate;
  updateModeCopy();
}

function saveSettings() {
  const url = DOM.gasUrlInput.value.trim();
  const rate = parseInt(DOM.defaultRateInput.value, 10) || 500;
  localStorage.setItem(STORAGE_KEYS.gasUrl, url);
  localStorage.setItem(STORAGE_KEYS.defaultRate, String(rate));
  state.settings.gasUrl = url;
  state.settings.defaultRate = rate;
  state.isCloudMode = Boolean(url);
  DOM.recordRate.value = rate;
  calculateFormSummary();
  updateModeCopy();
  DOM.settingsPanel.classList.add("is-hidden");
  showToast("設定已儲存", "success");
  loadRecords();
}

function updateModeCopy() {
  if (state.isCloudMode) {
    DOM.modeBadge.textContent = "雲端同步";
    DOM.modeCopy.textContent = "已連結 Google Apps Script。老師與家長可用同一網址查看月曆、請假時段與區間付款狀態。";
  } else {
    DOM.modeBadge.textContent = "本機模式";
    DOM.modeCopy.textContent = "目前資料儲存在這台瀏覽器。設定 Google Apps Script URL 後即可讓老師與家長用同一網址同步操作。";
  }
}

function initFormDefaults() {
  DOM.recordDate.value = formatDate(new Date());
  DOM.recordRate.value = state.settings.defaultRate;
  DOM.recordStartTime.value = "19:00";
  DOM.recordEndTime.value = "20:30";
  DOM.recordPlannedStartTime.value = "15:00";
  DOM.recordPlannedEndTime.value = "17:00";
  DOM.recordFocus.value = "5";
  DOM.recordAttitude.value = "5";
  DOM.parentPaymentDate.value = formatDate(new Date());
  DOM.parentPaymentStart.value = state.filters.startDate;
  DOM.parentPaymentEnd.value = state.filters.endDate;
  DOM.teacherLeaveDate.value = formatDate(new Date());
  DOM.teacherLeaveEndDate.value = formatDate(new Date());
  DOM.parentLeaveDate.value = formatDate(new Date());
  DOM.parentLeaveEndDate.value = formatDate(new Date());
  DOM.parentScheduleStartDate.value = formatDate(new Date());
  DOM.parentScheduleUntil.value = formatDate(new Date());
  DOM.parentScheduleStartTime.value = "15:00";
  DOM.parentScheduleEndTime.value = "17:00";
  DOM.dayLessonStartTime.value = "15:00";
  DOM.dayLessonEndTime.value = "17:00";
  calculateFormSummary();
  updateRecordModeUI();
}

async function testCloudConnection() {
  const url = DOM.gasUrlInput.value.trim();
  if (!url) {
    showToast("請先輸入 Google Apps Script URL", "warning");
    return;
  }
  DOM.btnTestConnection.disabled = true;
  try {
    const result = await requestCloud(url, { action: "read" }, "GET");
    if (result.success) showToast("雲端連線成功", "success");
    else showToast(result.error || "連線失敗", "error");
  } catch (error) {
    showToast("連線錯誤，請確認部署權限為 Anyone", "error");
  } finally {
    DOM.btnTestConnection.disabled = false;
  }
}

async function loadRecords() {
  state.isLoading = true;
  render();
  if (state.isCloudMode) {
    try {
      const result = await requestCloud(state.settings.gasUrl, { action: "read" }, "GET");
      if (!result.success) throw new Error(result.error || "讀取失敗");
      state.records = normalizeRecords(result.data || []);
      localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(state.records));
    } catch (error) {
      state.records = normalizeRecords(JSON.parse(localStorage.getItem(STORAGE_KEYS.backup) || "[]"));
      showToast("雲端讀取失敗，已載入本機備份", "warning");
    }
  } else {
    const saved = localStorage.getItem(STORAGE_KEYS.records);
    state.records = saved ? normalizeRecords(JSON.parse(saved)) : [...demoRecords];
    if (!saved) saveLocalRecords();
  }
  state.isLoading = false;
  render();
}

function normalizeRecords(records) {
  return records.map(record => buildRecord(record)).sort(sortRecords);
}

function buildRecord(input) {
  const type = input.type || "lesson";
  const startTime = type === "leave" ? (input.startTime || "") : (input.startTime || "19:00");
  const endTime = type === "leave" ? (input.endTime || "") : (input.endTime || "20:30");
  const hourlyRate = Number(input.hourlyRate || input.rate || 500);
  const hours = type === "leave" ? 0 : Number(input.hours || calculateHours(startTime, endTime));
  const totalAmount = type === "leave" ? 0 : Number(input.totalAmount || Math.round(hours * hourlyRate));
  return {
    id: input.id || `tutor_${Date.now()}`,
    type,
    leaveSource: input.leaveSource || "",
    paymentGroupId: input.paymentGroupId || "",
    date: input.date || formatDate(new Date()),
    student: input.student || "",
    subject: input.subject || "",
    startTime,
    endTime,
    hours,
    hourlyRate,
    totalAmount,
    status: normalizeStatus(input.status || (type === "leave" ? "請假" : "未付款")),
    paymentDate: input.paymentDate || "",
    receivedDate: input.receivedDate || "",
    parentNote: input.parentNote || "",
    remarks: input.remarks || "",
    focusRating: Number(input.focusRating || 5),
    attitudeRating: Number(input.attitudeRating || 5),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function normalizeStatus(status) {
  if (status === "已付款") return "家長已付款";
  if (status === "已收到") return "老師已收到";
  return status || "未付款";
}

function calculateFormSummary() {
  const hours = calculateHours(DOM.recordStartTime.value, DOM.recordEndTime.value);
  const amount = Math.round(hours * (parseFloat(DOM.recordRate.value) || 0));
  DOM.calcHours.textContent = `${formatHours(hours)} 小時`;
  DOM.calcAmount.textContent = `$ ${amount.toLocaleString()}`;
  return { hours, amount };
}

async function handleAddRecord(event) {
  event.preventDefault();
  const calc = calculateFormSummary();
  const record = buildRecord({
    id: `tutor_${Date.now()}`,
    date: DOM.recordDate.value,
    student: DOM.recordStudent.value.trim(),
    subject: DOM.recordSubject.value.trim(),
    startTime: DOM.recordStartTime.value,
    endTime: DOM.recordEndTime.value,
    hours: calc.hours,
    hourlyRate: parseInt(DOM.recordRate.value, 10) || 0,
    totalAmount: calc.amount,
    status: "未付款",
    focusRating: parseInt(DOM.recordFocus.value, 10) || 5,
    attitudeRating: parseInt(DOM.recordAttitude.value, 10) || 5,
    remarks: buildRecordRemark()
  });

  DOM.btnSubmitRecord.disabled = true;
  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, { action: "add", record }, "POST");
      if (!result.success) throw new Error(result.error || "新增失敗");
      record.id = result.id || record.id;
      state.records.unshift(record);
      localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(state.records));
    } else {
      state.records.unshift(record);
      saveLocalRecords();
    }
    resetFormAfterAdd();
    showToast(state.recordMode === "planned" ? "已加入預排" : "已新增當日紀錄", "success");
  } catch (error) {
    showToast(error.message || "新增失敗", "error");
  } finally {
    DOM.btnSubmitRecord.disabled = false;
    render();
  }
}

function resetFormAfterAdd() {
  DOM.recordRemarks.value = "";
  DOM.recordStudent.focus();
}

async function deleteRecord(id) {
  if (!confirm("確定要刪除這筆紀錄嗎？")) return;
  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, { action: "delete", id }, "POST");
      if (!result.success) throw new Error(result.error || "刪除失敗");
    }
    state.records = state.records.filter(record => record.id !== id);
    persistAfterMutation();
    showToast("已刪除紀錄", "success");
    render();
  } catch (error) {
    showToast(error.message || "刪除失敗", "error");
  }
}

async function toggleRecordStatus(id) {
  const record = state.records.find(item => item.id === id);
  if (!record) return;
  const paymentGroupId = record.paymentGroupId || `manual_${Date.now()}`;
  const newStatus = record.status === "未付款" ? "家長已付款" : "未付款";
  const patch = {
    status: newStatus,
    paymentDate: newStatus === "家長已付款" ? (record.paymentDate || formatDate(new Date())) : "",
    paymentGroupId: newStatus === "家長已付款" ? paymentGroupId : ""
  };
  await updateRecordFields(id, patch, "付款狀態已更新");
}

async function confirmTeacherReceived(paymentGroupId) {
  const targets = state.records.filter(record => (
    record.type !== "leave" &&
    record.status === "家長已付款" &&
    (record.paymentGroupId || record.id) === paymentGroupId
  ));
  if (!targets.length) return;

  const ids = targets.map(record => record.id);
  const receivedDate = formatDate(new Date());
  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, {
        action: "bulkUpdateStatus",
        ids,
        status: "老師已收到",
        receivedDate
      }, "POST");
      if (!result.success) throw new Error(result.error || "確認收款失敗");
    }
    state.records.forEach(record => {
      if (ids.includes(record.id)) {
        record.status = "老師已收到";
        record.receivedDate = receivedDate;
        record.updatedAt = new Date().toISOString();
      }
    });
    persistAfterMutation();
    showToast("已確認區間收款", "success");
    render();
  } catch (error) {
    showToast(error.message || "確認收款失敗", "error");
  }
}

function openPaymentModal(id) {
  const record = state.records.find(item => item.id === id);
  if (!record) return;
  DOM.paymentRecordId.value = id;
  DOM.paymentDate.value = record.paymentDate || formatDate(new Date());
  DOM.paymentNote.value = record.parentNote || "";
  DOM.paymentModal.classList.remove("is-hidden");
}

function closePaymentModal() {
  DOM.paymentModal.classList.add("is-hidden");
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const id = DOM.paymentRecordId.value;
  await updateRecordFields(id, {
    status: DOM.paymentDate.value ? "家長已付款" : "未付款",
    paymentDate: DOM.paymentDate.value,
    paymentGroupId: DOM.paymentDate.value ? `manual_${Date.now()}` : "",
    parentNote: DOM.paymentNote.value.trim()
  }, "付款資訊已儲存");
  closePaymentModal();
}

async function handleParentRangePayment(event) {
  event.preventDefault();
  const startDate = DOM.parentPaymentStart.value;
  const endDate = DOM.parentPaymentEnd.value;
  const paymentDate = DOM.parentPaymentDate.value;
  const parentNote = DOM.parentPaymentNote.value.trim();
  if (!startDate || !endDate || !paymentDate) return;
  if (endDate < startDate) {
    showToast("結束日期不能早於開始日期", "warning");
    return;
  }

  const unpaid = getParentPaymentRecords();
  if (!unpaid.length) {
    showToast("這個日期區間沒有尚未確認付款的紀錄", "warning");
    return;
  }

  const ids = unpaid.map(record => record.id);
  const paymentGroupId = `pay_${Date.now()}`;
  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, {
        action: "bulkUpdateStatus",
        ids,
        status: "家長已付款",
        paymentDate,
        parentNote,
        paymentGroupId
      }, "POST");
      if (!result.success) throw new Error(result.error || "付款確認失敗");
    }
    state.records.forEach(record => {
      if (ids.includes(record.id)) {
        record.status = "家長已付款";
        record.paymentDate = paymentDate;
        record.parentNote = parentNote;
        record.paymentGroupId = paymentGroupId;
        record.updatedAt = new Date().toISOString();
      }
    });
    persistAfterMutation();
    DOM.parentPaymentNote.value = "";
    showToast("區間付款已送出，等待老師確認收到款項", "success");
    render();
  } catch (error) {
    showToast(error.message || "付款確認失敗", "error");
  }
}

async function handleAddLeave(event, source) {
  event.preventDefault();
  const isTeacher = source === "teacher";
  const startDate = isTeacher ? DOM.teacherLeaveDate.value : DOM.parentLeaveDate.value;
  const endDate = isTeacher ? DOM.teacherLeaveEndDate.value : DOM.parentLeaveEndDate.value;
  const leaveSource = isTeacher ? DOM.teacherLeaveSource.value : "student";
  const note = isTeacher ? DOM.teacherLeaveNote.value.trim() : DOM.parentLeaveNote.value.trim();
  const records = buildLeaveRecords(startDate, endDate, leaveSource, note);
  if (!records.length) {
    showToast("請確認請假日期區間", "warning");
    return;
  }

  try {
    if (state.isCloudMode) {
      for (const record of records) {
        const result = await requestCloud(state.settings.gasUrl, { action: "add", record }, "POST");
        if (!result.success) throw new Error(result.error || "新增請假失敗");
        record.id = result.id || record.id;
      }
    }
    state.records.unshift(...records);
    persistAfterMutation();
    if (isTeacher) DOM.teacherLeaveNote.value = "";
    else DOM.parentLeaveNote.value = "";
    showToast(`已加入${getLeaveSourceLabel(leaveSource)}`, "success");
    render();
  } catch (error) {
    showToast(error.message || "新增請假失敗", "error");
  }
}

async function updateRecordFields(id, patch, successMessage) {
  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, { action: "updateRecord", id, fields: patch }, "POST");
      if (!result.success) throw new Error(result.error || "更新失敗");
    }
    const record = state.records.find(item => item.id === id);
    if (record) Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    persistAfterMutation();
    showToast(successMessage, "success");
    render();
  } catch (error) {
    showToast(error.message || "更新失敗", "error");
  }
}

function persistAfterMutation() {
  state.records.sort(sortRecords);
  if (state.isCloudMode) localStorage.setItem(STORAGE_KEYS.backup, JSON.stringify(state.records));
  else saveLocalRecords();
}

function saveLocalRecords() {
  localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(state.records));
}

async function requestCloud(url, payload, method) {
  if (method === "GET") {
    const response = await fetch(`${url}?t=${Date.now()}`);
    return response.json();
  }
  const response = await fetch(url, { method: "POST", mode: "cors", body: JSON.stringify(payload) });
  return response.json();
}

function applyRole(role) {
  state.role = role;
  if (role === "parent") state.activeView = "calendar";
  localStorage.setItem(STORAGE_KEYS.role, role);
  DOM.workspace.classList.toggle("parent-mode", role === "parent");
  DOM.teacherPanel.classList.toggle("is-hidden", role !== "teacher");
  DOM.parentPanel.classList.toggle("is-hidden", role !== "parent");
  DOM.roleSwitch.querySelectorAll("button").forEach(button => {
    const active = button.dataset.role === role;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  DOM.viewSwitch.classList.toggle("is-hidden", role !== "teacher");
  DOM.viewSwitch.querySelectorAll("button").forEach(button => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  render();
}

function syncCurrentMonthRange() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  state.filters.startDate = formatDate(new Date(year, month, 1));
  state.filters.endDate = formatDate(new Date(year, month + 1, 0));
  if (DOM.parentPaymentStart) DOM.parentPaymentStart.value = state.filters.startDate;
  if (DOM.parentPaymentEnd) DOM.parentPaymentEnd.value = state.filters.endDate;
}

function changeMonth(offset) {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1);
  syncCurrentMonthRange();
  render();
}

function getFilteredRecords() {
  return state.records.filter(record => {
    if (state.filters.startDate && record.date < state.filters.startDate) return false;
    if (state.filters.endDate && record.date > state.filters.endDate) return false;
    return true;
  });
}

function render() {
  const records = getFilteredRecords();
  DOM.loadingSpinner.classList.toggle("is-hidden", !state.isLoading);
  DOM.emptyState.classList.toggle("is-hidden", true);
  DOM.calendarView.classList.toggle("is-hidden", state.isLoading || state.activeView !== "calendar");
  DOM.listView.classList.toggle("is-hidden", state.isLoading || state.activeView !== "list");
  DOM.dataTitle.textContent = state.activeView === "calendar" ? "月曆總覽" : "列表紀錄";
  renderStats(records);
  renderCalendar(records);
  renderList(records);
  renderParentUnpaidList();
  renderTeacherReceiveList();
  renderParentPaymentPreview();
}

function renderStats(records) {
  const lessons = records.filter(record => record.type !== "leave");
  const totalHours = sum(lessons, "hours");
  const unpaid = lessons.filter(record => record.status === "未付款");
  const paid = lessons.filter(record => record.status === "家長已付款" || record.status === "老師已收到");
  DOM.statHours.textContent = `${totalHours.toFixed(1)} 小時`;
  DOM.statUnpaidHours.textContent = `${sum(unpaid, "hours").toFixed(1)} 小時`;
  DOM.statPaid.textContent = `$ ${sum(paid, "totalAmount").toLocaleString()}`;
  DOM.recordCount.textContent = `${records.length} 筆紀錄`;
}

function renderCalendar(records) {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  DOM.calendarTitle.textContent = `${year} 年 ${month + 1} 月`;

  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstDay.getDay());
  const today = formatDate(new Date());
  const byDate = groupBy(records, "date");
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const dateKey = formatDate(date);
    const dayRecords = byDate[dateKey] || [];
    const dayClass = getDayStatusClass(dayRecords);
    const outside = date.getMonth() !== month;
    days.push(`
      <div class="calendar-day ${dayClass} ${outside ? "is-outside" : ""} ${dateKey === today ? "is-today" : ""} ${dateKey === state.selectedDate ? "is-selected" : ""} ${dayRecords.length ? "has-records" : ""}" data-date="${dateKey}" role="button" tabindex="0">
        <span class="day-number">${date.getDate()}</span>
        ${renderDaySummary(dayRecords)}
      </div>
    `);
  }
  DOM.calendarGrid.innerHTML = days.join("");
  DOM.calendarGrid.querySelectorAll(".calendar-day").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedDate = button.dataset.date;
      openDayPanel(button.dataset.date);
    });
    button.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedDate = button.dataset.date;
      openDayPanel(button.dataset.date);
    });
  });
}

function getDayStatusClass(records) {
  if (records.some(record => record.type === "leave")) return "has-leave";
  if (records.some(record => record.status === "老師已收到")) return "has-received";
  if (records.some(record => record.status === "家長已付款")) return "has-parent-paid";
  if (records.some(record => record.status === "未付款")) return "has-unpaid";
  if (records.some(record => record.type !== "leave")) return "has-lesson";
  return "";
}

function renderDaySummary(records) {
  if (!records.length) return "";
  const lessons = records.filter(record => record.type !== "leave");
  const leaves = records.filter(record => record.type === "leave");
  const pieces = [];
  if (lessons.length) {
    pieces.push(`<strong>${sum(lessons, "hours").toFixed(1)} 小時</strong><span>$ ${sum(lessons, "totalAmount").toLocaleString()}</span>`);
  }
  if (leaves.length) {
    const sourceLabels = [...new Set(leaves.map(record => getLeaveSourceLabel(record.leaveSource)))].join("、");
    pieces.push(`<span class="leave-mark">× ${escapeHTML(sourceLabels || "請假")}</span>`);
  }
  return `<span class="day-summary">${pieces.join("")}</span>`;
}

function renderList(records) {
  const sorted = records
    .filter(record => record.type !== "leave")
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  if (!sorted.length) {
    DOM.recordList.innerHTML = `<div class="empty-mini">目前沒有上課紀錄。</div>`;
    return;
  }

  DOM.recordList.innerHTML = sorted.map(record => {
    return `
      <article class="record-card">
        <div class="record-main">
          <strong>${escapeHTML(record.date)}　${escapeHTML(record.student || "未填學生")}｜${escapeHTML(record.subject || "未填科目")}</strong>
          <span>${escapeHTML(record.startTime)}-${escapeHTML(record.endTime)}　${formatHours(record.hours)} 小時　$ ${Number(record.totalAmount).toLocaleString()}</span>
          <small>專注度 ${renderStars(record.focusRating)}　學習態度 ${renderStars(record.attitudeRating)}</small>
          ${record.remarks ? `<small>${escapeHTML(record.remarks)}</small>` : ""}
        </div>
        <div class="record-actions">
          ${renderActions(record)}
        </div>
      </article>
    `;
  }).join("");
}

function renderParentUnpaidList() {
  const unpaid = getFilteredRecords()
    .filter(record => record.type !== "leave" && record.status === "未付款")
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  if (!unpaid.length) {
    DOM.parentUnpaidList.innerHTML = `<div class="empty-mini">目前沒有尚未確認付款的日期。</div>`;
    return;
  }

  DOM.parentUnpaidList.innerHTML = unpaid.map(record => `
    <article class="unpaid-item">
      <strong>${escapeHTML(record.date)}</strong>
      <span>${escapeHTML(record.student)}｜${escapeHTML(record.subject)}</span>
      <small>${record.startTime}-${record.endTime}　${formatHours(record.hours)} 小時　$ ${record.totalAmount.toLocaleString()}</small>
    </article>
  `).join("");
}

function renderTeacherReceiveList() {
  const pending = getFilteredRecords()
    .filter(record => record.type !== "leave" && record.status === "家長已付款")
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  if (!pending.length) {
    DOM.teacherReceiveList.innerHTML = `<div class="empty-mini">目前沒有待老師確認收到的款項。</div>`;
    return;
  }

  const groups = Object.values(pending.reduce((acc, record) => {
    const key = record.paymentGroupId || record.id;
    acc[key] = acc[key] || { id: key, records: [] };
    acc[key].records.push(record);
    return acc;
  }, {}));

  DOM.teacherReceiveList.innerHTML = groups.map(group => {
    const records = group.records.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    const dates = records.map(record => record.date);
    const range = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} 至 ${dates[dates.length - 1]}`;
    return `
      <article class="unpaid-item">
        <strong>${escapeHTML(range)}</strong>
        <span>${records.length} 筆｜${formatHours(sum(records, "hours"))} 小時｜$ ${sum(records, "totalAmount").toLocaleString()}</span>
        <small>家長付款日：${escapeHTML(records[0].paymentDate || "未填")}</small>
        <button type="button" class="small-button receive" onclick="confirmTeacherReceived('${escapeAttr(group.id)}')">確認區間收款</button>
      </article>
    `;
  }).join("");
}

function renderParentPaymentPreview() {
  const records = getParentPaymentRecords();
  const hours = sum(records, "hours");
  const amount = sum(records, "totalAmount");
  DOM.parentPaymentSummary.textContent = `${records.length} 筆｜${formatHours(hours)} 小時`;
  DOM.parentPaymentAmount.textContent = `$ ${amount.toLocaleString()}`;
}

async function handleParentScheduleSubmit(event) {
  event.preventDefault();
  const startDate = DOM.parentScheduleStartDate.value;
  const untilDate = DOM.parentScheduleUntil.value;
  const startTime = DOM.parentScheduleStartTime.value;
  const endTime = DOM.parentScheduleEndTime.value;
  const weekdays = [...document.querySelectorAll("input[name='parent-schedule-weekday']:checked")].map(input => Number(input.value));

  if (!startDate || !untilDate || !startTime || !endTime) return;
  if (untilDate < startDate) {
    showToast("重複到日期不能早於開始日期", "warning");
    return;
  }
  if (!weekdays.length) {
    showToast("請至少選一個每週上課日", "warning");
    return;
  }

  const records = buildScheduleRecords({
    startDate,
    untilDate,
    weekdays,
    startTime,
    endTime,
    sourceLabel: "家長預排"
  });
  await addRecords(records, "已加入家長預排上課");
}

function openDayPanel(date) {
  DOM.dayPanelDate.value = date;
  DOM.dayPanelDateLabel.textContent = date;
  DOM.dayLessonStartTime.value = DOM.dayLessonStartTime.value || "15:00";
  DOM.dayLessonEndTime.value = DOM.dayLessonEndTime.value || "17:00";
  renderDayPanelRecords(date);
  DOM.dayPanel.classList.remove("is-hidden");
}

function closeDayPanel() {
  DOM.dayPanel.classList.add("is-hidden");
}

function renderDayPanelRecords(date) {
  const records = state.records
    .filter(record => record.date === date)
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

  if (!records.length) {
    DOM.dayPanelRecords.innerHTML = `<div class="empty-mini">這一天目前沒有行程。</div>`;
    return;
  }

  DOM.dayPanelRecords.innerHTML = records.map(record => {
    if (record.type === "leave") {
      return `
        <article class="day-panel-item leave">
          <strong>${getLeaveSourceLabel(record.leaveSource)}</strong>
          <span>${escapeHTML(record.remarks || "請假")}</span>
        </article>
      `;
    }
    return `
      <article class="day-panel-item">
        <strong>${escapeHTML(record.startTime)}-${escapeHTML(record.endTime)}　上課</strong>
        <span>${formatHours(record.hours)} 小時　$ ${Number(record.totalAmount).toLocaleString()}　${escapeHTML(record.status)}</span>
      </article>
    `;
  }).join("");
}

async function handleDayAddLeave() {
  const date = DOM.dayPanelDate.value;
  const source = state.role === "teacher" ? "teacher" : "student";
  await quickAddLeave(date, source);
  openDayPanel(date);
}

async function handleDayRemoveLeave() {
  const date = DOM.dayPanelDate.value;
  const source = state.role === "teacher" ? "teacher" : "student";
  const leaves = state.records.filter(record => record.type === "leave" && record.date === date && record.leaveSource === source);
  if (!leaves.length) {
    showToast("這一天沒有可取消的請假", "warning");
    return;
  }
  await removeLeaveRecords(leaves);
  openDayPanel(date);
}

async function handleDayAddLesson() {
  const date = DOM.dayPanelDate.value;
  const startTime = DOM.dayLessonStartTime.value;
  const endTime = DOM.dayLessonEndTime.value;
  const hours = calculateHours(startTime, endTime);
  const hourlyRate = Number(state.settings.defaultRate || 0);
  const record = buildRecord({
    id: `day_lesson_${Date.now()}`,
    date,
    student: "",
    subject: "預約上課",
    startTime,
    endTime,
    hours,
    hourlyRate,
    totalAmount: Math.round(hours * hourlyRate),
    status: "未付款",
    remarks: "月曆快速預約"
  });

  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, { action: "add", record }, "POST");
      if (!result.success) throw new Error(result.error || "新增上課失敗");
      record.id = result.id || record.id;
    }
    state.records.unshift(record);
    persistAfterMutation();
    showToast("已加入上課時段", "success");
    render();
    openDayPanel(date);
  } catch (error) {
    showToast(error.message || "新增上課失敗", "error");
  }
}

async function removeLeaveRecords(records) {
  const ids = records.map(record => record.id);
  try {
    if (state.isCloudMode) {
      for (const id of ids) {
        const result = await requestCloud(state.settings.gasUrl, { action: "delete", id }, "POST");
        if (!result.success) throw new Error(result.error || "取消請假失敗");
      }
    }
    state.records = state.records.filter(record => !ids.includes(record.id));
    persistAfterMutation();
    showToast("已取消請假，日期恢復原樣", "success");
    render();
  } catch (error) {
    showToast(error.message || "取消請假失敗", "error");
  }
}

async function quickAddLeave(date, source) {
  const record = buildRecord({
    id: `leave_${Date.now()}`,
    type: "leave",
    leaveSource: source,
    date,
    remarks: `${getLeaveSourceLabel(source)}`
  });

  try {
    if (state.isCloudMode) {
      const result = await requestCloud(state.settings.gasUrl, { action: "add", record }, "POST");
      if (!result.success) throw new Error(result.error || "新增請假失敗");
      record.id = result.id || record.id;
    }
    state.records.unshift(record);
    persistAfterMutation();
    showToast(`已加入${getLeaveSourceLabel(source)}`, "success");
    render();
  } catch (error) {
    showToast(error.message || "新增請假失敗", "error");
  }
}

function buildScheduleRecords({ startDate, untilDate, weekdays, startTime, endTime, sourceLabel }) {
  const records = [];
  const start = parseDate(startDate);
  const end = parseDate(untilDate);
  const hours = calculateHours(startTime, endTime);
  const hourlyRate = Number(state.settings.defaultRate || 0);
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    if (!weekdays.includes(date.getDay())) continue;
    records.push(buildRecord({
      id: `schedule_${Date.now()}_${records.length}`,
      date: formatDate(date),
      student: "",
      subject: "預約上課",
      startTime,
      endTime,
      hours,
      hourlyRate,
      totalAmount: Math.round(hours * hourlyRate),
      status: "未付款",
      remarks: `${sourceLabel}｜時間：${startTime}-${endTime}`
    }));
  }
  return records;
}

async function addRecords(records, successMessage) {
  if (!records.length) {
    showToast("這個日期範圍沒有符合的上課日", "warning");
    return;
  }
  try {
    if (state.isCloudMode) {
      for (const record of records) {
        const result = await requestCloud(state.settings.gasUrl, { action: "add", record }, "POST");
        if (!result.success) throw new Error(result.error || "新增失敗");
        record.id = result.id || record.id;
      }
    }
    state.records.unshift(...records);
    persistAfterMutation();
    showToast(successMessage, "success");
    render();
  } catch (error) {
    showToast(error.message || "新增失敗", "error");
  }
}

function getParentPaymentRecords() {
  const startDate = DOM.parentPaymentStart.value;
  const endDate = DOM.parentPaymentEnd.value;
  if (!startDate || !endDate || endDate < startDate) return [];
  return state.records.filter(record => (
    record.type !== "leave" &&
    record.status === "未付款" &&
    record.date >= startDate &&
    record.date <= endDate
  ));
}

function buildRecordRemark() {
  const note = DOM.recordRemarks.value.trim();
  if (state.recordMode === "actual") return note;
  const repeat = document.getElementById("record-repeat").value;
  const repeatUntil = document.getElementById("record-repeat-until").value;
  const plannedStartTime = DOM.recordPlannedStartTime.value;
  const plannedEndTime = DOM.recordPlannedEndTime.value;
  const weekdays = [...document.querySelectorAll("input[name='record-repeat-weekday']:checked")]
    .map(input => input.parentElement.textContent.trim())
    .join("、");
  return [
    `預排`,
    `重複：${getRepeatLabel(repeat)}`,
    weekdays ? `星期：${weekdays}` : "",
    plannedStartTime && plannedEndTime ? `時間：${plannedStartTime}-${plannedEndTime}` : "",
    repeatUntil ? `到：${repeatUntil}` : "",
    note
  ].filter(Boolean).join("｜");
}

function updateRecordModeUI() {
  const isPlanned = state.recordMode === "planned";
  DOM.schedulePanel.classList.toggle("is-hidden", !isPlanned);
  DOM.recordDateLabel.textContent = isPlanned ? "預排日期" : "上課日期";
  DOM.btnSubmitRecord.textContent = isPlanned ? "加入預排" : "新增當日紀錄";
}

function getRepeatLabel(value) {
  if (value === "weekly") return "每週";
  if (value === "biweekly") return "每兩週";
  if (value === "monthly") return "每月";
  return "不重複";
}

function buildLeaveRecords(startDate, endDate, source, note) {
  if (!startDate || !endDate || endDate < startDate) return [];
  const records = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    records.push(buildRecord({
      id: `leave_${Date.now()}_${records.length}`,
      type: "leave",
      leaveSource: source,
      date: formatDate(date),
      remarks: note || getLeaveSourceLabel(source),
      status: "請假"
    }));
  }
  return records;
}

function syncLeaveEndDate(startInput, endInput) {
  if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
}

function renderActions(record) {
  const statusClass = record.status === "老師已收到" ? "received" : record.status === "家長已付款" ? "parent-paid" : "unpaid";
  const teacherActions = state.role === "teacher" ? `<button type="button" class="small-button danger" onclick="deleteRecord('${escapeAttr(record.id)}')">刪除</button>` : "";
  return `
    <button type="button" class="pill ${statusClass}" onclick="toggleRecordStatus('${escapeAttr(record.id)}')">${record.status}</button>
    <button type="button" class="small-button" onclick="openPaymentModal('${escapeAttr(record.id)}')">付款備註</button>
    ${teacherActions}
  `;
}

function calculateHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  let start = startH * 60 + startM;
  let end = endH * 60 + endM;
  if (end < start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getOffsetDateString(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return formatDate(date);
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key];
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function sortRecords(a, b) {
  if (a.date === b.date) return (b.startTime || "").localeCompare(a.startTime || "");
  return b.date.localeCompare(a.date);
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function formatHours(value) {
  const hours = Number(value) || 0;
  return hours.toFixed(hours % 1 ? 1 : 0);
}

function renderStars(value) {
  const count = Math.max(1, Math.min(5, Number(value) || 5));
  return `<span class="stars">${"★".repeat(count)}${"☆".repeat(5 - count)}</span>`;
}

function getLeaveSourceLabel(source) {
  if (source === "teacher") return "老師請假";
  if (source === "student" || source === "parent") return "學生請假";
  return "請假";
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#096;");
}

let toastTimer;
function showToast(message, type = "info") {
  DOM.toast.textContent = message;
  DOM.toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove("show"), 2800);
}

window.deleteRecord = deleteRecord;
window.toggleRecordStatus = toggleRecordStatus;
window.openPaymentModal = openPaymentModal;
window.confirmTeacherReceived = confirmTeacherReceived;
window.quickAddLeave = quickAddLeave;
