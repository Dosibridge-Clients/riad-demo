---
title: "Scaling SignalR: Backplanes, Groups and Presence"
slug: "signalr-scaling-backplane"
excerpt: "SignalR broadcasts are local to one instance until you add a backplane. Groups scale horizontally, but presence needs an expiry you write yourself."
category: "Messaging & Distributed Systems"
tags: ["signalr", "websockets", "scale"]
date: "2025-12-22"
level: "Advanced"
author: "Riad Hossain"
---

A single SignalR instance holds every connection in memory, which makes broadcasting trivial and scaling deceptive. The failure shows up the day you run two replicas behind a load balancer: the message reaches clients connected to the instance that sent it and silently misses the rest. There is no error, no dropped-connection log — just half the users not receiving updates. The fix is a backplane that fans every message out to all instances, plus a story for groups, connection affinity and presence, because none of those are free once you are no longer one process.

## The backplane and connection affinity

`AddStackExchangeRedis` (in `Microsoft.AspNetCore.SignalR.StackExchangeRedis`) publishes every hub message to a Redis channel that all instances subscribe to. Azure SignalR Service offloads the connections entirely so your app servers hold none. Either way, the connection itself must stay on one instance — sticky sessions at the load balancer are mandatory for the default WebSockets transport, because SignalR's negotiate and reconnect assume affinity. Disable sticky sessions only when you use the Azure service, which handles the negotiation centrally.

```csharp
builder.Services.AddSignalR()
    .AddStackExchangeRedis(builder.Configuration.GetConnectionString("redis")!, options =>
    {
        options.Configuration.ChannelPrefix = RedisChannel.Literal("riad-demo");
    });
```

The `ChannelPrefix` matters: two applications sharing a Redis instance with the same prefix will cross-deliver each other's messages. Set it per application and per environment.

## Groups scale, with a catch

A group is a logical set of connections with no server-side membership store — the identity of the group lives in each connection's memory on whichever instance holds it. That scales horizontally because the backplane forwards a group send to every instance, and each instance delivers to the connections it owns. The catch is lookup cost: group membership is keyed by connection id, so a user with connections on three instances is in the group three times, and `Clients.User(...)` resolves through `IUserIdProvider`, which you must implement if your user id is not the default `ClaimTypes.NameIdentifier`.

### Presence needs an expiry

Presence is the part SignalR does not give you. `OnConnectedAsync` and `OnDisconnectedAsync` fire per connection, but on a hard network drop `OnDisconnectedAsync` may be delayed until the client timeout, and across instances the events do not coordinate. The working pattern is to write a presence key to Redis with a TTL on connect, refresh it on heartbeat, and let it expire on disconnect — expiry, not the event, is the source of truth.

```csharp
public override async Task OnConnectedAsync()
{
    var userId = Context.UserIdentifier!;
    await _redis.StringSetAsync($"presence:{userId}:{Context.ConnectionId}", "1",
        expiry: TimeSpan.FromSeconds(30));
    await Groups.AddToGroupAsync(Context.ConnectionId, $"user:{userId}", Context.ConnectionAborted);
    await base.OnConnectedAsync();
}
```

## The trade-off

A Redis backplane adds a dependency on the hot path of every broadcast and turns a Redis outage into a loss of fan-out while connections stay up — clients are connected but receive nothing. Azure SignalR moves that dependency off your compute but adds per-message cost and a vendor. Presence by TTL means a 30-second window where a disconnected user still looks online; tightening it costs heartbeat traffic. Scale SignalR deliberately: pick the backplane, set sticky affinity, keep messages small because they cross Redis for every recipient, and treat presence as a lease you renew rather than an event you trust.
