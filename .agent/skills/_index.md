# Switchboard Skills Index

Load full skills only when resolver triggers match.

## architecture-audit

Audits Switchboard architecture against DOCTRINE.md and core invariants.

## self-serve-readiness-audit

Checks whether a real customer can go from signup to first live agent without hidden manual setup.

## route-chain-audit

Traces frontend hook → proxy → backend route → store/service.

## context-compression

Compacts long sessions into decisions, lessons, failures, and next actions.

## implementation

Enforces architecture invariants (PlatformIngress, WorkTrace, GovernanceGate, dead-letter) before and after each code step in executing-plans.
