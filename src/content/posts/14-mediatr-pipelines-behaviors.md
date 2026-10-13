---
title: "MediatR Pipelines and Behaviours Without the Magic Tax"
slug: "mediatr-pipelines-behaviors"
excerpt: "MediatR pipeline behaviours are powerful and easy to misorder. Understand IPipelineBehavior, registration order and where cross-cutting concerns leak."
category: "Architecture"
tags: ["mediatr", "cqrs", "pipeline"]
date: "2026-07-26"
level: "Advanced"
author: "Riad Hossain"
---

A pipeline behaviour is the cleanest way to bolt cross-cutting concerns onto request handling, and the easiest way to ship a security hole. Behaviours wrap every request that passes through the mediator, in the order you registered them, with no compiler help. Register a validation behaviour before an authorization behaviour and you have just let an unauthenticated caller drive your validation logic, your logging and your database lookups before anyone checked who they are. The mechanism is worth understanding before it bites.

## How the delegate pipeline is built

MediatR resolves `IPipelineBehavior<TRequest, TResponse>` implementations for the concrete request type and folds them around the handler. Each behaviour receives the next delegate in the chain, so the first registered behaviour is the outermost wrapper. That means registration order is execution order, and there is no attribute that reorders it for you.

```csharp
public sealed class LoggingBehaviour<TRequest, TResponse>
    : IPipelineBehavior<TRequest, TResponse> where TRequest : notnull
{
    private readonly ILogger<LoggingBehaviour<TRequest, TResponse>> _logger;

    public LoggingBehaviour(ILogger<LoggingBehaviour<TRequest, TResponse>> logger)
        => _logger = logger;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var name = typeof(TRequest).Name;
        var started = Stopwatch.GetTimestamp();
        var response = await next();
        _logger.LogInformation("{Request} took {Elapsed}ms",
            name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        return response;
    }
}
```

Registration is `services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehaviour<,>))`, and the order of those calls is the order of the onion.

### Open generics and constraint traps

Registering an open generic behaviour means it runs for every request, including ones you forgot about. A behaviour that assumes every request has a `TenantId` property will throw on the first query that does not. Constrain behaviours with marker interfaces — `where TRequest : IAuthorisedRequest` — so the concern applies only where it is meaningful.

## Behaviours that earn their place, and their pitfalls

- Validation: run early, reject before the handler touches the database.
- Authorization: must run before validation to avoid leaking the existence of a resource.
- Logging and timing: wrap the whole chain, but never log request bodies that may contain personal data.
- Transactions: open around the handler; a behaviour spanning a streaming response holds a connection.
- Caching: only meaningful for queries, and dangerous if the cache key omits the tenant.

Order the chain with the cheap, must-happen-early concerns outermost and the concerns that must observe the final result innermost. Concretely: authorization first, then validation, then the transaction, then logging, then caching as the innermost wrapper for queries. Reverse authorization and logging and your logs record anonymous callers; reverse validation and the transaction and a rejected request still opened a database transaction. Write that intended order down in the composition root, because nothing else records it.

## The trade-off — explicitness versus reach

The tax of behaviours is invisible control flow. A handler that looks like two lines actually runs inside five wrappers, and a bug can live in any of them. The payoff is that the concern is written once instead of at every call site. Keep the number small, order them deliberately, constrain them with marker interfaces, and document the expected order in the composition root. If a concern applies to exactly one handler, do not make it a behaviour; put it in the handler where the reader can see it.
