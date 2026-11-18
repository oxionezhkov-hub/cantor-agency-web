import test from "node:test";
import assert from "node:assert/strict";
import { setPreviewData } from "./preview-data.ts";

test("account data replaces example seeds without local storage or fabricated ad/payment attribution", async () => {
  setPreviewData(
    {
      tutor: "Елена Добрынина",
      subject: "Русский язык",
      readAt: "2026-11-17T00:00:00Z",
      catalogAt: 1,
      chatsAt: 1,
      ads: [
        {
          id: "123",
          title: "Русский язык",
          city: "Казань",
          price: 1500,
          status: "active",
          url: "https://www.avito.ru/123",
          description: "Занятия по русскому",
        },
      ],
      daily: [
        {
          date: "2026-11-01",
          budget: 100,
          views: 20,
          contacts: 3,
          diagnostics: 1,
          sales: 1,
          updatedAt: "2026-11-02T00:00:00Z",
        },
      ],
      chats: [
        {
          id: "chat-1",
          name: "Родитель",
          city: "Казань",
          itemId: "123",
          lastAt: Date.parse("2026-11-01T09:00:00Z"),
          messages: [
            {
              id: "message-1",
              at: Date.parse("2026-11-01T09:00:00Z"),
              author: "client",
              type: "text",
              text: "Здравствуйте",
            },
          ],
        },
      ],
    },
    "test-credential",
  );
  const { ads, dialogs, windows } = await import("./data.ts");
  const { readDemoCrm, changeDemoCrm } = await import("./demo-crm-store.ts");
  const { buildAnalytics } = await import("./analytics-model.ts");
  const state = readDemoCrm();
  assert.equal(ads.length, 1);
  assert.equal(ads[0].id, "123");
  assert.equal(dialogs.length, 1);
  assert.deepEqual(windows, []);
  assert.equal(state.workspaceId, "cantor-elena-dobrynina");
  assert.equal(state.leads[0].adId, "123");
  assert.equal(state.messages?.[0].author, "client");
  assert.deepEqual(state.payments, []);
  assert.deepEqual(state.appointments, []);
  const changed = changeDemoCrm((s) => ({
    ...s,
    leads: s.leads.map((l) => (l.id === "chat-1" ? { ...l, note: "Заметка" } : l)),
  }));
  assert.equal(changed.leads[0].note, "Заметка");
  assert.equal(readDemoCrm().leads[0].note, "Заметка");
  assert.equal(typeof globalThis.localStorage, "undefined");
  const report = buildAnalytics({ from: "2026-11-01", to: "2026-11-01", crm: state });
  assert.equal(report.totals.views, 20);
  assert.equal(report.totals.contacts, 3);
  assert.equal(report.totals.spendRub, 100);
  assert.equal(report.crm?.completedAppointments, 1);
  assert.equal(report.crm?.newStudents, 1);
  assert.ok(Number.isNaN(report.byAd[0].spendRub));
  assert.ok(Number.isNaN(report.crm?.receivedRub));
});
