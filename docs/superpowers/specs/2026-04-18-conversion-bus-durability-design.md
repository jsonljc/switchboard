# ConversionBus Durability Fix

**Date:** 2026-04-18
**Status:** Approved
**Priority:** P0 — Production reliability

## Problem

The ConversionBus pipeline has all components built but none wired:

| Component                     | Status                                     |
| ----------------------------- | ------------------------------------------ |
| `RedisStreamConversionBus`    | Built, never instantiated                  |
| `OutboxPublisher`             | Built, never started                       |
| `PrismaOutboxStore`           | Built, never instantiated in app.ts        |
| `PrismaConversionRecordStore` | Built, never subscribed                    |
| `wireCAPIDispatcher`          | Built, never called                        |
| Calendar-book outbox write    | Working, but nothing reads it              |
| Ad-optimizer direct emit      | Emits to zero subscribers, bypasses outbox |

**Impact:** Conversion events are silently lost. The ROI dashboard has no data. The revenue feedback loop is broken.

## Design

### Event Flow (After Fix)

```
[Ad webhook] ──write──> OutboxEvent table <──poll──> OutboxPublisher
[Calendar book] ──$tx──> OutboxEvent table              |
                                                   ConversionBus (Redis Stream)
                                                        |
                                                   ConversionRecordStore
                                                   (idempotent upsert)
```

### Changes

1. **`packages/core/src/index.ts`** — Export `RedisStreamConversionBus`
2. **`apps/api/src/bootstrap/conversion-bus-bootstrap.ts`** (new) — Bootstrap module that:
   - Creates `RedisStreamConversionBus` when Redis available, falls back to `InMemoryConversionBus`
   - Instantiates `PrismaOutboxStore`
   - Instantiates `OutboxPublisher` (outbox store -> bus)
   - Subscribes `PrismaConversionRecordStore.record()` to bus
   - Returns `start()` and `stop()` handles
3. **`apps/api/src/app.ts`** — Replace inline bus creation with bootstrap module call; add OutboxPublisher stop to onClose
4. **`apps/api/src/routes/ad-optimizer.ts`** — Write to OutboxEvent table via PrismaOutboxStore instead of direct `bus.emit()`
5. **`apps/api/src/bootstrap/__tests__/conversion-bus-bootstrap.test.ts`** (new) — Tests for wiring correctness

### Key Decisions

- **Redis bus with in-memory fallback** — matches existing idempotency middleware pattern
- **Ad-optimizer uses outbox** — makes all event emission transactionally safe
- **Outbox is source of truth** — bus is delivery mechanism, outbox is canonical event store
- **No CAPI wiring yet** — requires deployment-specific env vars; leave as opt-in
- **No direct `bus.emit()` from app layer** — only OutboxPublisher should emit to bus

### What Is NOT Changing

- `ConversionBus` interface
- `OutboxPublisher` implementation
- `PrismaOutboxStore` implementation
- `PrismaConversionRecordStore` implementation
- `RedisStreamConversionBus` implementation
- Calendar-book tool's outbox write pattern
