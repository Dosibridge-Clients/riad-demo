---
title: "gRPC in .NET: Unary, Streaming and Interceptors"
slug: "grpc-unary-streaming-interceptors"
excerpt: "gRPC gives you four call shapes over one contract. Pick the streaming mode by the direction the data actually flows, then layer interceptors."
category: "Messaging & Distributed Systems"
tags: ["grpc", "protobuf", "streaming"]
date: "2025-12-28"
level: "Advanced"
author: "Riad Hossain"
---

gRPC is HTTP/2 with a typed contract in front of it. The contract is a `.proto` file compiled into client and server stubs, the transport multiplexes many requests over one connection, and the four call shapes fall out of how the request and response are framed. Teams usually arrive from REST with a unary mental model and then discover that streaming is not a performance switch you flip — it is a different contract with different failure semantics, and choosing the wrong one produces a service that buffers the entire result set in memory because the client asked for a stream.

## The four shapes

- Unary: one request, one response. The default and the right choice for anything request/response shaped.
- Server streaming: one request, a sequence of responses. Use it when the server produces an unbounded or long result — a log tail, a large export, progress events.
- Client streaming: a sequence of requests, one response. Use it for uploads and aggregation the server completes once.
- Bidirectional: both sides stream independently. Use it for chat, multiplexed feeds, or an interactive session where either side can push at any moment.

## Defining the contract

The `.proto` file is the source of truth and the generated code follows from it. A server-streaming method is marked with `stream` on the response; that single keyword is the entire difference in the generated `AsyncServerStreamingCall`.

```protobuf
syntax = "proto3";

package orders.v1;

service OrderService {
  rpc GetOrder (GetOrderRequest) returns (OrderReply);
  rpc WatchOrders (WatchRequest) returns (stream OrderEvent);
  rpc UploadLines (stream LineChunk) returns (UploadReply);
}

message WatchRequest { string tenant_id = 1; }
message OrderEvent { string order_id = 1; string status = 2; }
```

### Consuming a stream on the server

A server-streaming handler writes with `WriteAsync` and returns when done. The `ServerCallContext` carries the `CancellationToken`, and that token fires when the client disconnects or the deadline elapses — you must honour it or the handler keeps producing into a gone client.

```csharp
public override async Task WatchOrders(
    WatchRequest request,
    IServerStreamWriter<OrderEvent> responseStream,
    ServerCallContext context)
{
    await foreach (var evt in _bus.SubscribeAsync(request.TenantId, context.CancellationToken))
    {
        await responseStream.WriteAsync(new OrderEvent
        {
            OrderId = evt.OrderId,
            Status = evt.Status
        });
    }
}
```

## Interceptors as the cross-cutting layer

An interceptor wraps the call pipeline on the client or the server, which is where logging, auth headers, retries and deadlines belong — the gRPC equivalent of middleware. On the server, `Interceptor` with a `UnaryServerHandler` covers unary calls; you need separate overrides for each streaming shape, which is the common miss.

```csharp
public sealed class AuthInterceptor : Interceptor
{
    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        var token = context.RequestHeaders.GetValue("authorization");
        if (string.IsNullOrEmpty(token)) throw new RpcException(new Status(StatusCode.Unauthenticated, "missing token"));
        return await continuation(request, context);
    }

    public override Task ServerStreamingServerHandler<TRequest, TResponse>(
        TRequest request,
        IServerStreamWriter<TResponse> writer,
        ServerCallContext context,
        ServerStreamingServerMethod<TRequest, TResponse> continuation)
        => base.ServerStreamingServerHandler(request, writer, context, continuation);
}
```

## The trade-off

Streaming removes polling and cuts latency but moves error handling into a long-lived call: a failure mid-stream surfaces as an `RpcException` after partial results have been delivered, and the client must decide whether to resume or restart. Unary calls retry cleanly and stream calls generally do not, because replay is not idempotent. Default to unary, reach for server streaming only when the payload is genuinely incremental, and remember that HTTP/2 multiplexing means a single slow consumer can starve a connection unless flow control and deadlines are set.
