---
title: "Vertical Slice Architecture in Practice"
slug: "vertical-slice-architecture"
excerpt: "Layered solutions make every feature change touch six folders. Vertical slice architecture keeps a request, its handler and its tests together."
category: "Architecture"
tags: ["architecture", "vertical-slice", "cqrs"]
date: "2026-08-01"
level: "Advanced"
author: "Riad"
---

Layered architecture optimises for the wrong axis. It groups code by technical role — Controllers, Services, Repositories, DTOs — so that adding a single feature means editing one file in six folders and coordinating a pull request across the whole tree. The layering looks tidy in a diagram and feels hostile in a sprint. Vertical slice architecture reorganises the same code around the feature, so everything a request needs lives together and changes together.

## The slice as the unit of change

A slice is one use case end to end: the request shape, the handler, the validation, the persistence call, and the response. Slices are grouped by feature, not by layer. The organising question flips from "which layer does this belong to" to "which feature owns this behaviour". The practical consequence is that a feature change touches one folder, and deleting a feature means deleting a folder. There is no dead code left behind in a shared service because a shared service never existed.

## Feature folders with MediatR

The common .NET implementation is one folder per feature with a command or query, its handler, and its validator, dispatched by MediatR. The endpoint stays thin; the slice owns the logic.

```csharp
public sealed record CreateOrderCommand(Guid CustomerId, IReadOnlyList<OrderLine> Lines)
    : IRequest<Guid>;

public sealed class CreateOrderHandler : IRequestHandler<CreateOrderCommand, Guid>
{
    private readonly OrdersDbContext _db;
    private readonly ILogger<CreateOrderHandler> _logger;

    public CreateOrderHandler(OrdersDbContext db, ILogger<CreateOrderHandler> logger)
        => (_db, _logger) = (db, logger);

    public async Task<Guid> Handle(CreateOrderCommand request, CancellationToken ct)
    {
        var order = Order.Create(request.CustomerId, request.Lines);
        _db.Orders.Add(order);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Created order {OrderId}", order.Id);
        return order.Id;
    }
}
```

### One endpoint, one file

Keep the minimal API endpoint next to its slice so the route, the request binding and the command stay visible in one place. Do not resurrect a shared `OrderController` that aggregates unrelated endpoints.

## Shared abstractions without a god layer

The failure mode of vertical slices is the opposite of the failure mode of layering. Once everything is a slice, someone builds a `CommonService` that every slice calls, and the coupling returns through the back door. Share only genuinely cross-cutting infrastructure — the `DbContext`, a result type, a clock abstraction — and keep it boring. If two slices share logic, extract the rule into a domain type that both invoke, not into a service that orchestrates both.

## Testing a slice

- Test the handler directly with an in-memory or SQLite `DbContext`; no web host needed.
- Assert on the outcome, not on which collaborator was called.
- Keep one integration test per slice that goes through the endpoint for binding and filters.
- Delete the slice's tests when you delete the slice.

## The trade-off

Vertical slices trade uniformity for cohesion. There is no single place that lists every query, and a new engineer cannot infer the whole system from one folder. That is the point: the system's complexity now mirrors the business, and no amount of folder discipline in a layered design achieves that. Adopt slices when feature velocity is the constraint; keep layers when a small team values a predictable map over a shorter change radius.
