// Voice command exam (benchmarks/voice/README.md, training/README.md "Voice 2"), WRITTEN BY HAND before any clip
// was made or heard. Each item: `text` = the sentence as written (gold reading for the F8 reader), `say` = the same
// sentence the way it is SPOKEN (fed to the speech synthesiser; the reference words for WER).
// Writes training/assistant/{voicetr,voiceen,voicedevtr,voicedeven}.jsonl. Run once; the outputs are frozen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q = (intent, o = {}) => ({ kind: "question", intent, person: o.person ?? null, phone: null, event: o.event ?? null, many: false, table: o.table ?? null, steps: [] });
const S = (op, o = {}) => ({ op, guest: o.guest ?? null, table: o.table ?? null, from: o.from ?? null, other: o.other ?? null, name: o.name ?? null, pax: o.pax ?? null, fromTable: o.fromTable ?? null });
const C = (...steps) => ({ kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps });
const U = () => ({ kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] });
const AY = "Ahmet Yılmaz", AD = "Ayşe Demir", ZA = "Zeynep Arslan", CO = "Can Öztürk", MK = "Mehmet Kaya", ES = "Elif Şen";
const voicetr = [
  ["v1", "Ahmet Yılmaz'ı T05'e oturt", "Ahmet Yılmaz'ı te beşe oturt", C(S("assign", { guest: AY, table: "T05" }))],
  ["v2", "Zeynep Arslan'ı VIP01'e al", "Zeynep Arslan'ı vip bire al", C(S("assign", { guest: ZA, table: "VIP01" }))],
  ["v3", "Mehmet Kaya'nın kişi sayısını dört yap", "Mehmet Kaya'nın kişi sayısını dört yap", C(S("setPax", { guest: MK, pax: 4 }))],
  ["v4", "Can Öztürk'ü masasından kaldır ama silme", "Can Öztürk'ü masasından kaldır ama silme", C(S("unassign", { guest: CO }))],
  ["v5", "Ayşe Demir'i VIP yap", "Ayşe Demir'i vip yap", C(S("setVip", { guest: AD }))],
  ["v6", "Listeye Serdar Ilıcak'ı ekle", "Listeye Serdar Ilıcak'ı ekle", C(S("addGuest", { name: "Serdar Ilıcak", pax: 1 }))],
  ["v7", "Nurhan Sevindik ve eşini T09'a ekle", "Nurhan Sevindik ve eşini te dokuza ekle", C(S("addGuest", { name: "Nurhan Sevindik", pax: 2 }), S("assign", { guest: "Nurhan Sevindik", table: "T09" }))],
  ["v8", "T07'deki herkesi T11'e taşı", "te yedideki herkesi te on bire taşı", C(S("moveTable", { table: "T11", fromTable: "T07" }))],
  ["v9", "Zeynep Arslan'ı Ayşe Demir'in yanına oturt", "Zeynep Arslan'ı Ayşe Demir'in yanına oturt", C(S("nextTo", { guest: ZA, other: "ayşe demir" }))],
  ["v10", "Can Öztürk'ü listeden sil", "Can Öztürk'ü listeden sil", C(S("deleteGuest", { guest: CO }))],
  ["v11", "Ahmet Yılmaz üç kişi gelecek", "Ahmet Yılmaz üç kişi gelecek", C(S("setPax", { guest: AY, pax: 3 }))],
  ["v12", "Mehmet Kaya'yı Mabel Matiz konserindeki yerine koy", "Mehmet Kaya'yı Mabel Matiz konserindeki yerine koy", C(S("copySeat", { guest: MK, from: "mabel matiz konseri" }))],
  ["v13", "Sezen Aksu konserinde kimler gelmedi", "Sezen Aksu konserinde kimler gelmedi", Q("noShow", { event: "sezen aksu konseri" })],
  ["v14", "Elif Şen Tarkan konserinde nerede oturdu", "Elif Şen Tarkan konserinde nerede oturdu", Q("seatAt", { person: ES, event: "tarkan konseri" })],
  ["v15", "Galada masası olmayanlar kimler", "Galada masası olmayanlar kimler", Q("unassigned", { event: "gala" })],
  ["v16", "Mabel Matiz konserinde VIP01'de kim oturdu", "Mabel Matiz konserinde vip birde kim oturdu", Q("whoAtTable", { event: "mabel matiz konseri", table: "VIP01" })],
  ["v17", "Ahmet Yılmaz kaç etkinliğimize geldi", "Ahmet Yılmaz kaç etkinliğimize geldi", Q("attended", { person: AY })],
  ["v18", "Zeynep Arslan'ı on iki numaralı masaya geçir", "Zeynep Arslan'ı on iki numaralı masaya geçir", C(S("assign", { guest: ZA, table: "T12" }))],
  ["v19", "Derman Ulukaya'yı iki misafiriyle listeye yaz", "Derman Ulukaya'yı iki misafiriyle listeye yaz", C(S("addGuest", { name: "Derman Ulukaya", pax: 3 }))],
  ["v20", "Önce Can Öztürk'ü T03'e al, sonra Ahmet Yılmaz'ı da aynı masaya koy", "Önce Can Öztürk'ü te üçe al, sonra Ahmet Yılmaz'ı da aynı masaya koy", C(S("assign", { guest: CO, table: "T03" }), S("assign", { guest: AY, table: "T03" }))],
  ["v21", "Ayşe Demir'i T07'den çıkar, yerine Mehmet Kaya'yı oturt", "Ayşe Demir'i te yediden çıkar, yerine Mehmet Kaya'yı oturt", C(S("unassign", { guest: AD }), S("assign", { guest: MK, table: "T07" }))],
  ["v22", "Bugün hava nasıl olacak", "Bugün hava nasıl olacak", U()],
  ["v23", "Mehmet Kaya'yı VIP yap ve VIP01'e taşı", "Mehmet Kaya'yı vip yap ve vip bire taşı", C(S("setVip", { guest: MK }), S("assign", { guest: MK, table: "VIP01" }))],
  ["v24", "Sezen Aksu konserine kaç kişi geldi", "Sezen Aksu konserine kaç kişi geldi", Q("eventCount", { event: "sezen aksu konseri" })],
];
const voiceen = [
  ["w1", "Seat Ahmet Yılmaz at T05", "Seat Ahmet Yılmaz at table five", C(S("assign", { guest: AY, table: "T05" }))],
  ["w2", "Move Zeynep Arslan to VIP01", "Move Zeynep Arslan to VIP one", C(S("assign", { guest: ZA, table: "VIP01" }))],
  ["w3", "Set Mehmet Kaya's party to 4", "Set Mehmet Kaya's party to four", C(S("setPax", { guest: MK, pax: 4 }))],
  ["w4", "Unseat Can Öztürk and keep him on the guest list", "Unseat Can Öztürk and keep him on the guest list", C(S("unassign", { guest: CO }))],
  ["w5", "Make Ayşe Demir a VIP", "Make Ayşe Demir a VIP", C(S("setVip", { guest: AD }))],
  ["w6", "Add Grace Holloway to the guest list", "Add Grace Holloway to the guest list", C(S("addGuest", { name: "Grace Holloway", pax: 1 }))],
  ["w7", "Add Ruben Castillo and his wife to T09", "Add Ruben Castillo and his wife to table nine", C(S("addGuest", { name: "Ruben Castillo", pax: 2 }), S("assign", { guest: "Ruben Castillo", table: "T09" }))],
  ["w8", "Move everyone from T07 to T11", "Move everyone from table seven to table eleven", C(S("moveTable", { table: "T11", fromTable: "T07" }))],
  ["w9", "Put Zeynep Arslan next to Ayşe Demir", "Put Zeynep Arslan next to Ayşe Demir", C(S("nextTo", { guest: ZA, other: "ayşe demir" }))],
  ["w10", "Delete Can Öztürk from the list", "Delete Can Öztürk from the list", C(S("deleteGuest", { guest: CO }))],
  ["w11", "Ahmet Yılmaz is bringing two guests", "Ahmet Yılmaz is bringing two guests", C(S("setPax", { guest: AY, pax: 3 }))],
  ["w12", "Give Mehmet Kaya the seat he had at the Mabel Matiz concert", "Give Mehmet Kaya the seat he had at the Mabel Matiz concert", C(S("copySeat", { guest: MK, from: "mabel matiz" }))],
  ["w13", "Who didn't come to the Sezen Aksu concert", "Who didn't come to the Sezen Aksu concert", Q("noShow", { event: "sezen aksu" })],
  ["w14", "Where did Elif Şen sit at the Tarkan concert", "Where did Elif Şen sit at the Tarkan concert", Q("seatAt", { person: ES, event: "tarkan" })],
  ["w15", "Which guests have no table yet at the gala", "Which guests have no table yet at the gala", Q("unassigned", { event: "gala" })],
  ["w16", "Who was at VIP01 at the Mabel Matiz concert", "Who was at VIP one at the Mabel Matiz concert", Q("whoAtTable", { event: "mabel matiz", table: "VIP01" })],
  ["w17", "How many of our events has Ahmet Yılmaz been to", "How many of our events has Ahmet Yılmaz been to", Q("attended", { person: AY })],
  ["w18", "Move Zeynep Arslan to T12", "Move Zeynep Arslan to table twelve", C(S("assign", { guest: ZA, table: "T12" }))],
  ["w19", "Add Natalie Brooks with two friends", "Add Natalie Brooks with two friends", C(S("addGuest", { name: "Natalie Brooks", pax: 3 }))],
  ["w20", "First move Can Öztürk to T03, then put Ahmet Yılmaz at the same table", "First move Can Öztürk to table three, then put Ahmet Yılmaz at the same table", C(S("assign", { guest: CO, table: "T03" }), S("assign", { guest: AY, table: "T03" }))],
  ["w21", "Remove Ayşe Demir from T07 and put Mehmet Kaya in her place", "Remove Ayşe Demir from table seven and put Mehmet Kaya in her place", C(S("unassign", { guest: AD }), S("assign", { guest: MK, table: "T07" }))],
  ["w22", "What's the weather going to be like tonight", "What's the weather going to be like tonight", U()],
  ["w23", "Make Mehmet Kaya VIP and move him to VIP01", "Make Mehmet Kaya VIP and move him to VIP one", C(S("setVip", { guest: MK }), S("assign", { guest: MK, table: "VIP01" }))],
  ["w24", "How many people came to the Sezen Aksu concert", "How many people came to the Sezen Aksu concert", Q("eventCount", { event: "sezen aksu" })],
];
// dev sets: for choosing the engine settings only (never reported as the test)
const voicedevtr = [
  ["d1", "Can Öztürk'ü T10'a geçir", "Can Öztürk'ü te ona geçir", C(S("assign", { guest: CO, table: "T10" }))],
  ["d2", "Ayşe Demir'in kişi sayısı iki olsun", "Ayşe Demir'in kişi sayısı iki olsun", C(S("setPax", { guest: AD, pax: 2 }))],
  ["d3", "Zeynep Arslan'ı VIP yap", "Zeynep Arslan'ı vip yap", C(S("setVip", { guest: ZA }))],
  ["d4", "Ayşe Demir'i masadan indir ama listede kalsın", "Ayşe Demir'i masadan indir ama listede kalsın", C(S("unassign", { guest: AD }))],
  ["d5", "Listeye Feride Akdağ'ı ekle", "Listeye Feride Akdağ'ı ekle", C(S("addGuest", { name: "Feride Akdağ", pax: 1 }))],
  ["d6", "T02'dekileri T08'e taşı", "te ikidekileri te sekize taşı", C(S("moveTable", { table: "T08", fromTable: "T02" }))],
  ["d7", "Ahmet Yılmaz'ı Can Öztürk'ün yanına koy", "Ahmet Yılmaz'ı Can Öztürk'ün yanına koy", C(S("nextTo", { guest: AY, other: "can öztürk" }))],
  ["d8", "Mabel Matiz konserine kaç kişi geldi", "Mabel Matiz konserine kaç kişi geldi", Q("eventCount", { event: "mabel matiz konseri" })],
  ["d9", "Tarkan konserinde T07'de kim vardı", "Tarkan konserinde te yedide kim vardı", Q("whoAtTable", { event: "tarkan konseri", table: "T07" })],
  ["d10", "Zeynep Arslan'ı sil", "Zeynep Arslan'ı sil", C(S("deleteGuest", { guest: ZA }))],
  ["d11", "Kerim Özbay ve eşini VIP01'e ekle", "Kerim Özbay ve eşini vip bire ekle", C(S("addGuest", { name: "Kerim Özbay", pax: 2 }), S("assign", { guest: "Kerim Özbay", table: "VIP01" }))],
  ["d12", "Saat kaç", "Saat kaç", U()],
];
const voicedeven = [
  ["x1", "Move Can Öztürk to T10", "Move Can Öztürk to table ten", C(S("assign", { guest: CO, table: "T10" }))],
  ["x2", "Set Ayşe Demir's party to 2", "Set Ayşe Demir's party to two", C(S("setPax", { guest: AD, pax: 2 }))],
  ["x3", "Zeynep Arslan should be a VIP", "Zeynep Arslan should be a VIP", C(S("setVip", { guest: ZA }))],
  ["x4", "Unseat Ayşe Demir but don't delete her", "Unseat Ayşe Demir but don't delete her", C(S("unassign", { guest: AD }))],
  ["x5", "Add Holly Fletcher to the list", "Add Holly Fletcher to the list", C(S("addGuest", { name: "Holly Fletcher", pax: 1 }))],
  ["x6", "Move all the guests at T02 to T08", "Move all the guests at table two to table eight", C(S("moveTable", { table: "T08", fromTable: "T02" }))],
  ["x7", "Seat Ahmet Yılmaz beside Can Öztürk", "Seat Ahmet Yılmaz beside Can Öztürk", C(S("nextTo", { guest: AY, other: "can öztürk" }))],
  ["x8", "How many guests came to the Mabel Matiz concert", "How many guests came to the Mabel Matiz concert", Q("eventCount", { event: "mabel matiz" })],
  ["x9", "Who sat at T07 at the Tarkan concert", "Who sat at table seven at the Tarkan concert", Q("whoAtTable", { event: "tarkan", table: "T07" })],
  ["x10", "Remove Zeynep Arslan completely", "Remove Zeynep Arslan completely", C(S("deleteGuest", { guest: ZA }))],
  ["x11", "Add Oliver Hayes and his wife to VIP01", "Add Oliver Hayes and his wife to VIP one", C(S("addGuest", { name: "Oliver Hayes", pax: 2 }), S("assign", { guest: "Oliver Hayes", table: "VIP01" }))],
  ["x12", "Can you tell me something funny", "Can you tell me something funny", U()],
];
for (const [name, set, lang] of [["voicetr", voicetr, "tr"], ["voiceen", voiceen, "en"], ["voicedevtr", voicedevtr, "tr"], ["voicedeven", voicedeven, "en"]]) {
  const p = path.join(repo, `training/assistant/${name}.jsonl`);
  if (fs.existsSync(p)) throw new Error(name + " exists: frozen");
  fs.writeFileSync(p, set.map(([id, text, say, gold]) => JSON.stringify({ id: name.replace("voice", "v") + id, text, say, lang, gold })).join("\n") + "\n");
}
console.log("written");
