---
title: "Idempotency in Distributed APIs: Keys, Stores and Replays"
slug: "idempotency-distributed-apis"
excerpt: "Idempotency keys let a client name a request so retries return the first result instead of repeating the work. The store, the race and the trade-offs."
category: "Messaging & Distributed Systems"
tags: ["idempotency", "retries", "api"]
date: "2025-12-04"
level: "Advanced"
author: "Riad"
---

An API that mutates state has to decide what to do when the same request arrives twice, and it will: a client times out and retries, a load balancer replays a request, a user double-clicks. HTTP retries are not a client bug to scold, they are a property of the transport, so the server must recognise the duplicate. Idempotency keys turn an unsafe operation into a safely repeatable one by letting the client name the request, so the second attempt is matched to the first and returns its outcome instead of performing it again.

## The key is client-supplied and request-scoped

An idempotency key must come from the client, because only the client knows that two attempts carry the same intent. Generate it when the operation is first created, not on each retry, and send it in a header. The server treats the first request with a given key as authoritative: it records the key with a fingerprint of the request, executes, and stores the response. Any later request carrying the same key returns the stored response byte for byte.

```csharp
public async Task<IActionResult> Pay(
    [FromHeader(Name = "Idempotency-Key")] string key,
    PaymentRequest request)
{
    var existing = await _store.TryGetAsync(key, ct);
    if (existing is not null)
        return new ContentResult
        {
            Content = existing.Body,
            ContentType = "application/json",
        };

    var result = await _handler.HandleAsync(request, ct);
    await _store.PutAsync(key, result, ttl: TimeSpan.FromHours(24), ct);
    return Ok(result);
}
```

### Storage and the race

Store keys in a durable place shared by every instance — Postgres with a unique index on the key, or Redis with `SET key value NX PX ttl`. The unique constraint is the real defence, because two concurrent retries can both find no existing key before either writes. Insert to claim the key first, then execute; if the insert loses the race, return a conflict or wait for the winner's result. A check-then-act around an idempotency store is the same race it was meant to remove.

## Replays and side effects

A stored response is only safe if the work it represents is complete and the key covers every side effect. If the handler sends an email and then fails before the response is stored, the retry runs the handler again and sends a second email. The key lookup and the outcome must be recorded atomically with the effect, which is the transactional outbox again: the record of the key and the record of the side effect commit together. An idempotency key on the HTTP boundary without idempotency in the consumer just moves the duplicate downstream.

## The trade-off

Idempotency costs a key store, a retention policy and a fingerprint check, and it shifts work onto every client to generate and reuse a key across retries. Retention has limits, because you cannot remember keys forever, so agree a window with your clients and treat a key past its expiry as a new request. In return you get a POST that is safe to retry, which is the only way an at-least-once network can back an exactly-once intention.
