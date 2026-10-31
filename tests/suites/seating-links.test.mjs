// Which table does a sofa, bench or banquette serve? (R2, 2026-10-17)
//
// MeritPlanIntelGroups.buildSeatingLinks links a seating piece to a table by
// the piece's own frame — the table lies along it, across a gap of at most 0.6
// of its depth, in front of it when its front is known — never by distance
// between centres. Measured on true boxes (benchmarks/relations/README.md, R2):
// every seating group exact on 24 dev and 12 blind generated sheets from turned
// boxes, 0.705 / 0.730 from axis-aligned envelopes; MeritPlanModelFusion.
// orientPiece recovers the turn from the piece's pixels (186 / 186 and 83 / 83
// turned pieces within 5 degrees). Checked here on boxes and a canvas built in
// the test, so it is the rule that is tested, not a fixture.
//
// The seat rules ride with it: a chair ON a piece is a cushion and is not also
// counted as a chair; a banquette shared by three tables counts once for the
// room and is not divided between them; a piece whose seats are not drawn makes
// its table's seats null, never a guess; and the capacity audit asks ONE
// question, naming the piece and the tables it serves.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "seating-links",
  tags: ["intelligence", "relations"],
  timeout: 30000,
  viewport: { width: 1000, height: 700 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const out = await page.evaluate(() => {
    const G = MeritPlanIntelGroups;
    // a 1000 x 1000 sheet: percent = pixels / 10, aspect 1
    const table = (id, cx, cy, w, h, extra = {}) => ({ id, kind: "table", type: "rectangle", rotation: 0, status: "unreviewed",
      x: (cx - w / 2) / 10, y: (cy - h / 2) / 10, w: w / 10, h: h / 10, chairDetections: [], ...extra });
    const piece = (id, type, cx, cy, w, h, extra = {}) => ({ id, kind: "venue", type, rotation: 0, status: "unreviewed",
      x: (cx - w / 2) / 10, y: (cy - h / 2) / 10, w: w / 10, h: h / 10, seats: null, seatsUnknown: true, ...extra });
    const seat = (id, x, y) => ({ id, x: x / 10, y: y / 10, w: 2, h: 2 });
    const pairs = (r) => r.links.map((l) => `${l.pieceId}>${l.tableId}`).sort();
    const res = {};
    // a sofa 80 deep, its edge 15 from a coffee table's edge: serves it
    res.close = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60), piece("s1", "sofa", 500, 485, 200, 80)]));
    // the same sofa pulled 80 away (one depth): not at that table
    res.far = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60), piece("s1", "sofa", 500, 550, 200, 80)]));
    // beside the table but past its end: nothing along it
    res.pastEnd = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60), piece("s1", "sofa", 700, 485, 200, 80)]));
    // its front known and pointing away (back to the table): not linked; front toward: linked
    res.backTo = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60), piece("s1", "sofa", 500, 485, 200, 80, { facingDeg: 90 })]));
    res.facing = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60), piece("s1", "sofa", 500, 485, 200, 80, { facingDeg: -90 })]));
    // turned 30 degrees with its table, as written with a turn: linked
    const a = 30 * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
    res.turned = pairs(G.buildSeatingLinks([table("t1", 500, 500, 100, 60, { rotation: 30 }),
      piece("s1", "sofa", 500 + nx * 85, 500 + ny * 85, 200, 80, { rotation: 30 })]));
    // a banquette along three tables, five seats drawn: serves all three, counted once, not divided
    const banq = G.buildSeatingLinks([table("t1", 300, 440, 80, 80), table("t2", 425, 440, 80, 80), table("t3", 550, 440, 80, 80),
      piece("b1", "banquette", 425, 375, 375, 50, { seats: 5, seatsUnknown: false })]);
    res.banquette = { links: pairs(banq), seats: banq.groups.map((g) => g.seats), shared: banq.groups.map((g) => g.sharedPieces.join()), roomPieceSeats: banq.room.pieceSeats };
    // a bench with its seats drawn (4) and a chair at the end: the group counts 5
    const bench = G.buildSeatingLinks([table("t1", 500, 400, 240, 70, { chairDetections: [seat("c1", 640, 400)] }),
      piece("b1", "bench", 500, 455, 230, 30, { seats: 4, seatsUnknown: false })]);
    res.bench = bench.groups.map((g) => ({ seats: g.seats, chairs: g.chairIds }));
    // the same bench undivided: seats not shown — null, the piece named
    const benchU = G.buildSeatingLinks([table("t1", 500, 400, 240, 70, { chairDetections: [seat("c1", 640, 400)] }),
      piece("b1", "bench", 500, 455, 230, 30)]);
    res.benchUnknown = benchU.groups.map((g) => ({ seats: g.seats, notShown: g.seatsNotShown }));
    // a chair detected ON the sofa (a cushion read as a seat): not counted as a chair
    const cushion = G.buildSeatingLinks([table("t1", 500, 400, 100, 60, { chairDetections: [seat("c1", 470, 490), seat("c2", 500, 350)] }),
      piece("s1", "sofa", 500, 485, 200, 80, { seats: 3, seatsUnknown: false })]);
    res.cushion = { chairsOn: cushion.pieces[0].chairsOn, groupChairs: cushion.groups[0].chairIds, seats: cushion.groups[0].seats,
      room: cushion.room };
    // a table candidate standing on the sofa is the sofa read as a table, not a table it serves
    const onIt = G.buildSeatingLinks([table("t9", 500, 485, 60, 40), piece("s1", "sofa", 500, 485, 200, 80)]);
    res.tableOnPiece = { links: onIt.links.length, tablesOn: onIt.pieces[0].tablesOn };
    // rejected objects take no part
    res.rejected = pairs(G.buildSeatingLinks([table("t1", 500, 400, 100, 60, { status: "rejected" }), piece("s1", "sofa", 500, 485, 200, 80)]));
    // the capacity audit: the drawing states 12, 2 chairs counted, an undivided sofa serves t1 -> ONE question about it
    const cands = [table("t1", 500, 400, 100, 60, { chairDetections: [seat("c1", 560, 400), seat("c2", 440, 400)] }),
      piece("s1", "sofa", 500, 485, 200, 80), piece("s2", "sofa", 800, 800, 120, 60)];
    const links = G.buildSeatingLinks(cands);
    const audit = MeritPlanIntelCapacity.buildCapacityAudit("TOPLAM 12 KİŞİ", 2, cands, [], links);
    res.audit = { question: audit && audit.question && { kind: audit.question.kind, pieceId: audit.question.pieceId, tableIds: audit.question.tableIds },
      unverified: audit && audit.unverified.map((u) => `${u.id}:${u.servesTables.join("+")}`),
      groups: audit && audit.seating && audit.seating.groups.map((g) => `${g.tableId}:${g.pieceIds.join("+")}:${g.seats}`) };
    // the orientation of a turned bench, read from pixels the test draws
    const cv = document.createElement("canvas"); cv.width = 400; cv.height = 400;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 400);
    g.save(); g.translate(200, 200); g.rotate(30 * Math.PI / 180); g.fillStyle = "#ddd"; g.strokeStyle = "#222"; g.lineWidth = 2;
    g.fillRect(-90, -18, 180, 36); g.strokeRect(-90, -18, 180, 36); g.restore();
    const c30 = Math.cos(a), s30 = Math.sin(a);
    const env = { cx: 200, cy: 200, w: 180 * c30 + 36 * s30, h: 180 * s30 + 36 * c30 };
    const px = g.getImageData(0, 0, 400, 400).data;
    const fit = MeritPlanModelFusion.orientPiece(px, 400, 400, env);
    res.fit = fit && { rotation: fit.rotation, w: Math.round(fit.w), h: Math.round(fit.h) };
    // an unturned bench: no fit, the model's box stands
    g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 400); g.fillStyle = "#ddd"; g.fillRect(110, 182, 180, 36); g.strokeRect(110, 182, 180, 36);
    res.flatFit = MeritPlanModelFusion.orientPiece(g.getImageData(0, 0, 400, 400).data, 400, 400, { cx: 200, cy: 200, w: 182, h: 38 });
    return res;
  });
  checks.equal(out.close, ["s1>t1"], "a sofa a small gap from a table's edge, along it, serves it");
  checks.equal(out.far, [], "the same sofa a full depth away does not — proximity is not membership");
  checks.equal(out.pastEnd, [], "a sofa beside the table but past its end serves nothing");
  checks.equal(out.backTo, [], "a sofa whose known front points away (back to the table) is not linked");
  checks.equal(out.facing, ["s1>t1"], "the same sofa facing the table is linked");
  checks.equal(out.turned, ["s1>t1"], "a sofa turned 30 degrees with its table is measured in its own frame and linked");
  checks.equal(out.banquette.links, ["b1>t1", "b1>t2", "b1>t3"], "a banquette along three tables serves each of them");
  checks.equal(out.banquette.seats, [null, null, null], "a shared banquette's seats are not divided between its tables");
  checks.equal(out.banquette.shared, ["b1", "b1", "b1"], "each of those tables names the shared piece");
  checks.equal(out.banquette.roomPieceSeats, 5, "the banquette's five seats count once for the room");
  checks.equal(out.bench, [{ seats: 5, chairs: ["c1"] }], "a bench with four drawn seats and a chair at the end: the group seats five");
  checks.equal(out.benchUnknown, [{ seats: null, notShown: ["b1"] }], "an undivided bench: seats null, the piece named — never a guess");
  checks.equal(out.cushion.chairsOn, ["c1"], "a chair detected on the sofa is named as the sofa's cushion");
  checks.equal(out.cushion.groupChairs, ["c2"], "and is not in the table's chairs");
  checks.equal(out.cushion.seats, 4, "the group counts the sofa's three seats and the one real chair — one seat counted once");
  checks.equal([out.cushion.room.chairs, out.cushion.room.cushionsNotCounted, out.cushion.room.pieceSeats], [1, 1, 3], "the room counts it once too");
  checks.equal(out.tableOnPiece, { links: 0, tablesOn: ["t9"] }, "a table candidate on the sofa is the sofa read as a table, not a table it serves");
  checks.equal(out.rejected, [], "a rejected table serves no group");
  checks.equal(out.audit.question, { kind: "pieceSeats", pieceId: "s1", tableIds: ["t1"] }, "the stated total disagrees: ONE question, the undivided sofa that serves a table");
  checks.equal(out.audit.unverified, ["s1:t1", "s2:"], "every piece whose seats are not shown is listed with the tables it serves");
  checks.equal(out.audit.groups, ["t1:s1:null"], "the audit's seating group names the table, the piece, and seats it cannot know");
  checks.ok(out.fit && Math.abs(out.fit.rotation - 30) <= 3, `a bench turned 30 degrees: its turn read from its pixels (${JSON.stringify(out.fit)})`);
  checks.ok(out.fit && Math.abs(out.fit.w - 182) <= 8 && Math.abs(out.fit.h - 38) <= 6, "and its own length and depth, not the envelope's");
  checks.equal(out.flatFit, null, "an unturned piece: no fit, the model's box stands");
}
