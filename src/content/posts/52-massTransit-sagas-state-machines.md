---
title: "Sagas and State Machines with MassTransit"
slug: "massTransit-sagas-state-machines"
excerpt: "A saga models a process that spans messages and services. MassTransit state machines make it explicit, correlated and durable across restarts."
category: "Messaging & Distributed Systems"
tags: ["saga", "masstransit", "workflow"]
date: "2025-12-10"
level: "Advanced"
author: "Riad Hossain"
---

A saga models a long-running business process that spans several messages, services and maybe days, without holding a transaction open across any of it. The platform-neutral name is a process manager; in MassTransit it is a state machine backed by a persisted saga instance. The failure it prevents is the distributed transaction you cannot have: an order that must reserve stock, take payment and schedule shipment, where any step can fail after the previous one succeeded. Instead of a coordinator that blocks, a saga reacts to events and remembers where it is.

## Why a state machine, not a service

A hand-written orchestrator accretes a switch statement on a status column and a pile of null checks. A `MassTransitStateMachine<TSaga>` inverts that: you declare states, and for each state you declare which events are handled and what they do. Illegal messages in a given state fall through to a declared behaviour instead of corrupting the row, and the state machine becomes a specification of the workflow — which is why it is reviewable and unit-testable.

```csharp
services.AddMassTransit(x =>
{
    x.AddSagaStateMachine<OrderStateMachine, OrderState>()
        .EntityFrameworkRepository(r =>
        {
            r.ExistingDbContext<AppDbContext>();
            r.UsePostgres();
        });

    x.UsingRabbitMq((ctx, cfg) =>
    {
        cfg.Host("rabbit");
        cfg.ConfigureEndpoints(ctx);
    });
});
```

### Correlating a message to a saga

Every saga message needs a correlation identifier that maps it to exactly one instance, declared with `CorrelateById` on a property such as the order id carried on the event. If an event arrives with a key that matches no instance and the state machine has no handler for it in the current state, MassTransit skips the message and, unless you route unmatched messages to an error queue, it disappears. That silent drop is the most common saga bug in production.

```csharp
public sealed class OrderStateMachine : MassTransitStateMachine<OrderState>
{
    public State AwaitingPayment { get; private set; } = null!;
    public Event<OrderSubmitted> Submitted { get; private set; } = null!;

    public OrderStateMachine()
    {
        InstanceState(x => x.CurrentState);

        Event(() => Submitted, e => e.CorrelateById(m => m.Message.OrderId));

        Initially(
            When(Submitted)
                .Then(ctx => ctx.Saga.Total = ctx.Message.Total)
                .TransitionTo(AwaitingPayment));
    }
}
```

## Persisting and recovering

The saga instance is a row in your database, so it survives restarts and outlives the request that started it — that durability is exactly what makes a saga a saga rather than a background task. Concurrency is the trap: two events for the same instance can be processed in parallel, so use optimistic concurrency on the saga row and let the loser retry, or MassTransit's message lock, but never assume serialised handling.

When a step is a request-reply, an `IRequestClient<T>` is the clean way to ask another service and continue in the same handler:

```csharp
var client = provider.GetRequiredService<IRequestClient<ReserveStock>>();
var response = await client.GetResponse<StockReserved, StockRejected>(
    new { ctx.Saga.OrderId }, ct);
```

## The trade-off

A saga adds a persisted state machine, a repository, correlation discipline and a timeout policy, and the timeouts are mandatory because a saga that waits forever for a payment is a stuck object nobody owns. In return you get a workflow you can inspect per instance, replay and test. For a two-step flow that always compensates immediately, a saga is overhead; for anything with three or more asynchronous steps, human-visible latency or a compensation you must not forget, it is the honest model.
