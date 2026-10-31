/**
 * Rebuild read-models by wiping projections and replaying all immutable events.
 */

import { SetuDatabase } from './db';
import { projectEvent } from './projector';
import { Hlc } from './hlc';

export async function rebuild(db: SetuDatabase): Promise<void> {
  await db.transaction('rw', [db.patients, db.vitals, db.fieldHeads, db.conflicts, db.conflictSiblings, db.events], async () => {
    // 1. Clear projections
    await db.patients.clear();
    await db.vitals.clear();
    await db.fieldHeads.clear();
    await db.conflicts.clear();
    await db.conflictSiblings.clear();

    // 2. Fetch all events and sort by HLC
    const allEvents = await db.events.toArray();
    allEvents.sort((a, b) => {
      const ha = Hlc.parse(a.hlc);
      const hb = Hlc.parse(b.hlc);
      return ha.compareTo(hb);
    });

    // 3. Replay chronologically
    for (const ev of allEvents) {
      await projectEvent(db, ev);
    }
  });
}
