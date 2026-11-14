// THE SEARCH BOX FORGIVES THE WAY PEOPLE TYPE (owner 2026-11-02: "aramada hata affı").
//
// src/guest-search.js matchRows: a query that matches nobody exactly is tried
// again forgiving one slip per word (a letter missed, added, changed or two
// swapped, on words of 5+ letters) and a Turkish case ending typed on
// ("ozturku", "kayanin"). EXACT FIRST: when anybody matches exactly, only the
// exact matches are returned — the forgiving pass never adds noise to a query
// that already works.
// Mutation proof, recorded 2026-11-02: before the change the forgiving checks fail.
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "guest-search-typos", tags: ["business", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  await import(pathToFileURL(path.join(repoRoot, "src/guest-search.js")).href);
  const S = globalThis.MeritGuestSearch.create({ formatNumber: (n) => n });
  const ev = { id: "e", lastModified: 1, tables: [{ id: "t1", number: "T05" }],
    guests: [{ id: "a", name: "Can Öztürk" }, { id: "b", name: "Mehmet Kaya" }, { id: "c", name: "Zeynep Arslan", assignment: { tableId: "t1" } }, { id: "d", name: "Kayahan Er" }] };
  const names = (q) => S.matchRows(ev, q).rows.map((r) => r.guest.name).sort();
  checks.equal(names("ozturku"), ["Can Öztürk"], "a case ending typed on still finds the guest");
  checks.equal(names("mehmet kayanin"), ["Mehmet Kaya"], "a genitive on the surname still finds the guest");
  checks.equal(names("zeynep arsaln"), ["Zeynep Arslan"], "two swapped letters still find the guest");
  checks.equal(names("zeyenp"), ["Zeynep Arslan"], "a slip in a first name still finds the guest");
  checks.equal(names("kaya"), ["Kayahan Er", "Mehmet Kaya"], "an exact query returns its exact matches only (no forgiving noise)");
  checks.equal(names("t05"), ["Zeynep Arslan"], "a table number still searches as before");
  checks.equal(names("qqqqq"), [], "nonsense finds nobody");
}
