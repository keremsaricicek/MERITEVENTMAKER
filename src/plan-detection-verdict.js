// WHAT KIND OF DRAWING IS THIS, AND WHAT THAT VERDICT DOES TO THE CANDIDATES.
//
// Split B, stage B-16 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved
// out of `detect()` in `src/plan-detection-classical.js` verbatim — the map's
// stated next cut after B-1/B-2, because it consumes the finished candidate
// pool and produces independent outputs.
//
// applyVerdict(input)                                                  B-16
//   IN        { chairUniform, chairs, associatedSeats, chairVenues,
//               candidates, venues, familyLostToAssociation,
//               familyLostToTextRun, familyVenue, familyFromTableSources,
//               uid, toPercentBox } — the chairs stage's family and seats,
//             the tables stage's pool, and the two constructors it shares.
//   OUT       { representation, representationSwap, familyRestoredBySwap,
//               venues } — the plan-wide verdict
//             (MeritPlanRepresentation.decide), what the swap did and did
//             not touch, and the venue list after promoted members leave it.
//   MUTATES   `candidates` IN PLACE (demoted tables leave, kept tables and
//             promoted symbols join) and, on an UNKNOWN verdict with no table,
//             the unanchored seats' own type and evidence — the same objects
//             detect() returns, exactly as before the move.
//   FAILS     never: with no MeritPlanRepresentation, the verdict is null and
//             nothing is swapped.
//   TEST OWNER `benchmarks/detector-fingerprint.mjs` (28 plans,
//             byte-identical), `symbolic-plan-detection`, the a9
//             mixed-representation fixture.
(() => {
  "use strict";

  function applyVerdict(input) {
    const { chairUniform, chairs, associatedSeats, chairVenues, candidates,
      familyLostToAssociation, familyLostToTextRun, familyVenue, familyFromTableSources,
      uid, toPercentBox } = input;
    let venues = input.venues;
    // ---- what kind of drawing is this? -----------------------------------
    // Everything above reasons about size rank: the small repeated things
    // are chairs, the bigger things they surround are tables. That holds
    // on a plan which DRAWS its furniture, and it is why this pipeline
    // works on the Golden Plan.
    //
    // A symbolic plan breaks it at the root. There, every table is the same
    // identical symbol and nothing is larger, so the reasoning inverts and
    // returns the architecture as tables and the tables as chairs. The test
    // is the chair-first path's own result: a drawn chair sits at a table,
    // so "how many of these chairs found a table" is a direct check on the
    // hypothesis that they are chairs at all. See src/plan-representation.js
    // for the measured separation — every plan that draws chairs is at or
    // above 0.95, the one that does not is at 0.077.
    let representation=null;
    let representationSwap=null;
    let familyRestoredBySwap=null;
    if(globalThis.MeritPlanRepresentation){
      representation=globalThis.MeritPlanRepresentation.decide({
        uniformFamily:chairUniform,
        uniformObjects:chairs.length,
        associatedToTable:associatedSeats,
        standalone:chairVenues.length,
        tablesFound:candidates.length,
      });
    }
    // NOTHING ANCHORS A SEATING CLAIM HERE.
    //
    // A standalone chair is a claim that somebody can sit somewhere. The
    // plan reader has just said it cannot tell what kind of drawing this
    // is -- UNKNOWN, because there were too few repeated objects for their
    // association rate to mean anything -- and not ONE table was found for
    // a chair to sit at. On an architect's shell issued before any
    // furniture exists, every filled shape is at furniture scale, so size
    // and repetition cannot separate a column from a chair; what separates
    // them is that a chair is a seat AT something, and here there is
    // nothing.
    //
    // The shapes are kept, because they are really on the drawing and an
    // operator may want to see them. What is dropped is the CLAIM about
    // what they are: they become the same uncorroborated shape the size
    // path already emits, with a basis that says so. Abstention is
    // surfaced in the product's own vocabulary rather than as a silent
    // absence -- and rather than as a confident default, which is what
    // "chair" was.
    //
    // Deliberately NOT a threshold and NOT keyed to any fixture: the
    // condition is the plan reader's own verdict plus its own recorded
    // evidence that no table exists. A drawing with even one table, or one
    // the reader could classify, is untouched.
    if(representation&&representation.kind==="UNKNOWN"&&chairVenues.length
       &&representation.evidence&&representation.evidence.tablesFound===0){
      for(const c of chairVenues){
        c.type="other";
        c.typeBasis="unanchoredSeat";
        c.shapeSuggests="block";
        c.evidence={...(c.evidence||{}),unassociated:true,
          basis:"a chair-sized shape with no table anywhere to be a seat at, on a drawing this reader could not classify"};
      }
    }
    const isPrimaryFamily=f=>(f||"primary")==="primary";
    const symbolVenues=chairVenues.filter(v=>isPrimaryFamily(v.seatFamily));
    const drawnSeatVenues=chairVenues.filter(v=>!isPrimaryFamily(v.seatFamily));
    if(representation&&representation.kind==="SYMBOLIC"&&symbolVenues.length){
      // The symbols ARE the tables. Promote them, and demote what size rank
      // called tables: on a plan whose tables are one uniform symbol, an
      // object that is not a member of that family is not a table. Both
      // counts are reported, because this swap is a large claim and has to
      // be visible rather than inferred from a changed number.
      //
      // THE SWAP ACTS ON THE FAMILY THE VERDICT WAS REACHED ABOUT, AND ON
      // NOTHING ELSE.
      //
      // It used to begin `candidates.splice(0, candidates.length)` — every
      // table on the sheet, wherever it stood. That is right while a drawing
      // speaks one language. A venue that publishes ONE sheet for a
      // symbolically-numbered ballroom and a physically-drawn terrace speaks
      // two, and a plan-wide verdict then lets the majority decide what the
      // minority is. Measured on `a9-mixed-representation`: the terrace's
      // three real tables were demoted to "not a table" and its
      // twenty-four real chairs re-read as tables, because of what was drawn
      // in a different room.
      //
      // The scope is not a threshold and not a region: it is the argument's
      // own subject. "These repeated marks sit at nothing, so they are not
      // chairs" is a statement about the PRIMARY uniform family and the
      // tables size rank proposed out of it. A separately admitted seat
      // family earned its place on its OWN adjacency evidence — most of its
      // members sitting against a table surface — which is the very evidence
      // this verdict says the primary family lacks. Neither it nor the
      // tables it seats was ever part of the claim, so neither is touched.
      //
      // On a plan with one vocabulary there are no such families and this
      // reduces, object for object, to what it did before: measured
      // identical on ORNEK, whose symbols are the only family on the sheet.
      const drawnSeatAnchored=c=>Array.isArray(c.seatFamilies)
        &&c.seatFamilies.some(f=>!isPrimaryFamily(f));
      const keptTables=candidates.filter(drawnSeatAnchored);
      const demoted=candidates.filter(c=>!drawnSeatAnchored(c));
      candidates.length=0;
      for(const c of demoted){
        c.kind="venue";
        c.type="other";
        c.selected=false;
        c.chairDetections=[];
        c.representationDemoted=true;
      }
      // ---- family members that took an exit only a chair can take --------
      //
      // Two routes remove a member of the uniform family before it ever
      // becomes an object. Both are correct on a plan that draws chairs, and
      // both delete tables here, for the same reason the OCR text-suppression
      // bug did: the exemption that makes them safe is unavailable by
      // construction on a plan whose tables are numbered symbols.
      //
      //   ASSOCIATION — the member was counted as a seat of a table proposal.
      //   Every one of those proposals has just been demoted two lines above,
      //   so the seat relationship no longer stands: its table is not a table.
      //   The pipeline already re-homes chairs whose table the fragment filter
      //   deleted ("re-seat the chairs whose table did not survive"); the swap
      //   deletes tables too and never did. Measured on ORNEK: 11 members
      //   exit here, 10 of them annotated tables.
      //
      //   TEXT RUN — the member was read as a printed glyph. That test's own
      //   discriminator is "this run sits at least 2 mark-widths from the
      //   nearest DETECTED table", which is what separates a caption from a
      //   row of seats. When the marks ARE the tables the quantity is
      //   degenerate, and measured on ORNEK the population straddles the
      //   threshold with no separation to find — min 0.62, median 1.97, max
      //   5.46 against a threshold of 2.0 — so 11 of 11 flagged marks are
      //   annotated tables and none is text. ORNEK is also the only plan in
      //   the whole benchmark set that reaches this code at all: the Golden
      //   Plan and all eight adversarial fixtures consider zero runs, because
      //   their seats are associated and only unassociated marks are eligible.
      //
      // Restoring them changes no input to the representation decision, which
      // was already taken above on the association rate as measured. It
      // changes what happens once that decision says these marks are tables.
      //
      // Both exits are filtered to the primary family for the reason the
      // first bullet gives: the restoration is justified by "its table has
      // just been demoted". A member of a second seat family whose table was
      // KEPT is still a seat of that table, and restoring it would unseat a
      // real guest's chair to make it a table of its own.
      const exitedPrimary=ch=>isPrimaryFamily(ch.chairFamily);
      const exited=[...familyLostToAssociation.filter(exitedPrimary),
        ...familyLostToTextRun.filter(exitedPrimary)];
      const restored=exited.map(familyVenue);
      // ...and the other half of the family, which never came through the
      // chair sources at all because it is drawn in solid ink. See the
      // measured membership test where familyFromTableSources is built.
      const alreadyHere=[...symbolVenues,...drawnSeatVenues,...restored];
      const overlapsExisting=c=>alreadyHere.some(v=>{
        const ix=Math.max(0,Math.min(c.x+c.w,v.x+v.w)-Math.max(c.x,v.x));
        const iy=Math.max(0,Math.min(c.y+c.h,v.y+v.h)-Math.max(c.y,v.y));
        return ix*iy>0;
      });
      const otherPolarity=familyFromTableSources
        .map(comp=>{const o=comp.shape?.obb||{cx:comp.x+comp.w/2,cy:comp.y+comp.h/2,w:comp.w,h:comp.h,rotation:comp.pcaRotation||0};
          return{id:uid("candidate"),kind:"venue",type:"chair",...toPercentBox(o),rotation:o.rotation,
            confidence:.5,status:"unreviewed",selected:false,chairDetections:[],
            evidence:{geometry:Number(Math.min(.95,comp.fill??.5).toFixed(2)),chairs:1,
              repetition:chairs.length,source:comp.source||"tone",unassociated:true}};})
        .filter(c=>!overlapsExisting(c));
      familyRestoredBySwap={fromAssociation:familyLostToAssociation.filter(exitedPrimary).length,
        fromTextRun:familyLostToTextRun.filter(exitedPrimary).length,otherPolarity:otherPolarity.length};
      const promoted=[...symbolVenues,...restored,...otherPolarity].map(c=>{
        c.kind="table";
        c.type="round";
        c.selected=true;
        c.chairDetections=[];
        // No seat count is asserted. The drawing shows no seats to count,
        // so a 0 here would read as "measured none" when the truth is
        // "this drawing does not say, by drawing". What it does say, it
        // says in print, and that is read elsewhere.
        c.seatsUnknown=true;
        // Membership of the plan's one symbol family, kept on the object so
        // later stages can tell "a table with no chairs drawn at it" from "a
        // table nothing was found at". Text suppression needs exactly that.
        c.symbolFamily=true;
        c.evidence={...(c.evidence||{}),unassociated:false,
          basis:"member of the plan's single uniform object family, on a drawing that shows no seating"};
        return c;
      });
      candidates.push(...keptTables,...promoted);
      // the promoted symbols are now tables; they must not also be venues.
      // Neither may anything else standing where a promoted member stands —
      // the solid half of the family reaches the surface filter, which turns
      // it away as "not made of table", and the column pass reads what that
      // filter turned away. A disc claimed by the family is spoken for, so it
      // cannot also be reported as a column.
      const promotedSet=new Set(promoted);
      const claimed=[...restored,...otherPolarity];
      const standsOnAPromotedMember=v=>claimed.some(c=>{
        const ix=Math.max(0,Math.min(c.x+c.w,v.x+v.w)-Math.max(c.x,v.x));
        const iy=Math.max(0,Math.min(c.y+c.h,v.y+v.h)-Math.max(c.y,v.y));
        return ix*iy>Math.min(c.w*c.h,v.w*v.h)*.5;
      });
      venues=venues.filter(v=>!promotedSet.has(v)&&!standsOnAPromotedMember(v)).concat(demoted);
      representationSwap={promotedToTable:promoted.length,demotedFromTable:demoted.length,
        restoredFromSeatOfADemotedTable:familyLostToAssociation.filter(exitedPrimary).length,
        restoredFromTextRun:familyLostToTextRun.filter(exitedPrimary).length,
        fromTheFamilysOtherPolarity:otherPolarity.length,
        // WHAT THE SWAP DID NOT TOUCH, and why. A swap that silently leaves
        // part of the sheet alone is as large a claim as one that changes it
        // all, so the exemption is counted here rather than inferred from a
        // number that did not move. Zero on a plan drawn in one vocabulary.
        keptAsDrawnFurniture:keptTables.length,
        keptDrawnSeats:drawnSeatVenues.length,
        drawnSeatFamilies:[...new Set(drawnSeatVenues.map(v=>v.seatFamily)
          .concat(keptTables.flatMap(c=>(c.seatFamilies||[]).filter(f=>!isPrimaryFamily(f)))))]};
    }
    return { representation, representationSwap, familyRestoredBySwap, venues };
  }

  globalThis.MeritPlanVerdict = { version: 1, applyVerdict };
})();
