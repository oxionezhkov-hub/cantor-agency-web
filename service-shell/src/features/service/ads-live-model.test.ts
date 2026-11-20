import { test } from "node:test";
import assert from "node:assert/strict";
import { liveListingFields, statusOrder } from "./ads-live-model.ts";
const ad = {
  id: "12",
  title: "Тест",
  city: "Казань",
  price: 1500,
  status: "active",
  url: "",
  description: "Текст",
  photos: ["https://example.test/image.jpg"],
  bidding: {
    mode: "manual",
    currentRub: 25,
    baseRub: null,
    minRub: null,
    maxRub: 80,
    recommendedRub: null,
    compare: null,
    scale: [],
  },
};
test("live row maps photos, city, metrics and bid from the matching ad rather than another row", () => {
  const row = liveListingFields(ad, { shows: 100, views: 10, contacts: 2, spendRub: 50 });
  assert.deepEqual(row.photos, ["/api/demo/image?adId=12&index=0"]);
  assert.equal(row.city, "Казань");
  assert.equal(row.status, "published");
  assert.equal(row.shows, 100);
  assert.equal(row.bid, 25);
  assert.equal(row.max, 80);
});
test("new row without source values stays unknown, and published ads sort before archive", () => {
  const row = liveListingFields({ ...ad, city: "", photos: undefined, bidding: undefined }, null);
  assert.deepEqual(row.photos, []);
  assert.equal(row.city, "");
  assert.ok(Number.isNaN(row.views));
  assert.ok(Number.isNaN(row.bid));
  assert.ok(statusOrder("published") < statusOrder("archived"));
});
