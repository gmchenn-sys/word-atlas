import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { ieltsEntry, ieltsMedia } from "./ielts";
import { MEDIA } from "./types";
import type { Entry } from "./types";

test("all retained examples and recording flags match the original second sentence", () => {
  let count = 0;
  for (const file of fs.readdirSync("public/atlas/entries")) {
    if (!file.endsWith(".json")) continue;
    const entries = JSON.parse(fs.readFileSync(`public/atlas/entries/${file}`, "utf8")) as Entry[];
    for (const original of entries) {
      const retained = ieltsEntry(original);
      assert.equal(original.ex.length, 2);
      assert.deepEqual(retained.ex, [original.ex[1]]);
      assert.equal(!!(retained.m & MEDIA.ex), !!(original.m & MEDIA.ex2));
      assert.equal(retained.m & MEDIA.ex2, 0);
      assert.equal(retained.m & (MEDIA.img | MEDIA.uk | MEDIA.us), original.m & (MEDIA.img | MEDIA.uk | MEDIA.us));
      assert.equal(original.ex.length, 2);
      count++;
    }
  }
  assert.equal(count, 7298);
});

test("daily sentence recording is never reused for the retained example", () => {
  assert.equal(ieltsMedia(MEDIA.ex | MEDIA.uk), MEDIA.uk);
  assert.equal(ieltsMedia(MEDIA.ex2 | MEDIA.us), MEDIA.ex | MEDIA.us);
});
