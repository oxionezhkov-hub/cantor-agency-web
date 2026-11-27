// Bind this Apps Script deployment to a dedicated test workbook and tab via Script Properties.
const FIELDS = ["Title", "Description", "Address", "Price", "Images", "Category"];
const REQUIRED = ["Title", "Description", "Address", "Category"];
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,150}$/;
const NEW_ID = /^cantor-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function doPost(event) {
  const props = PropertiesService.getScriptProperties();
  const reply = (data) => ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const input = JSON.parse(event.postData.contents);
    const token = props.getProperty("CANTOR_SYNC_SECRET");
    if (!token || !sameSecret(input.token, token)) return reply({ error: "unauthorized" });
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return reply({ error: "busy" });
    try {
      const book = SpreadsheetApp.openById(props.getProperty("CANTOR_TEST_SHEET_ID"));
      const tab = book.getSheetByName(props.getProperty("CANTOR_TEST_TAB"));
      if (!tab) return reply({ error: "sheet_unavailable" });
      const reportsTab = props.getProperty("CANTOR_TEST_REPORT_TAB");
      const reports = reportsTab ? book.getSheetByName(reportsTab) : null;
      return reply(syncSheet(tab, input, readReports(reports)));
    } finally {
      lock.releaseLock();
    }
  } catch {
    return reply({ error: "sheet_unavailable" });
  }
}

function sameSecret(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function revision(row) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(row), Utilities.Charset.UTF_8),
  ).replace(/=+$/, "");
}

function readReports(tab) {
  const entries = new Map();
  for (const [feedId, rowRevision, avitoId, result, reason] of tab?.getDataRange().getDisplayValues().slice(1) || []) {
    if (!ID_PATTERN.test(feedId) || !["applied", "rejected"].includes(result)) continue;
    if (!/^[A-Za-z0-9_-]{43}$/.test(rowRevision) || (result === "applied" && !/^\d+$/.test(avitoId))) continue;
    entries.set(feedId, { rowRevision, avitoId, result, reason: reason || "" });
  }
  return entries;
}

function sheetModel(tab, reports) {
  const grid = tab.getDataRange().getDisplayValues();
  const tags = (grid[1] || []).map((x) => x.trim());
  const marks = grid[2] || [];
  const id = tags.findIndex((tag) => /^id$/i.test(tag));
  if (id < 0 || tags.filter((tag) => /^id$/i.test(tag)).length !== 1) return null;
  const columns = new Map();
  for (const tag of FIELDS) {
    const matches = tags.flatMap((value, index) =>
      value === tag && marks[index]?.trim().toLowerCase() === "грузим в xml" ? [index] : [],
    );
    if (matches.length > 1 || (REQUIRED.includes(tag) && !matches.length)) return null;
    if (matches.length) columns.set(tag, matches[0]);
  }
  const rowVersions = grid[3] ? grid[3] : [];
  const firstDataIndex = rowVersions[id]?.trim().toLowerCase() === "подробнее о параметре" ? 4 : 3;
  const counts = new Map();
  for (const values of grid.slice(firstDataIndex)) {
    const key = values[id]?.trim();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [];
  const problems = [];
  for (let index = firstDataIndex; index < grid.length; index++) {
    const values = grid[index];
    const feedId = values[id]?.trim();
    if (!feedId && ![...columns.values()].some((i) => values[i]?.trim())) continue;
    if (!ID_PATTERN.test(feedId || "")) {
      problems.push({ row: index + 1, message: "Укажите стабильный Id автозагрузки в таблице." });
      continue;
    }
    if (counts.get(feedId) > 1) {
      problems.push({ row: index + 1, message: "Id автозагрузки повторяется: " + feedId });
      continue;
    }
    const fields = Object.fromEntries([...columns].map(([key, i]) => [key, values[i] || ""]));
    const source = tags.flatMap((tag, i) => marks[i]?.trim().toLowerCase() === "грузим в xml"
      || tag === "Товар доступен?" || tag === "Папка на Яндекс Диск" ? [[tag, values[i] || ""]] : []);
    const rowRevision = revision(source);
    const missing = REQUIRED.filter((key) => !fields[key]?.trim() || fields[key].trim() === "-");
    const report = reports.get(feedId);
    rows.push({
      feedId, row: index + 1, revision: rowRevision, fields, missing,
      avitoId: /^\d+$/.test(report?.avitoId || "") ? report.avitoId : undefined,
      status: missing.length ? "validation" : report?.rowRevision === rowRevision ? report.result : "pending",
      message: report?.rowRevision === rowRevision && report.result === "rejected" ? report.reason : "",
    });
  }
  return { columns, id, rows, problems, tags, counts };
}

function syncSheet(tab, input, reports = new Map()) {
  const model = sheetModel(tab, reports);
  if (!model) return { error: "invalid_template" };
  if (input.action === "list") {
    return {
      rows: model.rows, problems: model.problems,
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + tab.getParent().getId() + "/edit#gid=" + tab.getSheetId(),
      tab: tab.getName(),
    };
  }
  if (input.action !== "save" || !Array.isArray(input.edits) || !input.edits.length || input.edits.length > 300) {
    return { error: "invalid_request" };
  }
  const ids = new Set();
  const results = [];
  let current = model;
  for (const edit of input.edits) {
    const key = edit?.feedId;
    const fields = edit?.fields;
    const finish = (status, detail = {}) => results.push({ feedId: key || "", status, ...detail });
    if (!ID_PATTERN.test(key || "") || ids.has(key) || !fields || Array.isArray(fields)
        || typeof fields !== "object" || !Object.keys(fields).length
        || Object.entries(fields).some(([name, value]) =>
          !model.columns.has(name) || typeof value !== "string" || value.length > 30000)) {
      finish("validation", { message: "Проверьте поля объявления и наличие соответствующих колонок в таблице." });
      continue;
    }
    ids.add(key);
    if (current.counts.get(key) > 1) {
      finish("conflict", { message: "Id автозагрузки повторяется в таблице. Исправьте строки перед сохранением." });
      continue;
    }
    const before = current.rows.find((row) => row.feedId === key);
    if (before && Object.entries(fields).every(([name, value]) => before.fields[name] === value)) {
      finish(before.status, { row: before });
      continue;
    }
    if ((before && edit.revision !== before.revision) || (!before && (edit.revision || !NEW_ID.test(key)))) {
      finish("conflict", { row: before, message: "Строка изменилась. Загрузите свежую версию перед сохранением." });
      continue;
    }
    const values = { ...before?.fields, ...fields };
    const missing = REQUIRED.filter((name) => !values[name]?.trim() || values[name].trim() === "-");
    if (missing.length || (values.Price?.trim() && !/^\d+(?:[.,]\d{1,2})?$/.test(values.Price.trim()))
        || (fields.Images && fields.Images.split(/\s+/).some((url) => url && !/^https?:\/\/[^\s]+$/i.test(url)))) {
      finish("validation", { message: missing.length
        ? "Заполните обязательные поля: " + missing.join(", ")
        : "Проверьте цену и ссылки на фотографии." });
      continue;
    }
    try {
      if (!before) {
        const row = Array(current.tags.length).fill("");
        row[current.id] = key;
        for (const [name, value] of Object.entries(fields)) row[current.columns.get(name)] = value;
        // Append the complete row once. Repeating the request matches its stable ID.
        const sheet = "'" + tab.getName().replace(/'/g, "''") + "'";
        Sheets.Spreadsheets.Values.append({ values: [row] }, tab.getParent().getId(), sheet + "!A4:" + columnLabel(row.length - 1), {
          valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
        });
      } else {
        const recent = sheetModel(tab, reports)?.rows.find((row) => row.feedId === key);
        if (!recent || recent.revision !== before.revision) {
          finish("conflict", { row: recent, message: "Строка изменилась. Загрузите свежую версию перед сохранением." });
          current = sheetModel(tab, reports) || current;
          continue;
        }
        // The Sheets Advanced Service writes all changed cells atomically in RAW mode.
        const updates = Object.entries(fields).filter(([name, value]) => recent.fields[name] !== value);
        const sheet = "'" + tab.getName().replace(/'/g, "''") + "'";
        Sheets.Spreadsheets.Values.batchUpdate({
          valueInputOption: "RAW",
          data: updates.map(([name, value]) => ({
            range: sheet + "!" + columnLabel(current.columns.get(name)) + recent.row, values: [[value]],
          })),
        }, tab.getParent().getId());
      }
      SpreadsheetApp.flush();
      current = sheetModel(tab, reports) || current;
      const row = current.rows.find((item) => item.feedId === key);
      const confirmed = row && Object.entries(fields).every(([name, value]) => row.fields[name] === value);
      if (confirmed) finish(row.status, { row });
      else finish("write_failed", { row, message: "Не удалось подтвердить запись строки. Обновите таблицу перед повтором." });
    } catch {
      current = sheetModel(tab, reports) || current;
      finish("write_failed", { message: "Строка не записалась. Проверьте доступ к таблице и повторите." });
    }
  }
  return { results };
}

function columnLabel(index) {
  let label = "";
  for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    label = String.fromCharCode(65 + ((column - 1) % 26)) + label;
  }
  return label;
}
