---
title: "Domain Events and the Transactional Outbox Pattern"
slug: "domain-events-and-outbox"
excerpt: "Publishing domain events before the transaction commits is a dual-write bug. Use a transactional outbox to keep events and state consistent."
category: "Architecture"
tags: ["domain-events", "outbox", "reliability"]
date: "2026-07-20"
level: "Advanced"
author: "Riad"
---

The bug looks like this: raising a domain event inside the entity fires the alarm, an event handler sends an email or publishes to a broker, and then the transaction rolls back because a later constraint failed. The email went out; the order was never saved. Nothing in the code is obviously wrong — the event was raised at the right moment — but you have performed two separate writes with no shared transaction, and only one of them can be rolled back.

## The dual-write problem

Writing to your database and to a message broker are two independent operations. There is no coordinator between them that is also reliable, fast and simple. Distributed transactions across a database and a broker are either unsupported or a latency disaster. So the correct answer is not to try to make the dual write atomic; it is to make it a single write. Store the intent to publish in the same transaction that stores the state change, then publish from that durable record afterwards.

The tell-tale symptom in production is a consumer processing something the database has no record of: a shipment for an order that does not exist, an email for a payment that failed. Once you see that pattern, the fix is structural rather than a retry, because no amount of redelivery repairs an event that was published for a transaction that never committed.

## Dispatching events after commit

`SaveChangesInterceptor` is the hook that makes this clean. In `SavingChangesAsync` you collect the domain events, translate each into an outbox row, and add those rows to the same `DbContext` — so they commit atomically with the entities. Only after `SaveChanges` returns successfully, in `SavedChangesAsync`, do you hand the outbox rows to a background dispatcher.

```csharp
public sealed class OutboxInterceptor : SaveChangesInterceptor
{
    private readonly IOutboxWriter _writer;
    private readonly IDomainEventCollector _collector;

    public OutboxInterceptor(IOutboxWriter writer, IDomainEventCollector collector)
        => (_writer, _collector) = (writer, collector);

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        foreach (var domainEvent in _collector.Pending(eventData.Context!))
        {
            await _writer.EnqueueAsync(domainEvent, cancellationToken);
        }
        return result;
    }
}
```

### Tables, indexes and the poison message

The outbox table needs an `Id`, the serialized payload, the event type, an `OccurredOn`, a nullable `ProcessedOn`, and an attempt count. Index on `ProcessedOn` filtered to unprocessed rows so the poller stays cheap as the table grows. Give every event a deterministic message identity and enforce a unique index on it, because delivery is at-least-once and you will see duplicates.

## Publishing reliably

A `BackgroundService` polls the outbox, publishes to the broker, and marks rows processed in a new transaction. If the publish succeeds and the mark fails, the row is redelivered; that is why consumers must be idempotent. Delete processed rows on a schedule or partition the table so it does not become a second source of truth.

## The trade-off

The outbox buys correctness at the cost of latency and operational surface. Events are no longer published synchronously inside the request; there is a small, honest delay between commit and delivery. You now own an outbox table, a poller, a retention policy and idempotency in every consumer. For events that truly do not matter if they are lost, publish directly and skip the machinery. For anything that drives money, stock or notifications, the outbox is not optional.
