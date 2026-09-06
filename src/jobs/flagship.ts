import type { Services } from '../services';
import { MINTS } from '../config';

// The flagship agent policy. One launch per week, tied to an event, in reward
// mode, paired with ANSEM or the event's xStock. The agent itself runs on
// ClawPump; this job is the StonkFlow-side plan that the agent executes by
// calling the managed route. It is data, not autonomy: nothing here signs.

export interface FlagshipPlan {
  week: string;
  event: string;
  quoteMint: string;
  quoteSymbol: string;
  mode: 'reward';
  rewardTaxBps: '100' | '300';
  nameHint: string;
  symbolHint: string;
  rationale: string;
}

/** Hand-curated calendar for the Clawrena run. Update as events firm up. */
export const FLAGSHIP_CALENDAR: FlagshipPlan[] = [
  {
    week: '2026-09-08',
    event: 'Clawrena entry week',
    quoteMint: MINTS.ANSEM,
    quoteSymbol: 'ANSEM',
    mode: 'reward',
    rewardTaxBps: '100',
    nameHint: 'Bull Dividend',
    symbolHint: 'BULLDIV',
    rationale: 'First live launch on stream: a coin whose every trade pays holders in ANSEM.',
  },
];

export function nextPlan(now = new Date()): FlagshipPlan | null {
  const iso = now.toISOString().slice(0, 10);
  return FLAGSHIP_CALENDAR.find((p) => p.week >= iso) ?? null;
}

export async function flagshipReport(svc: Services) {
  const summary = await svc.ledger.summary();
  return { next: nextPlan(), launchesRouted: summary.launches, completed: summary.completed };
}
