/* Tests for the Fieldglass reading rules. Run: node --test core.test.js */
const test = require("node:test");
const assert = require("node:assert");
const F = require("./core.js");

const good = {
  subject: "A layered sandstone cliff face in warm daylight",
  confidence: "high",
  reads: [
    { mark: "Bands of red and buff rock run across the face", means: "Sediment was laid down in layers, then exposed" },
    { mark: "Dark grooves cut across the bands", means: "Water or wind has worn the softer bands away" }
  ],
  context: "Banded sandstone of this kind forms where sand settles in shallow water or dunes and is later cemented and lifted. Weathering eats the softer layers first, which is what draws the bands out as ledges. The colour comes from iron minerals oxidising in the rock.",
  uncertain: "I cannot tell the exact formation or the age of these beds from one photograph."
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

test("a complete reply is accepted and scores well", () => {
  const r = F.read(clone(good));
  assert.strictEqual(r.refused, false);
  assert.strictEqual(r.reading.marks.length, 2);
  assert.strictEqual(r.reading.confidence, "high");
  assert.deepStrictEqual(r.notes, []);
  assert.ok(r.score >= 85, "expected a high score, got " + r.score);
  assert.strictEqual(F.grade(r.score).tone, "good");
});

test("a reply wrapped in a markdown fence is still read", () => {
  const r = F.read("Here you go:\n```json\n" + JSON.stringify(good) + "\n```");
  assert.strictEqual(r.refused, false);
  assert.strictEqual(r.reading.subject, good.subject);
});

test("prose around the object does not break it", () => {
  const r = F.read("Sure! " + JSON.stringify(good) + " Hope that helps.");
  assert.strictEqual(r.refused, false);
});

test("text with no JSON object is refused", () => {
  const r = F.read("This looks like sandstone to me.");
  assert.strictEqual(r.refused, true);
  assert.strictEqual(r.score, 0);
  assert.match(r.notes.join(" "), /no JSON object/);
});

test("unclosed JSON is refused rather than half-read", () => {
  const r = F.read('{"subject":"a rock","reads":[{"mark":"banded"');
  assert.strictEqual(r.refused, true);
  assert.match(r.notes.join(" "), /never closed/);
});

test("fewer than two observations is refused", () => {
  const bad = clone(good);
  bad.reads = [{ mark: "It is a rock", means: "mineral" }];
  const r = F.read(bad);
  assert.strictEqual(r.refused, true);
  assert.match(r.notes.join(" "), /not an explanation/);
});

test("observations without an observation in them are dropped", () => {
  const odd = clone(good);
  odd.reads.push({ mark: "   ", means: "nothing" }, "not an object", null);
  const r = F.read(odd);
  assert.strictEqual(r.refused, false);
  assert.strictEqual(r.reading.marks.length, 2);
  assert.match(r.notes.join(" "), /3 readings had no observation/);
});

test("an unknown confidence is lowered to low, not kept", () => {
  const odd = clone(good);
  odd.confidence = "very sure";
  const r = F.read(odd);
  assert.strictEqual(r.reading.confidence, "low");
  assert.match(r.notes.join(" "), /high, medium or low/);
  assert.ok(F.score(r.reading, r.notes) < 100);
});

test("a missing uncertainty statement costs points and is noted", () => {
  const odd = clone(good);
  delete odd.uncertain;
  const r = F.read(odd);
  assert.strictEqual(r.refused, false);
  assert.strictEqual(r.reading.uncertain, "");
  assert.match(r.notes.join(" "), /cannot tell/);
  assert.ok(r.score <= 80);
});

test("extra fields are reported instead of silently kept", () => {
  const odd = clone(good);
  odd.vibe = "cool";
  odd.nsfw = false;
  const r = F.read(odd);
  assert.match(r.notes.join(" "), /do not use: vibe, nsfw/);
  assert.strictEqual(r.reading.vibe, undefined);
});

test("observations that only repeat the subject are called out", () => {
  const odd = clone(good);
  odd.subject = "Layered sandstone cliff face";
  odd.reads = [
    { mark: "A layered sandstone cliff face", means: "it is a cliff" },
    { mark: "The cliff face is layered sandstone", means: "layers" }
  ];
  const r = F.read(odd);
  assert.match(r.notes.join(" "), /only repeat the subject line/);
});

test("long text is clipped, and the mark ends cleanly", () => {
  const long = clone(good);
  long.subject = "sandstone ".repeat(60);
  long.reads[0].mark = "bands and grooves and pits and cracks ".repeat(20);
  const r = F.read(long);
  assert.ok(r.reading.subject.length <= F.LIMITS.subject);
  assert.ok(r.reading.marks[0].mark.length <= F.LIMITS.mark);
  assert.ok(/[\u2026a-z0-9)]$/.test(r.reading.marks[0].mark));
});

test("more than six observations are cut to six", () => {
  const many = clone(good);
  many.reads = [];
  for (let i = 0; i < 9; i += 1) {
    many.reads.push({ mark: "observation number " + i, means: "meaning " + i });
  }
  const r = F.read(many);
  assert.strictEqual(r.reading.marks.length, F.MAX_MARKS);
  assert.match(r.notes.join(" "), /kept the first 6 readings of 9/);
});

test("a frame is scaled to fit the cap without changing the shape", () => {
  assert.deepStrictEqual(F.frameSize(4032, 3024, 1024), { width: 1024, height: 768 });
  assert.deepStrictEqual(F.frameSize(640, 480, 1024), { width: 640, height: 480 });
  assert.deepStrictEqual(F.frameSize(0, 0, 1024), { width: 1, height: 1 });
});

test("the markdown export carries the reading and the answer", () => {
  const r = F.read(clone(good));
  const md = F.toMarkdown(r.reading, "Which way are the beds tilted?", "Down to the left.");
  assert.match(md, /^# Fieldglass reading/);
  assert.match(md, /Which way are the beds tilted\?/);
  assert.match(md, /Down to the left\./);
  assert.match(md, /Cannot tell from this photo/);
});

test("content words drop stop words and short words", () => {
  const words = F.contentWords("The rock is very much like a red sandstone band");
  assert.ok(words.indexOf("rock") !== -1);
  assert.ok(words.indexOf("sandstone") !== -1);
  assert.ok(words.indexOf("very") === -1);
  assert.ok(words.indexOf("the") === -1);
});
