/**
 * 家教時數帳本 - Google Apps Script API
 *
 * 部署方式：
 * 1. 建立空白 Google 試算表。
 * 2. 擴充功能 -> Apps Script，貼上此檔案。
 * 3. 部署 -> 新增部署 -> 網頁應用程式。
 * 4. 執行身分選「我」，存取權選「所有人」。
 * 5. 將 Web App URL 貼回網站設定。
 */

var HEADERS = [
  "id",
  "type",
  "leaveSource",
  "paymentGroupId",
  "date",
  "student",
  "subject",
  "startTime",
  "endTime",
  "hours",
  "hourlyRate",
  "totalAmount",
  "status",
  "paymentDate",
  "receivedDate",
  "parentNote",
  "remarks",
  "focusRating",
  "attitudeRating",
  "updatedAt"
];

var DATE_FIELDS = ["date", "paymentDate", "receivedDate"];
var TIME_FIELDS = ["startTime", "endTime"];

function doGet() {
  try {
    var sheet = getOrCreateSheet();
    return jsonResponse({ success: true, data: getSheetData(sheet) });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "沒有提供請求資料" });
    }

    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var sheet = getOrCreateSheet();

    if (action === "read") {
      return jsonResponse({ success: true, data: getSheetData(sheet) });
    }

    if (action === "add") {
      return addRecord(sheet, params.record);
    }

    if (action === "updateStatus") {
      return updateRecord(sheet, params.id, { status: params.status });
    }

    if (action === "updateRecord") {
      return updateRecord(sheet, params.id, params.fields || {});
    }

    if (action === "bulkUpdateStatus") {
      return bulkUpdateStatus(sheet, params.ids, params.status, params.paymentDate, params.parentNote, params.paymentGroupId, params.receivedDate);
    }

    if (action === "delete") {
      return deleteRecord(sheet, params.id);
    }

    return jsonResponse({ success: false, error: "不支援的 Action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0] || ss.insertSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    migrateHeaders(sheet);
  }
  return sheet;
}

function migrateHeaders(sheet) {
  var range = sheet.getDataRange();
  var values = range.getValues();
  var existing = values[0];
  if (existing.join("|") === HEADERS.join("|")) return;

  var reordered = [HEADERS];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var sourceRow = values[rowIndex];
    var nextRow = HEADERS.map(function(header) {
      var sourceIndex = existing.indexOf(header);
      return sourceIndex >= 0 ? sourceRow[sourceIndex] : "";
    });
    reordered.push(nextRow);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, reordered.length, HEADERS.length).setValues(reordered);
}

function addRecord(sheet, record) {
  if (!record || !record.date || !record.startTime || !record.endTime) {
    return jsonResponse({ success: false, error: "缺少必要欄位" });
  }
  var normalized = normalizeRecord(record);
  normalized.id = normalized.id || "tutor_" + new Date().getTime();
  normalized.updatedAt = new Date().toISOString();

  var row = HEADERS.map(function(header) {
    return normalized[header] === undefined ? "" : normalized[header];
  });
  sheet.appendRow(row);
  return jsonResponse({ success: true, message: "新增成功", id: normalized.id });
}

function updateRecord(sheet, id, fields) {
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex < 0) {
    return jsonResponse({ success: false, error: "找不到資料 ID: " + id });
  }

  var headers = getHeaders(sheet);
  fields.updatedAt = new Date().toISOString();
  Object.keys(fields).forEach(function(key) {
    var col = headers.indexOf(key);
    if (col >= 0) {
      sheet.getRange(rowIndex, col + 1).setValue(fields[key]);
    }
  });
  return jsonResponse({ success: true, message: "更新成功" });
}

function bulkUpdateStatus(sheet, ids, status, paymentDate, parentNote, paymentGroupId, receivedDate) {
  if (!Array.isArray(ids)) {
    return jsonResponse({ success: false, error: "ids 必須是陣列" });
  }
  var headers = getHeaders(sheet);
  var statusCol = headers.indexOf("status") + 1;
  var paymentDateCol = headers.indexOf("paymentDate") + 1;
  var receivedDateCol = headers.indexOf("receivedDate") + 1;
  var parentNoteCol = headers.indexOf("parentNote") + 1;
  var paymentGroupIdCol = headers.indexOf("paymentGroupId") + 1;
  var updatedAtCol = headers.indexOf("updatedAt") + 1;
  var rows = sheet.getDataRange().getValues();
  var count = 0;

  for (var i = 1; i < rows.length; i++) {
    var rowId = rows[i][0].toString();
    if (ids.indexOf(rowId) !== -1) {
      if (statusCol > 0) sheet.getRange(i + 1, statusCol).setValue(status);
      if (paymentDateCol > 0 && paymentDate) sheet.getRange(i + 1, paymentDateCol).setValue(paymentDate);
      if (receivedDateCol > 0 && receivedDate) sheet.getRange(i + 1, receivedDateCol).setValue(receivedDate);
      if (parentNoteCol > 0 && parentNote !== undefined) sheet.getRange(i + 1, parentNoteCol).setValue(parentNote);
      if (paymentGroupIdCol > 0 && paymentGroupId) sheet.getRange(i + 1, paymentGroupIdCol).setValue(paymentGroupId);
      if (updatedAtCol > 0) sheet.getRange(i + 1, updatedAtCol).setValue(new Date().toISOString());
      count++;
    }
  }
  return jsonResponse({ success: true, message: "批次更新成功", count: count });
}

function deleteRecord(sheet, id) {
  var rowIndex = findRowIndexById(sheet, id);
  if (rowIndex < 0) {
    return jsonResponse({ success: false, error: "找不到資料 ID: " + id });
  }
  sheet.deleteRow(rowIndex);
  return jsonResponse({ success: true, message: "刪除成功" });
}

function getSheetData(sheet) {
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = getHeaders(sheet);
  var data = [];

  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = formatValue(rows[i][j], headers[j]);
    }
    data.push(normalizeRecord(obj));
  }

  data.sort(function(a, b) {
    if (a.date === b.date) return String(b.startTime).localeCompare(String(a.startTime));
    return String(b.date).localeCompare(String(a.date));
  });
  return data;
}

function normalizeRecord(record) {
  var type = record.type || "lesson";
  var startTime = normalizeTimeValue(record.startTime);
  var endTime = normalizeTimeValue(record.endTime);
  var hours = type === "leave" ? 0 : Number(record.hours || calculateHours(startTime, endTime));
  var hourlyRate = Number(record.hourlyRate || 0);
  return {
    id: record.id || "",
    type: type,
    leaveSource: record.leaveSource || "",
    paymentGroupId: record.paymentGroupId || "",
    date: normalizeDateValue(record.date),
    student: record.student || "",
    subject: record.subject || "",
    startTime: startTime,
    endTime: endTime,
    hours: hours,
    hourlyRate: hourlyRate,
    totalAmount: type === "leave" ? 0 : Number(record.totalAmount || Math.round(hours * hourlyRate)),
    status: normalizeStatus(record.status || "未付款"),
    paymentDate: normalizeDateValue(record.paymentDate),
    receivedDate: normalizeDateValue(record.receivedDate),
    parentNote: record.parentNote || "",
    remarks: record.remarks || "",
    focusRating: Number(record.focusRating || 5),
    attitudeRating: Number(record.attitudeRating || 5),
    updatedAt: normalizeUpdatedAtValue(record.updatedAt)
  };
}

function normalizeDateValue(value) {
  if (!value) return "";
  if (isDateLike(value)) return formatDate(value);
  if (typeof value === "string" && value.indexOf("T") > -1) return formatDate(new Date(value));
  return value;
}

function normalizeTimeValue(value) {
  if (!value) return "";
  if (isDateLike(value)) return formatTime(value);
  if (typeof value === "string" && value.indexOf("T") > -1) return formatTime(new Date(value));
  return value;
}

function normalizeUpdatedAtValue(value) {
  if (!value) return "";
  if (isDateLike(value)) return value.toISOString();
  return value;
}

function normalizeStatus(status) {
  if (status === "已付款") return "家長已付款";
  if (status === "已收到") return "老師已收到";
  return status || "未付款";
}

function findRowIndexById(sheet, id) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === id.toString()) {
      return i + 1;
    }
  }
  return -1;
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function calculateHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  var startParts = startTime.toString().split(":");
  var endParts = endTime.toString().split(":");
  var start = Number(startParts[0]) * 60 + Number(startParts[1]);
  var end = Number(endParts[0]) * 60 + Number(endParts[1]);
  if (end < start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function formatValue(value, header) {
  if (!isDateLike(value)) return value;
  if (header === "startTime" || header === "endTime") return formatTime(value);
  if (header === "updatedAt") return value.toISOString();
  return formatDate(value);
}

function formatTime(date) {
  var hours = String(date.getHours());
  var minutes = String(date.getMinutes());
  if (hours.length < 2) hours = "0" + hours;
  if (minutes.length < 2) minutes = "0" + minutes;
  return [hours, minutes].join(":");
}

function formatDate(date) {
  var month = String(date.getMonth() + 1);
  var day = String(date.getDate());
  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;
  return [date.getFullYear(), month, day].join("-");
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(sanitizeForJson(data)))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeForJson(value, key) {
  if (isDateLike(value)) {
    if (TIME_FIELDS.indexOf(key) !== -1) return formatTime(value);
    if (key === "updatedAt") return value.toISOString();
    return formatDate(value);
  }

  if (typeof value === "string" && value.indexOf("T") > -1) {
    if (DATE_FIELDS.indexOf(key) !== -1) return formatDate(new Date(value));
    if (TIME_FIELDS.indexOf(key) !== -1) return formatTime(new Date(value));
  }

  if (Array.isArray(value)) {
    return value.map(function(item) {
      return sanitizeForJson(item, "");
    });
  }

  if (value && typeof value === "object") {
    var sanitized = {};
    Object.keys(value).forEach(function(childKey) {
      sanitized[childKey] = sanitizeForJson(value[childKey], childKey);
    });
    return sanitized;
  }

  return value;
}

function isDateLike(value) {
  return value
    && typeof value === "object"
    && typeof value.getFullYear === "function"
    && typeof value.getMonth === "function"
    && typeof value.getDate === "function";
}
