import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { adSheetSync } from "./ad-sheet-sync.mjs";

const code = readFileSync(new URL("../sheets/ad-sync.gs", import.meta.url), "utf8");
const appId = "cantor-861cf6a2-1003-4a00-b00c-03f4886edc51";

function fixture() {
  const tags = [
    "Id",
    "Title",
    "Description",
    "Address",
    "Price",
    "Images",
    "Category",
    "ServiceType",
  ];
  const grid = [
    tags,
    tags,
    tags.map(() => "Грузим в XML"),
    ["Подробнее о параметре"],
    ["existing", "Урок", "Описание", "Омск", "1000", "", "Предложение услуг", "Параметр"],
  ];
  const tab = {
    getDataRange: () => ({ getDisplayValues: () => structuredClone(grid) }),
    getName: () => "Авито",
    getParent: () => ({ getId: () => "synthetic-sheet-id" }),
    getSheetId: () => 42,
  };
  const unavailableRows = new Set();
  const Sheets = {
    Spreadsheets: {
      Values: {
        append: ({ values }) => grid.push(...values),
        batchUpdate: ({ valueInputOption, data }) => {
          assert.equal(valueInputOption, "RAW");
          const cells = data.map(({ range, values }) => {
            const [, col, row] = range.match(/!([A-Z])(\d+)$/);
            return { row: Number(row), column: col.charCodeAt() - 65, value: values[0][0] };
          });
          if (cells.some(({ row }) => unavailableRows.has(row))) throw new Error("failure");
          for (const { row, column, value } of cells) grid[row - 1][column] = value;
        },
      },
    },
  };
  const context = createContext({
    Sheets,
    SpreadsheetApp: { flush() {} },
    Utilities: {
      DigestAlgorithm: {},
      Charset: {},
      computeDigest: (_, value) => createHash("sha256").update(value).digest(),
      base64EncodeWebSafe: (value) => value.toString("base64url"),
    },
  });
  runInContext(code, context);
  const run = (action, edits, reports) =>
    JSON.parse(JSON.stringify(context.syncSheet(tab, { action, edits }, reports)));
  const rows = () => run("list").rows;
  return { grid, run, rows, unavailableRows };
}

test("imports a native row, reflects sheet edits, and updates the same ID after row reorder", () => {
  const { grid, run, rows } = fixture();
  const before = rows()[0];
  grid.push(["new-in-sheet", "Новая строка", "Описание", "Омск", "2300", "", "Предложение услуг"]);
  assert.deepEqual(
    rows().map((row) => row.feedId),
    ["existing", "new-in-sheet"],
  );
  grid[4][1] = "Правка из таблицы";
  assert.equal(rows()[0].fields.Title, "Правка из таблицы");
  assert.notEqual(rows()[0].revision, before.revision);
  const stale = run("save", [
    { feedId: "existing", revision: before.revision, fields: { Title: "Правка из сервиса" } },
  ]);
  assert.equal(stale.results[0].status, "conflict");
  const fresh = rows()[0];
  [grid[4], grid[5]] = [grid[5], grid[4]];
  const saved = run("save", [
    { feedId: fresh.feedId, revision: fresh.revision, fields: { Title: "Правка из сервиса" } },
  ]);
  assert.equal(saved.results[0].status, "pending");
  assert.equal(saved.results[0].row.row, 6);
  assert.equal(grid[5][1], "Правка из сервиса");
  assert.equal(grid[5][7], "Параметр");
});

test("Cantor creation retries are idempotent and existing IDs cannot be overwritten by creation", () => {
  const { grid, run, rows } = fixture();
  const creation = {
    feedId: appId,
    fields: {
      Title: "Репетитор",
      Description: "=Это текст",
      Address: "Омск",
      Category: "Предложение услуг",
    },
  };
  assert.equal(run("save", [creation]).results[0].status, "pending");
  assert.equal(run("save", [creation]).results[0].status, "pending");
  assert.equal(grid.length, 6);
  assert.equal(rows()[1].fields.Description, "=Это текст");
  assert.equal(
    run("save", [{ ...creation, fields: { ...creation.fields, Title: "Другой" } }]).results[0]
      .status,
    "conflict",
  );
  grid.push([...grid.at(-1)]);
  assert.equal(run("save", [creation]).results[0].status, "conflict");
  assert.equal(run("list").problems.length, 2);
  assert.equal(grid.length, 7);
});

test("bulk actions keep writes, invalid rows and failed rows independent", () => {
  const { grid, run, rows, unavailableRows } = fixture();
  grid.push(["invalid", "Заголовок", "Описание", "Омск", "2000"]);
  grid.push(["unavailable", "Заголовок", "Описание", "Омск", "2000", "", "Предложение услуг"]);
  unavailableRows.add(7);
  const edits = rows().map(({ feedId, revision }) => ({
    feedId,
    revision,
    fields: { Price: "3000" },
  }));
  const { results } = run("save", edits);
  assert.deepEqual(
    results.map((result) => result.status),
    ["pending", "validation", "write_failed"],
  );
  assert.deepEqual(
    grid.slice(4).map((x) => x[4]),
    ["3000", "2000", "2000"],
  );
  assert.deepEqual(rows()[1].missing, ["Category"]);
});

test("authoritative evidence has to identify the exact published revision", () => {
  const { run, grid, rows } = fixture();
  const row = rows()[0];
  const report = new Map([
    [
      "existing",
      {
        rowRevision: row.revision,
        avitoId: "123456789",
        result: "applied",
      },
    ],
  ]);
  assert.deepEqual(
    run("list", undefined, report).rows.map((x) => [x.avitoId, x.status]),
    [["123456789", "applied"]],
  );
  grid[4][1] = "Изменение после загрузки";
  assert.equal(run("list", undefined, report).rows[0].status, "pending");
  assert.equal(run("list", undefined, report).rows[0].avitoId, "123456789");
  report.set("existing", {
    result: "rejected",
    rowRevision: rows()[0].revision,
    reason: "Отклонён заголовок",
  });
  assert.equal(run("list", undefined, report).rows[0].message, "Отклонён заголовок");
});

test("preview API is disabled by default and authenticates same-origin writes", async () => {
  const base = "https://example.net/api/demo/ad-sheet";
  const secret = "demo-test";
  const env = {
    DEMO_PASSWORD_SHA256: createHash("sha256").update(secret).digest("hex"),
    AD_SHEET_TEST_SECRET: "fixture-token",
    AD_SHEET_TEST_URL: "https://script.google.com/macros/s/synthetic/exec",
  };
  const signed = { "x-demo-password": secret };
  assert.equal((await adSheetSync(new Request(base), {})).status, 404);
  assert.equal((await adSheetSync(new Request(base), env)).status, 401);
  assert.equal(
    (await adSheetSync(new Request(base, { method: "POST", headers: signed }), env)).status,
    403,
  );
  const fakeFetch = mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), env.AD_SHEET_TEST_URL);
    assert.deepEqual(JSON.parse(init.body), { action: "list", token: env.AD_SHEET_TEST_SECRET });
    return Response.json({ rows: [] });
  });
  try {
    const response = await adSheetSync(new Request(base, { headers: signed }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rows: [] });
  } finally {
    fakeFetch.mock.restore();
  }
});
