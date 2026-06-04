# Alex North Star

> Canonicalizes the metric that was previously implicit across
> `docs/plans/2026-03-15-stage-2-outcome-lifecycle.md` and
> `docs/plans/2026-03-16-stage-3-attribution-loop.md`.
> Date: 2026-06-04.

## The metric

**Booked revenue attributable to Switchboard, per clinic, per month.**

Maturing, as Stage 3 emission sites land, into attended and paid revenue: the
funnel Alex is accountable for is `lead → qualified → booked → showed → paid`,
and the number that matters is the revenue end of it, attributed and visible.

## The north star, stated for Alex

> Every ad-dollar lead that messages the clinic becomes a booked, attended,
> paid consultation, provably attributed to Alex, and not one message along the
> way endangers the doctor's license.

Three clarifications that keep this honest:

1. **Revenue, not conversations.** Response quality, response speed, and
   qualification accuracy are input metrics. The countable output is attributed
   booked revenue per clinic per month.
2. **Compliance is a constraint, not the objective.** The license-safety
   invariant (zero HCSA/MOH-violating messages, PDPA consent always honored) is
   an absolute floor, never traded against the metric. A perfectly compliant
   agent that books nothing is worthless; a high-booking agent that risks the
   clinic director's medical registration is a liability. Maximize the metric
   subject to the invariant.
3. **Alex is the Convert stage of a larger loop.** Convert (Alex) → Attribute
   (CAPI / offline conversions) → ad platforms optimize for paying patients →
   Riley's spend gets smarter → Mira's creative is judged by proven revenue.
   Alex's number is the keystone: if it is real and visible, every other
   surface (trueROAS, taste memory, the dashboard hero) has ground truth.

## The litmus test

For any proposed work: **does it move attributed booked revenue for a clinic,
protect the license invariant, or neither?**

| Work item                               | Test result     | Priority      |
| --------------------------------------- | --------------- | ------------- |
| Meta Business Verification + App Review | Unblocks metric | Critical      |
| Compliance scanners observe → enforce   | Invariant       | Now           |
| HCSA/MOH-calibrated claim boundaries    | Invariant       | Now           |
| `attended`/`paid` CAPI emission sites   | Deepens metric  | Post-pilot    |
| Google Offline Conversions dispatcher   | Deepens metric  | Post-pilot    |
| ModelRouter wiring                      | Neither (cost)  | Opportunistic |
| Resumable mid-loop approvals            | Neither (yet)   | Deferred      |
| Retrieval / scale infrastructure        | Neither         | Not planned   |

## Source lineage

- North Star metric first stated: `docs/plans/2026-03-15-stage-2-outcome-lifecycle.md`
- Stage framing (Convert → Attribute): `docs/plans/2026-03-16-stage-3-attribution-loop.md`
- License-safety framing and sequencing: adversarial strategy review 2026-06-04,
  see `meta-bizai-strategy.md` in this directory.
