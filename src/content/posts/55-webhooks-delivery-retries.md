---
title: "Designing Reliable Webhook Delivery with Retries"
slug: "webhooks-delivery-retries"
excerpt: "A webhook is a durable promise, not a fire-and-forget call. Outbox the send, retry with backoff, sign the payload and dead-letter what never lands."
category: "Messaging & Distributed Systems"
tags: ["webhooks", "delivery", "reliability"]
date: "2025-11-22"
level: "Advanced"
author: "Riad"
---

A webhook is a promise you make to every subscriber: something happened, here it is, and we will keep trying until you accept it. The internet does not honour that promise by default, so the reliability has to be built into the sender. The common failure is treating the delivery as fire-and-forget inside the request that triggered it, so a slow or dead subscriber blocks your own transaction, and a crash loses the notification with no record that it ever existed.

## Decouple the send from the trigger

Never call a subscriber's endpoint inside your request path. The correct shape is a transactional outbox sized for webhooks: when the event happens, write a delivery record in the same transaction as the state change, then let a background worker attempt delivery. The record holds the endpoint, the payload, the attempt count, the next attempt time and the last response. That row is the durable promise; the HTTP call is only an attempt against it.

```csharp
var due = await _store.ClaimDueAsync(now, batchSize: 50, ct);
foreach (var delivery in due)
{
    using var request = new HttpRequestMessage(HttpMethod.Post, delivery.Endpoint)
    {
        Content = new StringContent(delivery.Payload, Encoding.UTF8, "application/json"),
    };
    request.Headers.Add("X-Signature", Sign(delivery.Payload, delivery.Secret, now));
    request.Headers.Add("X-Delivery-Id", delivery.Id.ToString());

    var response = await _http.SendAsync(request, ct);
    await _store.RecordAttemptAsync(delivery, response.StatusCode, ct);
}
```

### Retry with backoff and a cap

Retry on connection failures, timeouts and 5xx; do not retry a 4xx, because the subscriber will keep rejecting the same payload. Space attempts with exponential backoff and jitter over hours, not milliseconds, since subscriber outages last far longer than a blip, and stop after a bounded number of attempts. Each attempt must carry the same delivery id so the receiver can deduplicate, because at-least-once is the only guarantee HTTP gives you.

## Signing so the receiver can trust it

A subscriber must be able to verify the payload came from you and was not altered. Sign a canonical string of a timestamp plus the raw body with an HMAC over a per-endpoint secret, and send the timestamp in a header so the receiver can reject stale signatures and blunt replay attacks. Sign the exact bytes you send, before any reserialisation, because re-encoding the JSON changes the hash and breaks verification.

```csharp
static string Sign(string payload, string secret, long timestamp)
{
    var data = $"{timestamp}.{payload}";
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
    return Convert.ToHexString(hash).ToLowerInvariant();
}
```

## Dead-lettering and visibility

After the maximum attempts, move the delivery to a dead-letter state and surface it: a list in the subscriber's dashboard, an alert to your operations team, a manual resend endpoint. A silently discarded webhook is worse than a failed one, because nobody knows the subscriber missed it. Keep the attempt history so support can answer whether the event was even sent, and expose the last response code so a subscriber debugging their own endpoint has something concrete to work with.

## The trade-off

Reliable webhooks cost you a durable queue, a worker, a retry policy, signing secrets and a dead-letter interface, and they make delivery eventually-consistent, so the subscriber may see the event seconds or hours after it happened. The alternative, synchronous delivery inside the transaction, couples your uptime to every subscriber's, which is never worth it. Emit the event and let the delivery machinery own the promise.
