import { test } from "node:test";
import assert from "node:assert/strict";
import { demoCrm } from "./crm-demo.ts";
import { parseCrmState } from "./crm.ts";
import {
  conversationMessages,
  waitingForReply,
  searchableLead,
  updateLeadDetails,
  addOutcome,
  addFollowup,
  finishFollowup,
  reminderDue,
  acceptDeliveredMessage,
  disconnectedAdapter,
  normalizeAvitoContact,
} from "./communication.ts";
import { readDraftCache, writeDraftCache } from "./use-draft-cache.ts";
const now = Date.parse("2026-11-16T18:00:00Z"),
  igor = demoCrm.leads.find((l) => l.id === "igor")!;
test("search spans message text, city, notes, outcomes and tasks without name identity", () => {
  let state = updateLeadDetails(demoCrm, demoCrm.workspaceId, "igor", { note: "Прислать пробник" });
  state = addOutcome(
    state,
    state.workspaceId,
    "igor",
    "Нужна геометрия",
    new Date(now).toISOString(),
    "result-1",
  );
  state = addFollowup(
    state,
    state.workspaceId,
    "igor",
    "Позвонить родителю",
    "2026-11-17T10:00:00Z",
    "task-1",
  );
  const text = searchableLead(
    state,
    state.leads.find((l) => l.id === "igor")!,
  );
  for (const word of ["субботу", "екатеринбург", "пробник", "геометрия", "родителю"])
    assert(text.includes(word));
  assert(
    !searchableLead(
      state,
      state.leads.find((l) => l.id === "marina")!,
    ).includes("геометрия"),
  );
});
test("timer stops explicitly and restarts without fabricating an outgoing reply", () => {
  assert(waitingForReply(demoCrm, igor, now).waiting);
  const stopped = updateLeadDetails(demoCrm, demoCrm.workspaceId, "igor", { timerStopped: true });
  assert.equal(
    waitingForReply(
      stopped,
      stopped.leads.find((l) => l.id === "igor")!,
      now,
    ).waiting,
    false,
  );
  const resumed = updateLeadDetails(stopped, stopped.workspaceId, "igor", { timerStopped: false });
  assert(
    waitingForReply(
      resumed,
      resumed.leads.find((l) => l.id === "igor")!,
      now,
    ).waiting,
  );
  assert.equal(conversationMessages(resumed, "igor").length, 3);
});
test("unconnected send fails, while a verified test receipt updates only its own chat once", async () => {
  await assert.rejects(
    disconnectedAdapter.send({ requestId: "r", leadId: "igor", text: "text" }),
    /не отправлено/,
  );
  const message = {
    id: "provider-1",
    requestId: "r",
    leadId: "igor",
    author: "manager" as const,
    text: "Удобно в субботу?",
    at: new Date(now).toISOString(),
    quoteId: "igor-source-2",
  };
  let state = updateLeadDetails(demoCrm, demoCrm.workspaceId, "igor", {
    mode: "ai_auto",
  });
  state = acceptDeliveredMessage(state, state.workspaceId, message, "r");
  assert.equal(state.leads.find((l) => l.id === "igor")?.mode, "ai_approval");
  assert.equal(state.leads.find((l) => l.id === "marina")?.mode, undefined);
  assert(
    !waitingForReply(
      state,
      state.leads.find((l) => l.id === "igor")!,
      now,
    ).waiting,
  );
  assert(
    waitingForReply(
      state,
      state.leads.find((l) => l.id === "marina")!,
      now,
    ).waiting,
  );
  assert.equal(acceptDeliveredMessage(state, state.workspaceId, message, "r"), state);
  assert.throws(() =>
    acceptDeliveredMessage(state, state.workspaceId, { ...message, text: "other" }, "r"),
  );
  assert.throws(() => acceptDeliveredMessage(state, "foreign", message, "r"));
});
test("quotes cannot reference another lead; confirmation must match the request", () => {
  const m = {
    id: "r",
    leadId: "igor",
    author: "manager" as const,
    text: "text",
    at: new Date(now).toISOString(),
    quoteId: "marina-source-0",
  };
  assert.throws(() => acceptDeliveredMessage(demoCrm, demoCrm.workspaceId, m, "r"));
  assert.throws(() =>
    acceptDeliveredMessage(
      demoCrm,
      demoCrm.workspaceId,
      { ...m, quoteId: "igor-source-0" },
      "different",
    ),
  );
});
test("outcome and follow-up share a lead, a completed task stops the due reminder", () => {
  let state = addFollowup(
    demoCrm,
    demoCrm.workspaceId,
    "igor",
    "Напомнить",
    "2026-11-16T10:00:00Z",
    "t-1",
  );
  assert(reminderDue(state, igor, now));
  state = finishFollowup(state, state.workspaceId, "t-1", new Date(now).toISOString());
  assert(!reminderDue(state, igor, now));
  assert.throws(() =>
    addOutcome(state, "foreign", "igor", "text", new Date(now).toISOString(), "o-1"),
  );
  assert.throws(() =>
    addFollowup(state, state.workspaceId, "missing", "task", new Date(now).toISOString(), "t-2"),
  );
});
test("provider contact metadata uses real avatar and does not pass listing geography as a person's city", () => {
  const result = normalizeAvitoContact(
    {
      users: [
        { id: 1, name: "Owner" },
        {
          id: 2,
          name: "Client",
          public_user_profile: { avatar: { default: "https://example.test/avatar.jpg" } },
        },
      ],
      context: { value: { title: "Репетитор", location: { title: "Москва" } } },
    },
    "1",
  );
  assert.equal(result.avatarUrl, "https://example.test/avatar.jpg");
  assert.equal(result.city, null);
  assert.equal(result.listingCity, "Москва");
});
test("new model fields keep legacy states valid and reject cross-lead relations/duplicate message IDs", () => {
  assert.equal(parseCrmState(demoCrm).version, 1);
  assert.throws(() =>
    parseCrmState({
      ...demoCrm,
      followups: [
        { id: "t", leadId: "foreign", title: "task", dueAt: new Date(now).toISOString() },
      ],
    }),
  );
  const m = {
    id: "x",
    leadId: "igor",
    author: "client",
    text: "x",
    at: new Date(now).toISOString(),
  };
  assert.throws(() => parseCrmState({ ...demoCrm, messages: [m, m] }));
});
test("offline draft copy is immediate, lead/workspace scoped, and corrupt data is not overwritten", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  try {
    writeDraftCache("w1", "igor", "Черновик без интернета");
    assert.equal(readDraftCache("w1", "igor"), "Черновик без интернета");
    assert.equal(readDraftCache("w2", "igor"), null);
    assert.equal(readDraftCache("w1", "marina"), null);
    data.set("cantor.draft-cache.v1:w1:igor", "{broken");
    assert.throws(() => readDraftCache("w1", "igor"));
    assert.equal(data.get("cantor.draft-cache.v1:w1:igor"), "{broken");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
