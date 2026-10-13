---
title: "RabbitMQ vs Kafka: Choosing a Broker for .NET Services"
slug: "rabbitmq-vs-kafka-dotnet"
excerpt: "RabbitMQ routes and tracks each message; Kafka keeps a replayable ordered log. The right choice turns on delivery and replay semantics, not raw throughput."
category: "Messaging & Distributed Systems"
tags: ["rabbitmq", "kafka", "messaging"]
date: "2025-12-16"
level: "Advanced"
author: "Riad Hossain"
---

Choosing between RabbitMQ and Kafka is usually framed as a throughput question, and that framing picks the wrong broker about half the time. RabbitMQ is a smart broker with thin consumers: it matches routing keys, tracks a per-message acknowledgement and discards a message once it is done. Kafka is a thin broker with smart consumers: it appends records to an ordered, partitioned log and lets each consumer group remember its own position. The decision that actually matters is which delivery and replay semantics your domain needs, because the broker that cannot express them forces that logic into your application.

## The broker-memory difference

RabbitMQ is a queue: a message exists until a consumer acknowledges it, then it is gone. That makes it excellent for work distribution, request-reply and per-message routing. Kafka is a log: a record is retained for its topic's retention window regardless of whether anyone read it, and consumers advance an offset instead of deleting anything. That makes it excellent for event streaming, replay and multiple independent readers of one stream. Predict the operational shape you need first, then choose the tool that already has it.

```csharp
var factory = new ConnectionFactory { HostName = "rabbit", DispatchConsumersAsync = true };
await using var connection = await factory.CreateConnectionAsync();
await using var channel = await connection.CreateChannelAsync();

await channel.ExchangeDeclareAsync("orders", ExchangeType.Topic, durable: true);
await channel.QueueDeclareAsync("billing", durable: true, exclusive: false, autoDelete: false);
await channel.QueueBindAsync("billing", "orders", "order.created.*");
await channel.BasicQosAsync(prefetchSize: 0, prefetchCount: 20, global: false);
```

### Prefetch is the knob that matters

`BasicQosAsync` caps how many unacknowledged messages a channel holds. Omit it and RabbitMQ pushes the whole queue at the consumer, so one slow handler builds a mountain of unacked work and memory pressure on both sides. A prefetch of ten to thirty balances throughput against fairness across consumers, and it belongs with manual acknowledgement so a handler that throws is requeued or dead-lettered rather than silently dropped.

## When the log is the right shape

Kafka's strength is ordering within a partition and the ability to rewind. When a downstream projector has a bug, you fix the code and reset the consumer group's offset to reprocess history — impossible in a queue where the message was deleted on acknowledgement. The cost is that ordering is per partition only, so any events that must be processed in sequence have to share a partition key, usually the aggregate identity.

```csharp
var config = new ConsumerConfig
{
    BootstrapServers = "kafka:9092",
    GroupId = "billing",
    EnableAutoCommit = false,
    AutoOffsetReset = AutoOffsetReset.Earliest,
};
using var consumer = new ConsumerBuilder<string, string>(config).Build();
consumer.Subscribe("orders");
var record = consumer.Consume(ct);
consumer.Commit(record);
```

### Offsets are the consumer's problem

With `EnableAutoCommit` off, you decide when progress is durable. Commit before the work finishes and a crash loses the message; commit after and a crash replays it. Because Kafka gives you at-least-once here, the consumer must be idempotent, exactly as with a RabbitMQ redelivery. Auto-commit hides that contract and produces silent gaps when a batch is committed before its handler succeeds.

## The trade-off

RabbitMQ gives fine-grained routing, per-message TTL, priority queues and dead-letter exchanges, and holds less consumer state in the broker. Kafka gives replay, per-partition ordering and fan-out to many independent groups at very high throughput, but pushes correlation, idempotency and offset management onto you, and a single slow consumer on a partition blocks everyone behind it. Choose RabbitMQ when messages are tasks to dispatch once; choose Kafka when they are facts to replay and read many times.
