// runR's frozen English exam, WRITTEN BY HAND before any runR data or result (training/README.md "runR").
// This file is only a compact transcription of the hand-written sentences and their gold readings;
// it writes training/assistant/{en11,entypo11,enslang11,enmulti11,enascii11}.jsonl,
// training/help/howto-en11.jsonl and training/planner_briefs_en11.jsonl. Run once; the outputs are frozen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q = (intent, o = {}) => ({ kind: "question", intent, person: o.person ?? null, phone: null, event: o.event ?? null, many: false, table: o.table ?? null, steps: [] });
const S = (op, o = {}) => ({ op, guest: o.guest ?? null, table: o.table ?? null, from: o.from ?? null, other: o.other ?? null, name: o.name ?? null, pax: o.pax ?? null, fromTable: o.fromTable ?? null });
const C = (...steps) => ({ kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps });
const U = () => ({ kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] });
const AY = "Ahmet Yılmaz", AD = "Ayşe Demir", ZA = "Zeynep Arslan", CO = "Can Öztürk", MK = "Mehmet Kaya", ES = "Elif Şen";

// en11: plain English, numbers and table codes written the way people write them
const en11 = [
  ["q1", "Where was Ahmet Yılmaz sitting at the Mabel Matiz show?", Q("seatAt", { person: AY, event: "mabel matiz" })],
  ["q2", "How many of our concerts did Ayşe Demir make it to?", Q("attended", { person: AD })],
  ["q3", "Has Can Öztürk ever been put at a VIP table?", Q("vipBefore", { person: CO })],
  ["q4", "Who were the no-shows at Mabel Matiz?", Q("noShow", { event: "mabel matiz" })],
  ["q5", "Which guests at the New Year gala still need a table?", Q("unassigned", { event: "gala" })],
  ["q6", "Who was sitting at table 8 at the Sezen Aksu concert?", Q("whoAtTable", { event: "sezen aksu", table: "T08" })],
  ["q7", "Which of our events drew the biggest crowd?", Q("mostPeople")],
  ["q8", "Does Elif Şen get the same table every time?", Q("sameTable", { person: ES })],
  ["c1", "Seat Can Öztürk at table 11", C(S("assign", { guest: CO, table: "T11" }))],
  ["c2", "Put Zeynep Arslan at VIP 1", C(S("assign", { guest: ZA, table: "VIP01" }))],
  ["c3", "Move Ahmet Yılmaz to t3", C(S("assign", { guest: AY, table: "T03" }))],
  ["c4", "Bring in Gülşen Keleş with 3 guests and put them at T05", C(S("addGuest", { name: "Gülşen Keleş", pax: 4 }), S("assign", { guest: "Gülşen Keleş", table: "T05" }))],
  ["c5", "Mehmet Kaya's group is now five people", C(S("setPax", { guest: MK, pax: 5 }))],
  ["c6", "Ahmet Yılmaz is VIP from now on", C(S("setVip", { guest: AY }))],
  ["c7", "Please remove Zeynep Arslan from the guest list completely", C(S("deleteGuest", { guest: ZA }))],
  ["c8", "Move the whole of table 2 over to table 10", C(S("moveTable", { table: "T10", fromTable: "T02" }))],
  ["c9", "Free up Ayşe Demir's seat but don't delete her", C(S("unassign", { guest: AD }))],
  ["c10", "Zeynep Arslan should sit wherever she sat at the Mabel Matiz concert", C(S("copySeat", { guest: ZA, from: "mabel matiz konseri" }))],
  ["c11", "Sit Mehmet Kaya beside Can Öztürk", C(S("nextTo", { guest: MK, other: "can öztürk" }))],
  ["u1", "Can you book me a taxi to the venue?", U()],
];
// entypo11: en11 typed carelessly (lower case, no apostrophes, no Turkish letters, real slips)
const entypo11 = [
  ["q1", "where was ahmet yilmaz siting at the mabel matiz show", Q("seatAt", { person: "ahmet yilmaz", event: "mabel matiz" })],
  ["q2", "how many of our concerts did ayse demir make it too", Q("attended", { person: "ayse demir" })],
  ["q3", "has can ozturk ever been put at a vip tabel", Q("vipBefore", { person: "can ozturk" })],
  ["q4", "who were teh no shows at mabel matiz", Q("noShow", { event: "mabel matiz" })],
  ["q5", "which guests at the new year gala still need a tbale", Q("unassigned", { event: "gala" })],
  ["q6", "who was siting at table 8 at the sezen aksu concret", Q("whoAtTable", { event: "sezen aksu", table: "T08" })],
  ["q7", "which of our events drew teh biggest crowd", Q("mostPeople")],
  ["q8", "does elif sen get the same table evrey time", Q("sameTable", { person: "elif sen" })],
  ["c1", "seat can ozturk at tabel 11", C(S("assign", { guest: "can ozturk", table: "T11" }))],
  ["c2", "put zeynep arslan at vip 1", C(S("assign", { guest: "zeynep arslan", table: "VIP01" }))],
  ["c3", "move ahmet yilmaz to t3", C(S("assign", { guest: "ahmet yilmaz", table: "T03" }))],
  ["c4", "bring in gulsen keles with 3 guests and put them at t05", C(S("addGuest", { name: "gulsen keles", pax: 4 }), S("assign", { guest: "gulsen keles", table: "T05" }))],
  ["c5", "mehmet kayas group is now five poeple", C(S("setPax", { guest: "mehmet kaya", pax: 5 }))],
  ["c6", "ahmet yilmaz is vip form now on", C(S("setVip", { guest: "ahmet yilmaz" }))],
  ["c7", "plese remove zeynep arslan from the guest list completly", C(S("deleteGuest", { guest: "zeynep arslan" }))],
  ["c8", "move the whole of table 2 over to tabel 10", C(S("moveTable", { table: "T10", fromTable: "T02" }))],
  ["c9", "free up ayse demirs seat but dont delete her", C(S("unassign", { guest: "ayse demir" }))],
  ["c10", "zeynep arslan should sit wherevr she sat at the mabel matiz concert", C(S("copySeat", { guest: "zeynep arslan", from: "mabel matiz konseri" }))],
  ["c11", "sit mehmet kaya besdie can ozturk", C(S("nextTo", { guest: "mehmet kaya", other: "can ozturk" }))],
  ["u1", "can you book me a taxi to teh venue", U()],
];
// enslang11: chat-style English — short forms, slang, symbols (@, ->, w/, +2, 2 for "to")
const enslang11 = [
  ["q1", "yo where'd elif şen sit at tarkan", Q("seatAt", { person: "elif şen", event: "tarkan" })],
  ["q2", "how many shows has mehmet kaya been 2", Q("attended", { person: "mehmet kaya" })],
  ["q3", "any no shows at sezen aksu?", Q("noShow", { event: "sezen aksu" })],
  ["q4", "who's still w/o a table at the gala", Q("unassigned", { event: "gala" })],
  ["q5", "who sat @ T12 at mabel matiz", Q("whoAtTable", { event: "mabel matiz", table: "T12" })],
  ["q6", "ppl count at tarkan?", Q("eventCount", { event: "tarkan" })],
  ["q7", "zeynep arslan ever been vip?", Q("vipBefore", { person: "zeynep arslan" })],
  ["c1", "pls move can öztürk to t09 asap", C(S("assign", { guest: "can öztürk", table: "T09" }))],
  ["c2", "stick ahmet yılmaz @ vip01 thx", C(S("assign", { guest: "ahmet yılmaz", table: "VIP01" }))],
  ["c3", "ayşe demir -> T04", C(S("assign", { guest: "ayşe demir", table: "T04" }))],
  ["c4", "add oğuzhan erbil +2 n seat em at t06", C(S("addGuest", { name: "oğuzhan erbil", pax: 3 }), S("assign", { guest: "oğuzhan erbil", table: "T06" }))],
  ["c5", "new guest: seçil yüksel, party of 2", C(S("addGuest", { name: "seçil yüksel", pax: 2 }))],
  ["c6", "mehmet kaya's comin w/ 3 ppl total", C(S("setPax", { guest: "mehmet kaya", pax: 3 }))],
  ["c7", "vip zeynep arslan pls", C(S("setVip", { guest: "zeynep arslan" }))],
  ["c8", "kick can öztürk off the list", C(S("deleteGuest", { guest: "can öztürk" }))],
  ["c9", "unseat ayşe demir, keep her tho", C(S("unassign", { guest: "ayşe demir" }))],
  ["c10", "everyone @ t07 -> t12", C(S("moveTable", { table: "T12", fromTable: "T07" }))],
  ["c11", "put ahmet yılmaz next 2 ayşe demir", C(S("nextTo", { guest: "ahmet yılmaz", other: "ayşe demir" }))],
  ["u1", "lol ur funny", U()],
  ["u2", "wanna grab lunch?", U()],
];
// enmulti11: 2–3 jobs in one sentence, long questions wrapped in clauses
const enmulti11 = [
  ["m1", "Seat Ahmet Yılmaz at T05, then put Zeynep Arslan at the same table", C(S("assign", { guest: AY, table: "T05" }), S("assign", { guest: ZA, table: "T05" }))],
  ["m2", "First make Can Öztürk VIP, then move him to VIP01", C(S("setVip", { guest: CO }), S("assign", { guest: CO, table: "VIP01" }))],
  ["m3", "Take Ayşe Demir off T07 and seat Mehmet Kaya there instead", C(S("unassign", { guest: AD }), S("assign", { guest: MK, table: "T07" }))],
  ["m4", "Delete Can Öztürk and add Şükrü Öncel in his place at T02", C(S("deleteGuest", { guest: CO }), S("addGuest", { name: "Şükrü Öncel", pax: 1, table: "T02" }))],
  ["m5", "Change Mehmet Kaya's party from 2 to 4 and mark him VIP", C(S("setPax", { guest: MK, pax: 4 }), S("setVip", { guest: MK }))],
  ["m6", "Add İlknur Tunalı and her husband to T09, then move Can Öztürk to the same table", C(S("addGuest", { name: "İlknur Tunalı", pax: 2, table: "T09" }), S("assign", { guest: CO, table: "T09" }))],
  ["m7", "Don't seat Zeynep Arslan next to Ayşe Demir; put her at T10 instead", C(S("assign", { guest: ZA, table: "T10" }))],
  ["m8", "Move Ahmet Yılmaz to T01 and Mehmet Kaya to T01 too", C(S("assign", { guest: AY, table: "T01" }), S("assign", { guest: MK, table: "T01" }))],
  ["m9", "Add Tuncay Akbaş and Nilüfer Dağlı, both at T11", C(S("addGuest", { name: "Tuncay Akbaş", pax: 1, table: "T11" }), S("addGuest", { name: "Nilüfer Dağlı", pax: 1, table: "T11" }))],
  ["m10", "Unseat Can Öztürk, then move everyone from T07 to T02", C(S("unassign", { guest: CO }), S("moveTable", { table: "T02", fromTable: "T07" }))],
  ["m11", "Set Ahmet Yılmaz to 2 people and seat him at T06; if he's not on the list ask me first", C(S("setPax", { guest: AY, pax: 2 }), S("assign", { guest: AY, table: "T06" }))],
  ["m12", "Give Zeynep Arslan her Mabel Matiz seat, then make her VIP", C(S("copySeat", { guest: ZA, from: "mabel matiz" }), S("setVip", { guest: ZA }))],
  ["m13", "Remove Ayşe Demir from her table, and after that delete Can Öztürk", C(S("unassign", { guest: AD }), S("deleteGuest", { guest: CO }))],
  ["m14", "Put Haluk Yeşil on the list with his wife and seat Ahmet Yılmaz at T08", C(S("addGuest", { name: "Haluk Yeşil", pax: 2 }), S("assign", { guest: AY, table: "T08" }))],
  ["m15", "First seat Zeynep Arslan at T03, then add Kıvılcım Uslu to that same table, and finally make Ahmet Yılmaz VIP", C(S("assign", { guest: ZA, table: "T03" }), S("addGuest", { name: "Kıvılcım Uslu", pax: 1, table: "T03" }), S("setVip", { guest: AY }))],
  ["q1", "Quick one before the briefing: where did Mehmet Kaya sit at the Sezen Aksu concert, I need it for the report", Q("seatAt", { person: MK, event: "sezen aksu" })],
  ["q2", "My manager is asking and I can't remember: how many people actually came to the Tarkan concert?", Q("eventCount", { event: "tarkan" })],
  ["q3", "Before I print the door list, who is still without a table at the gala?", Q("unassigned", { event: "gala" })],
  ["q4", "Just double-checking for the client: has Ahmet Yılmaz ever sat at a VIP table?", Q("vipBefore", { person: AY })],
  ["u1", "Before we start, can you order flowers for the stage and then call the caterer?", U()],
];
// enascii11: Turkish names typed without Turkish letters; numbers as words and digits; table codes in many shapes
const enascii11 = [
  ["a1", "Where did Ayse Demir sit at the Tarkan concert?", Q("seatAt", { person: "Ayse Demir", event: "tarkan" })],
  ["a2", "How many events has Can Ozturk attended?", Q("attended", { person: "Can Ozturk" })],
  ["a3", "Did Elif Sen ever sit at a VIP table?", Q("vipBefore", { person: "Elif Sen" })],
  ["a4", "Who was at VIP01 during Mabel Matiz?", Q("whoAtTable", { event: "mabel matiz", table: "VIP01" })],
  ["a5", "Was Mehmet Kaya at the same table each time?", Q("sameTable", { person: MK })],
  ["c1", "Move Can Ozturk to T12", C(S("assign", { guest: "Can Ozturk", table: "T12" }))],
  ["c2", "Seat Ayse Demir at table 9", C(S("assign", { guest: "Ayse Demir", table: "T09" }))],
  ["c3", "Put Ahmet Yilmaz at VIP-01", C(S("assign", { guest: "Ahmet Yilmaz", table: "VIP01" }))],
  ["c4", "Add Umran Tasci to T04", C(S("addGuest", { name: "Umran Tasci", pax: 1 }), S("assign", { guest: "Umran Tasci", table: "T04" }))],
  ["c5", "Add Bulent Eroglu and 2 friends", C(S("addGuest", { name: "Bulent Eroglu", pax: 3 }))],
  ["c6", "Make Zeynep Arslan's party 6", C(S("setPax", { guest: ZA, pax: 6 }))],
  ["c7", "Set Mehmet Kaya to four people", C(S("setPax", { guest: MK, pax: 4 }))],
  ["c8", "Mark Can Ozturk as a VIP guest", C(S("setVip", { guest: "Can Ozturk" }))],
  ["c9", "Unseat Ayse Demir but keep her record", C(S("unassign", { guest: "Ayse Demir" }))],
  ["c10", "Delete Ahmet Yilmaz from the guest list", C(S("deleteGuest", { guest: "Ahmet Yilmaz" }))],
  ["c11", "Seat Zeynep Arslan next to Can Ozturk", C(S("nextTo", { guest: ZA, other: "can ozturk" }))],
  ["c12", "Move everybody at table 7 to table 1", C(S("moveTable", { table: "T01", fromTable: "T07" }))],
  ["c13", "Put Mehmet Kaya at T 10", C(S("assign", { guest: MK, table: "T10" }))],
  ["c14", "Ahmet Yilmaz is coming with his wife and 2 kids", C(S("setPax", { guest: "Ahmet Yilmaz", pax: 4 }))],
  ["c15", "Give Ahmet Yilmaz the table he had at Sezen Aksu", C(S("copySeat", { guest: "Ahmet Yilmaz", from: "sezen aksu" }))],
  ["u1", "What is 15 times 12?", U()],
];
// help: "how do I …" in English, typed loosely; gold = the help topic id (src/help-topics.js)
const help = [
  ["event.create", "how do i make a new event"], ["event.copyLayout", "how can I reuse the last event's layout for a new one"],
  ["event.duplicate", "how do i copy an event with all the guests"], ["event.delete", "how to delete an event pls"],
  ["plan.upload", "where do I upload the floor plan pdf"], ["plan.read", "how do I get it to find the tables on the plan"],
  ["plan.review", "the plan reading got a table wrong, how do i fix it"], ["table.add", "how do i add a table by hand"],
  ["table.capacity", "how can i change how many seats a table has"], ["table.number", "how do I renumber a table"],
  ["guest.import", "how do i import guests from excel"], ["guest.pax", "what does +3 mean next to a name"],
  ["guest.vip", "how do i make someone vip"], ["seat.assign", "how do i seat a guest at a table"],
  ["seat.unassign", "how do I take a guest off a table without deleting them"], ["live.checkin", "how do i check ppl in at the door"],
  ["live.noshow", "how do i mark a no show"], ["report.excel", "how do I export the table plan to excel"],
  ["backup.export", "how do i make a backup"], ["undo", "how do I undo my last change"],
];
// English planner briefs; `want` = every field the brief states (planner_brief_eval.py)
const briefs = [
  ["Gala dinner for 400 guests, 40 round tables of 10", { pax: 400, event: "gala", table_kind: "round", table_count: 40, seats_per_table: 10 }],
  ["Wedding, 250 people, round tables 180 cm, 10 per table", { pax: 250, event: "wedding", table_kind: "round", table_diam_cm: 180, seats_per_table: 10 }],
  ["Training session for 60 people, classroom layout, the room is 12 by 15 meters", { pax: 60, event: "classroom", room_w_m: 12, room_l_m: 15 }],
  ["Cocktail party, 300 pax, 30 bistro tables", { pax: 300, event: "cocktail", table_kind: "bistro", table_count: 30 }],
  ["Company dinner for 180, rectangular tables 200x80, 8 seats each", { pax: 180, event: "banquet", table_kind: "rect", table_len_cm: 200, table_wid_cm: 80, seats_per_table: 8 }],
  ["Board meeting, 14 people, one table", { pax: 14, event: "boardroom", table_count: 1 }],
  ["Theatre seating for 500 in a 600 square meter hall", { pax: 500, event: "theatre", area_m2: 600 }],
  ["840 guests, 100 tables spread evenly, fill the rest with 2-seat bistros", { pax: 840, table_count: 100, extra_kind: "bistro", extra_seats: 2 }],
  ["U-shape setup for 30 people, chairs 45 by 50 cm", { pax: 30, event: "u_shape", chair_w_cm: 45, chair_d_cm: 50 }],
  ["Engagement party for 120, square tables, 6 a table", { pax: 120, event: "wedding", table_kind: "square", seats_per_table: 6 }],
  ["Banquet, 1,200 people, 120 rounds of 10", { pax: 1200, event: "banquet", table_kind: "round", table_count: 120, seats_per_table: 10 }],
  ["Gala for two hundred and fifty guests in a 30 x 40 m ballroom", { pax: 250, event: "gala", room_w_m: 30, room_l_m: 40 }],
  ["Product launch, 200 people standing, cocktail style, 20 high tables", { pax: 200, event: "cocktail", table_kind: "bistro", table_count: 20 }],
  ["Birthday dinner for 45 people, 5 round tables", { pax: 45, event: "banquet", table_kind: "round", table_count: 5 }],
  ["Conference, 350 seats, theatre style", { pax: 350, event: "theatre" }],
  ["Workshop for 24, room 8 m by 10 m", { pax: 24, event: "classroom", room_w_m: 8, room_l_m: 10 }],
  ["Wedding for 600 guests, 60 round tables of ten, 150 cm", { pax: 600, event: "wedding", table_kind: "round", table_count: 60, seats_per_table: 10, table_diam_cm: 150 }],
  ["Gala, 90 square meters, 70 people, Ø160 round tables", { pax: 70, event: "gala", area_m2: 90, table_kind: "round", table_diam_cm: 160 }],
  ["Dinner for 96 at 12 square tables of 8", { pax: 96, event: "banquet", table_kind: "square", table_count: 12, seats_per_table: 8 }],
  ["Meeting, 20 people, rectangular tables 180 by 75", { pax: 20, event: "meeting", table_kind: "rect", table_len_cm: 180, table_wid_cm: 75 }],
];
const w = (f, rows) => { const p = path.join(repo, f); if (fs.existsSync(p)) throw new Error(f + " exists: frozen"); fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); };
for (const [name, set, pre] of [["en11", en11, "e11"], ["entypo11", entypo11, "et11"], ["enslang11", enslang11, "es11"], ["enmulti11", enmulti11, "em11"], ["enascii11", enascii11, "ea11"]])
  w(`training/assistant/${name}.jsonl`, set.map(([id, text, gold]) => ({ id: pre + id, text, gold })));
w("training/help/howto-en11.jsonl", help.map(([topic, q]) => ({ topic, q, lang: "en" })));
w("training/planner_briefs_en11.jsonl", briefs.map(([text, want], i) => ({ id: 1101 + i, text, want })));
console.log("written");
