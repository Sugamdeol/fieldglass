/* Fieldglass - the rules for reading a vision model's answer.
   Pure functions only: no DOM, no network, no globals. The page calls these
   before it draws anything, so a reply that does not hold together is refused
   or visibly repaired instead of being shown as fact. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FIELDGLASS = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LIMITS = {
    subject: 200,
    mark: 130,
    means: 190,
    context: 700,
    uncertain: 260,
    question: 200
  };
  var CONFIDENCE = ["high", "medium", "low"];
  var KEYS = ["subject", "confidence", "reads", "context", "uncertain"];
  var MIN_MARKS = 2;
  var MAX_MARKS = 6;
  var MIN_CONTEXT = 80;

  function clip(value, max) {
    var s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1).replace(/[\s,;:.]$/, "") + "\u2026";
  }

  function contentWords(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 3 && STOP.indexOf(w) === -1;
      });
  }

  var STOP = ("about above after again against almost along also although always among another " +
    "around because before being below between both cannot could does doing done down during " +
    "each either else enough even ever every from further have having here however into itself " +
    "just less like made make many might more most much must neither never often once only " +
    "other over same should since some such than that their them then there these they this " +
    "those through under until upon very want well were what when where whether which while " +
    "with within without would your yours").split(" ");

  /* The model is asked for one JSON object, but it may wrap it in a fence or
     add a sentence around it. Take the first balanced object in the text. */
  function parseReply(text) {
    var s = String(text == null ? "" : text).trim();
    var fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) s = fenced[1].trim();
    var start = s.indexOf("{");
    if (start === -1) return { ok: false, error: "the reply had no JSON object in it" };
    var depth = 0, inString = false, escaped = false;
    for (var i = start; i < s.length; i += 1) {
      var ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          var slice = s.slice(start, i + 1);
          try {
            var obj = JSON.parse(slice);
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
              return { ok: false, error: "the reply was not an object" };
            }
            return { ok: true, value: obj };
          } catch (e) {
            return { ok: false, error: "the reply was not valid JSON" };
          }
        }
      }
    }
    return { ok: false, error: "the reply's JSON object was never closed" };
  }

  /* Turn whatever came back into a reading the page is allowed to show.
     Returns { reading, notes, score, refused }. */
  function read(raw) {
    var notes = [];
    var parsed = parseReply(typeof raw === "string" ? raw : JSON.stringify(raw || ""));
    if (!parsed.ok) {
      return { reading: null, notes: [parsed.error], score: 0, refused: true };
    }
    var src = parsed.value;
    var unknown = Object.keys(src).filter(function (k) { return KEYS.indexOf(k) === -1; });
    if (unknown.length) {
      notes.push("the reply carried fields we do not use: " + unknown.join(", "));
    }

    var subject = clip(src.subject, LIMITS.subject);
    if (!subject) {
      return { reading: null, notes: notes.concat("no description of the subject"),
               score: 0, refused: true };
    }

    var confidence = String(src.confidence || "").toLowerCase().trim();
    if (CONFIDENCE.indexOf(confidence) === -1) {
      notes.push("confidence was not one of high, medium or low");
      confidence = "low";
    }

    var marks = [];
    var dropped = 0;
    var list = Array.isArray(src.reads) ? src.reads : [];
    list.forEach(function (item) {
      if (marks.length >= MAX_MARKS) return;
      if (!item || typeof item !== "object") { dropped += 1; return; }
      var mark = clip(item.mark, LIMITS.mark);
      var means = clip(item.means, LIMITS.means);
      if (!mark) { dropped += 1; return; }
      marks.push({ mark: mark, means: means });
    });
    if (dropped) notes.push(dropped + " reading" + (dropped === 1 ? "" : "s") + " had no observation in it and " + (dropped === 1 ? "was" : "were") + " dropped");
    if (Array.isArray(src.reads) && src.reads.length > MAX_MARKS) {
      notes.push("kept the first " + MAX_MARKS + " readings of " + src.reads.length);
    }
    if (marks.length < MIN_MARKS) {
      return {
        reading: null, refused: true, score: 0,
        notes: notes.concat("fewer than " + MIN_MARKS + " observations, which is not an explanation")
      };
    }

    var context = clip(src.context, LIMITS.context);
    if (context.length < MIN_CONTEXT) {
      notes.push("the background is too thin to be useful");
    }

    var uncertain = clip(src.uncertain, LIMITS.uncertain);
    if (!uncertain) {
      notes.push("the reply did not say what it cannot tell from this photo");
    }

    /* Does every observation just repeat the one-line subject? Then the photo
       was described once and padded out. */
    var subjectWords = contentWords(subject);
    if (subjectWords.length >= 3) {
      var restating = marks.filter(function (m) {
        var seen = contentWords(m.mark);
        if (!seen.length) return false;
        var shared = seen.filter(function (w) { return subjectWords.indexOf(w) !== -1; }).length;
        return shared / seen.length >= 0.75;
      }).length;
      if (restating >= 2) {
        notes.push(restating + " observations only repeat the subject line");
      }
    }

    var reading = {
      subject: subject,
      confidence: confidence,
      marks: marks,
      context: context,
      uncertain: uncertain
    };
    return { reading: reading, notes: notes, score: score(reading, notes), refused: false };
  }

  /* 100 minus what is missing. A number the reader can argue with beats a
     confident-looking card built on a thin reply. */
  function score(reading, notes) {
    var s = 100;
    s -= 10 * (notes || []).length;
    if (reading.confidence === "low") s -= 12;
    if (reading.confidence === "medium") s -= 4;
    if (reading.marks.length === 2) s -= 6;
    if (reading.context.length < MIN_CONTEXT) s -= 10;
    if (!reading.uncertain) s -= 12;
    return Math.max(0, Math.min(100, s));
  }

  function grade(n) {
    if (n >= 85) return { label: "well grounded", tone: "good" };
    if (n >= 65) return { label: "readable, with gaps", tone: "fair" };
    if (n >= 40) return { label: "thin", tone: "weak" };
    return { label: "do not trust this", tone: "bad" };
  }

  /* Size a captured frame down to what a vision model needs. Returns the
     canvas size to draw at, keeping the aspect ratio. */
  function frameSize(w, h, maxSide) {
    var cap = maxSide || 1024;
    w = Math.max(1, Math.round(w || 0));
    h = Math.max(1, Math.round(h || 0));
    var scale = Math.min(1, cap / Math.max(w, h));
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  function toMarkdown(reading, question, answer) {
    if (!reading) return "";
    var lines = ["# Fieldglass reading", "", "**Subject:** " + reading.subject,
      "**Confidence:** " + reading.confidence, "", "## What the camera shows", ""];
    reading.marks.forEach(function (m) {
      lines.push("- **" + m.mark + "** " + (m.means || ""));
    });
    lines.push("", "## Background", "", reading.context, "");
    if (reading.uncertain) lines.push("**Cannot tell from this photo:** " + reading.uncertain, "");
    if (question && answer) lines.push("## Question", "", question, "", answer, "");
    return lines.join("\n");
  }

  return {
    LIMITS: LIMITS, MIN_MARKS: MIN_MARKS, MAX_MARKS: MAX_MARKS,
    clip: clip, contentWords: contentWords, parseReply: parseReply,
    read: read, score: score, grade: grade, frameSize: frameSize,
    toMarkdown: toMarkdown
  };
});
