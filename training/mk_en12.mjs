// runR2's frozen blind English exam, WRITTEN BY HAND before any runR2 data, training or result
// (training/README.md "runR2"). Same five kinds as runR's en11 exam (which runR's result made SEEN); every
// sentence is new, written after r08y's misses were read (stated in the README), and is not a paraphrase of an
// en11 sentence. This file is only a compact transcription of the hand-written sentences and their gold readings;
// it writes training/assistant/{en12,entypo12,enslang12,enmulti12,enascii12}.jsonl. Run once; the outputs are
// frozen (it refuses to overwrite). New names (Neriman Göksu, Reşat Kınık, Berna Çağıran, Ferdi Ulusoy, Melike
// Sarıgül, Kadriye Tokgöz, Sabri Karakuş, Gönül Erkoç, Recai Bıyıklı, Güngör Bayraktutan, Şerife Koçyiğit) were
// checked absent from every data dir, every pool and every earlier test file before this was written.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q = (intent, o = {}) => ({ kind: "question", intent, person: o.person ?? null, phone: null, event: o.event ?? null, many: false, table: o.table ?? null, steps: [] });
const S = (op, o = {}) => ({ op, guest: o.guest ?? null, table: o.table ?? null, from: o.from ?? null, other: o.other ?? null, name: o.name ?? null, pax: o.pax ?? null, fromTable: o.fromTable ?? null });
const C = (...steps) => ({ kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps });
const U = () => ({ kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] });
const AY = "Ahmet Yılmaz", AD = "Ayşe Demir", ZA = "Zeynep Arslan", CO = "Can Öztürk", MK = "Mehmet Kaya";

// en12: plain English; tables and numbers written the way people write them
const en12 = [
  ["q1", "Which table did Elif Şen have at the Tarkan concert?", Q("seatAt", { person: "Elif Şen", event: "tarkan" })],
  ["q2", "How many times has Zeynep Arslan come to one of our events?", Q("attended", { person: ZA })],
  ["q3", "Was Ahmet Yılmaz ever given a VIP seat?", Q("vipBefore", { person: AY })],
  ["q4", "Who didn't turn up to the Sezen Aksu concert?", Q("noShow", { event: "sezen aksu" })],
  ["q5", "Who at the New Year gala hasn't been given a table yet?", Q("unassigned", { event: "gala" })],
  ["q6", "Who was at table 12 during the Mabel Matiz concert?", Q("whoAtTable", { event: "mabel matiz", table: "T12" })],
  ["q7", "How many guests showed up at Tarkan?", Q("eventCount", { event: "tarkan" })],
  ["q8", "Does Mehmet Kaya always end up at the same table?", Q("sameTable", { person: MK })],
  ["c1", "Ayşe Demir belongs at table 4", C(S("assign", { guest: AD, table: "T04" }))],
  ["c2", "Seat Mehmet Kaya at VIP 1", C(S("assign", { guest: MK, table: "VIP01" }))],
  ["c3", "Relocate Can Öztürk to t6", C(S("assign", { guest: CO, table: "T06" }))],
  ["c4", "Add Neriman Göksu and her two daughters, then seat them at table 9", C(S("addGuest", { name: "Neriman Göksu", pax: 3 }), S("assign", { guest: "Neriman Göksu", table: "T09" }))],
  ["c5", "Zeynep Arslan is now a party of three", C(S("setPax", { guest: ZA, pax: 3 }))],
  ["c6", "Upgrade Can Öztürk to VIP", C(S("setVip", { guest: CO }))],
  ["c7", "Take Mehmet Kaya off the guest list for good", C(S("deleteGuest", { guest: MK }))],
  ["c8", "Shift everybody sitting at table 7 to table 11", C(S("moveTable", { table: "T11", fromTable: "T07" }))],
  ["c9", "Leave Ahmet Yılmaz on the list but clear his seat", C(S("unassign", { guest: AY }))],
  ["c10", "Ahmet Yılmaz gets the seat he had at the Tarkan concert", C(S("copySeat", { guest: AY, from: "tarkan konseri" }))],
  ["c11", "Place Zeynep Arslan right next to Can Öztürk", C(S("nextTo", { guest: ZA, other: "can öztürk" }))],
  ["u1", "Can you check the weather for Saturday night?", U()],
];
// entypo12: en12 typed carelessly (lower case, no apostrophes, no Turkish letters, real slips, some in the key words)
const entypo12 = [
  ["q1", "whcih table did elif sen have at the tarkan concert", Q("seatAt", { person: "elif sen", event: "tarkan" })],
  ["q2", "how many times has zeynep arslan come to one of our evnets", Q("attended", { person: "zeynep arslan" })],
  ["q3", "was ahmet yilmaz ever givne a vip seat", Q("vipBefore", { person: "ahmet yilmaz" })],
  ["q4", "who didnt turn up to teh sezen aksu concert", Q("noShow", { event: "sezen aksu" })],
  ["q5", "who at the new year gala hasnt been given a tabel yet", Q("unassigned", { event: "gala" })],
  ["q6", "who was at tabel 12 durign the mabel matiz concert", Q("whoAtTable", { event: "mabel matiz", table: "T12" })],
  ["q7", "how many geusts showed up at tarkan", Q("eventCount", { event: "tarkan" })],
  ["q8", "does mehmet kaya allways end up at the same table", Q("sameTable", { person: "mehmet kaya" })],
  ["c1", "ayse demir belongs at tabel 4", C(S("assign", { guest: "ayse demir", table: "T04" }))],
  ["c2", "seat mehmet kaya at vip 1", C(S("assign", { guest: "mehmet kaya", table: "VIP01" }))],
  ["c3", "relocte can ozturk to t6", C(S("assign", { guest: "can ozturk", table: "T06" }))],
  ["c4", "add neriman goksu and her two daugthers then seat them at table 9", C(S("addGuest", { name: "neriman goksu", pax: 3 }), S("assign", { guest: "neriman goksu", table: "T09" }))],
  ["c5", "zeynep arslan is now a prty of three", C(S("setPax", { guest: "zeynep arslan", pax: 3 }))],
  ["c6", "upgarde can ozturk to vip", C(S("setVip", { guest: "can ozturk" }))],
  ["c7", "take mehmet kaya off the guest lsit for good", C(S("deleteGuest", { guest: "mehmet kaya" }))],
  ["c8", "shift everybody siting at table 7 to tabel 11", C(S("moveTable", { table: "T11", fromTable: "T07" }))],
  ["c9", "leave ahmet yilmaz on the list but claer his seat", C(S("unassign", { guest: "ahmet yilmaz" }))],
  ["c10", "ahmet yilmaz gets the seat he had at the tarkan concret", C(S("copySeat", { guest: "ahmet yilmaz", from: "tarkan konseri" }))],
  ["c11", "place zeynep arslan rihgt next to can ozturk", C(S("nextTo", { guest: "zeynep arslan", other: "can ozturk" }))],
  ["u1", "can you chekc the weather for saturday night", U()],
];
// enslang12: chat-style English — contractions, short forms, symbols (@, ->, w/, n, 2 for "to", 4 for "for")
const enslang12 = [
  ["q1", "where'd mehmet kaya sit @ sezen aksu", Q("seatAt", { person: "mehmet kaya", event: "sezen aksu" })],
  ["q2", "zeynep arslan's total shows w/ us?", Q("attended", { person: "zeynep arslan" })],
  ["q3", "who bailed on tarkan?", Q("noShow", { event: "tarkan" })],
  ["q4", "any1 w/o a seat @ the gala rn?", Q("unassigned", { event: "gala" })],
  ["q5", "who's @ t08 for sezen aksu", Q("whoAtTable", { event: "sezen aksu", table: "T08" })],
  ["q6", "headcount 4 mabel matiz?", Q("eventCount", { event: "mabel matiz" })],
  ["q7", "can öztürk ever been vip b4?", Q("vipBefore", { person: "can öztürk" })],
  ["c1", "yo shove mehmet kaya over 2 t10", C(S("assign", { guest: "mehmet kaya", table: "T10" }))],
  ["c2", "zeynep arslan @ t02 pls", C(S("assign", { guest: "zeynep arslan", table: "T02" }))],
  ["c3", "can öztürk -> vip 1 thx", C(S("assign", { guest: "can öztürk", table: "VIP01" }))],
  ["c4", "reşat kınık is new, he's got 2 mates, put em all @ t08", C(S("addGuest", { name: "reşat kınık", pax: 3 }), S("assign", { guest: "reşat kınık", table: "T08" }))],
  ["c5", "new 1: berna çağıran, party of 3", C(S("addGuest", { name: "berna çağıran", pax: 3 }))],
  ["c6", "ahmet yılmaz bringin his wife, 2 total", C(S("setPax", { guest: "ahmet yılmaz", pax: 2 }))],
  ["c7", "make ayşe demir vip k", C(S("setVip", { guest: "ayşe demir" }))],
  ["c8", "boot zeynep arslan off the list", C(S("deleteGuest", { guest: "zeynep arslan" }))],
  ["c9", "bump can öztürk off his table but keep him", C(S("unassign", { guest: "can öztürk" }))],
  ["c10", "all of t02 -> t09", C(S("moveTable", { table: "T09", fromTable: "T02" }))],
  ["c11", "sit mehmet kaya nxt 2 can öztürk", C(S("nextTo", { guest: "mehmet kaya", other: "can öztürk" }))],
  ["u1", "haha nice one", U()],
  ["u2", "u up?", U()],
];
// enmulti12: 2–3 jobs in one sentence, long questions wrapped in clauses
const enmulti12 = [
  ["m1", "Put Can Öztürk at T04 and then seat Ayşe Demir at that table too", C(S("assign", { guest: CO, table: "T04" }), S("assign", { guest: AD, table: "T04" }))],
  ["m2", "Mark Zeynep Arslan as VIP, after that send her to VIP01", C(S("setVip", { guest: ZA }), S("assign", { guest: ZA, table: "VIP01" }))],
  ["m3", "Pull Mehmet Kaya off T06 and hand his chair over to Ahmet Yılmaz", C(S("unassign", { guest: MK }), S("assign", { guest: AY, table: "T06" }))],
  ["m4", "Remove Ayşe Demir from the list; Ferdi Ulusoy is added at T11 in her place", C(S("deleteGuest", { guest: AD }), S("addGuest", { name: "Ferdi Ulusoy", pax: 1, table: "T11" }))],
  ["m5", "Can Öztürk's party grows from one to three, and he becomes VIP too", C(S("setPax", { guest: CO, pax: 3 }), S("setVip", { guest: CO }))],
  ["m6", "Add Melike Sarıgül and her husband at T12; Mehmet Kaya then joins the same table", C(S("addGuest", { name: "Melike Sarıgül", pax: 2, table: "T12" }), S("assign", { guest: MK, table: "T12" }))],
  ["m7", "Ahmet Yılmaz shouldn't sit beside Zeynep Arslan - seat him at T05 instead", C(S("assign", { guest: AY, table: "T05" }))],
  ["m8", "Seat Ayşe Demir at T09 and Zeynep Arslan at T09 as well", C(S("assign", { guest: AD, table: "T09" }), S("assign", { guest: ZA, table: "T09" }))],
  ["m9", "Add Kadriye Tokgöz and Sabri Karakuş, seat both of them at T03", C(S("addGuest", { name: "Kadriye Tokgöz", pax: 1, table: "T03" }), S("addGuest", { name: "Sabri Karakuş", pax: 1, table: "T03" }))],
  ["m10", "Unseat Can Öztürk; after that the whole T07 table goes to T11", C(S("unassign", { guest: CO }), S("moveTable", { table: "T11", fromTable: "T07" }))],
  ["m11", "Make Ayşe Demir 3 people and seat her at T02; check with me first if she's missing", C(S("setPax", { guest: AD, pax: 3 }), S("assign", { guest: AD, table: "T02" }))],
  ["m12", "Give Ahmet Yılmaz his seat from Sezen Aksu, then mark him VIP", C(S("copySeat", { guest: AY, from: "sezen aksu" }), S("setVip", { guest: AY }))],
  ["m13", "Free the seat Zeynep Arslan has, and after that delete Mehmet Kaya", C(S("unassign", { guest: ZA }), S("deleteGuest", { guest: MK }))],
  ["m14", "Add Gönül Erkoç plus one to the list; Can Öztürk switches to T01", C(S("addGuest", { name: "Gönül Erkoç", pax: 2 }), S("assign", { guest: CO, table: "T01" }))],
  ["m15", "Start by giving Mehmet Kaya a seat at T10, after which add Recai Bıyıklı at the same table, and last make Zeynep Arslan VIP", C(S("assign", { guest: MK, table: "T10" }), S("addGuest", { name: "Recai Bıyıklı", pax: 1, table: "T10" }), S("setVip", { guest: ZA }))],
  ["q1", "Sorry, quick one: which table did Ahmet Yılmaz have at the Mabel Matiz concert? It's for the seating report", Q("seatAt", { person: AY, event: "mabel matiz" })],
  ["q2", "The venue wants a number - what was the final turnout at the Sezen Aksu concert?", Q("eventCount", { event: "sezen aksu" })],
  ["q3", "Before the doors open, can you tell me who still has no table at the gala?", Q("unassigned", { event: "gala" })],
  ["q4", "One more thing the client asked: has Zeynep Arslan ever had a VIP table?", Q("vipBefore", { person: ZA })],
  ["u1", "After lunch, can you text the DJ and then book the photographer?", U()],
];
// enascii12: Turkish names typed without Turkish letters; numbers as words and digits; table codes in many shapes
const enascii12 = [
  ["a1", "Where did Ahmet Yilmaz sit at Mabel Matiz?", Q("seatAt", { person: "Ahmet Yilmaz", event: "mabel matiz" })],
  ["a2", "How many concerts has Mehmet Kaya been to?", Q("attended", { person: MK })],
  ["a3", "Has Zeynep Arslan ever sat at VIP?", Q("vipBefore", { person: ZA })],
  ["a4", "Who sat at T-12 at the Sezen Aksu concert?", Q("whoAtTable", { event: "sezen aksu", table: "T12" })],
  ["a5", "Has Ahmet Yilmaz had one fixed table at every event?", Q("sameTable", { person: "Ahmet Yilmaz" })],
  ["c1", "Move Ayse Demir to table eleven", C(S("assign", { guest: "Ayse Demir", table: "T11" }))],
  ["c2", "Seat Can Ozturk at T 3", C(S("assign", { guest: "Can Ozturk", table: "T03" }))],
  ["c3", "Put Mehmet Kaya at vip one", C(S("assign", { guest: MK, table: "VIP01" }))],
  ["c4", "Add Gungor Bayraktutan to table 6", C(S("addGuest", { name: "Gungor Bayraktutan", pax: 1 }), S("assign", { guest: "Gungor Bayraktutan", table: "T06" }))],
  ["c5", "Add Serife Kocyigit, who brings three friends", C(S("addGuest", { name: "Serife Kocyigit", pax: 4 }))],
  ["c6", "Change the headcount for Can Ozturk to 5", C(S("setPax", { guest: "Can Ozturk", pax: 5 }))],
  ["c7", "Set Ahmet Yilmaz to two people", C(S("setPax", { guest: "Ahmet Yilmaz", pax: 2 }))],
  ["c8", "Mark Ayse Demir as VIP", C(S("setVip", { guest: "Ayse Demir" }))],
  ["c9", "Take Zeynep Arslan off her table but keep her on the list", C(S("unassign", { guest: ZA }))],
  ["c10", "Delete Mehmet Kaya from the list", C(S("deleteGuest", { guest: MK }))],
  ["c11", "Seat Can Ozturk next to Ayse Demir", C(S("nextTo", { guest: "Can Ozturk", other: "ayse demir" }))],
  ["c12", "Move all the guests at table 2 to table 10", C(S("moveTable", { table: "T10", fromTable: "T02" }))],
  ["c13", "Put Zeynep Arslan at VIP 01", C(S("assign", { guest: ZA, table: "VIP01" }))],
  ["c14", "Can Ozturk is bringing his wife and 3 kids", C(S("setPax", { guest: "Can Ozturk", pax: 5 }))],
  ["u1", "Convert 40 dollars to lira", U()],
];
const w = (f, rows) => { const p = path.join(repo, f); if (fs.existsSync(p)) throw new Error(f + " exists: frozen"); fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); };
for (const [name, set, pre] of [["en12", en12, "e12"], ["entypo12", entypo12, "et12"], ["enslang12", enslang12, "es12"], ["enmulti12", enmulti12, "em12"], ["enascii12", enascii12, "ea12"]])
  w(`training/assistant/${name}.jsonl`, set.map(([id, text, gold]) => ({ id: pre + id, text, gold })));
console.log("written");
