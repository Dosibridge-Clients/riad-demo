---
title: "Testcontainers: Real Databases and Brokers in Tests"
slug: "testcontainers-real-dependencies"
excerpt: "In-memory databases do not enforce indexes or dialects. Testcontainers runs the real Postgres or broker in Docker so integration tests fail for real reasons."
category: "Testing & Quality"
tags: ["testcontainers", "docker", "testing"]
date: "2025-11-10"
level: "Advanced"
author: "Riad"
---

An in-memory database is a mock wearing a real database's name. It does not enforce the unique index you rely on, it does not reproduce the concurrency behaviour of the real engine, and a query that passed against it can still fail in production. `Testcontainers` starts the real dependency — Postgres, RabbitMQ, Redis — in a Docker container for the duration of the test, so integration tests run against the same software the production environment runs.

## A fresh container per test class

The idiomatic shape is `IAsyncLifetime`: start the container in `InitializeAsync` and dispose it in `DisposeAsync`, which xUnit calls around the test class. A `PostgreSqlBuilder` gives you a running server and a connection string on a random host port, so parallel test classes never collide.

```csharp
public sealed class OrdersRepositoryTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("orders")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    public async Task InitializeAsync()
    {
        await _db.StartAsync();
        await using var conn = new NpgsqlConnection(_db.GetConnectionString());
        await conn.OpenAsync();
        await MigrateAsync(conn);
    }

    public async Task DisposeAsync() => await _db.DisposeAsync();
}
```

### Waiting for readiness, not for startup

A container reports as started before the server inside it accepts connections. Testcontainers mitigates this with a wait strategy, but for a database you want the port listening and a query to succeed. Relying on a fixed `Task.Delay` is the classic flake: it is either too short on a loaded CI box or needlessly long on a fast laptop. Use the builder's default wait, and if you add your own, wait on a real readiness check rather than on time.

## Sharing a container across a collection

One container per test class isolates tests but pays the startup cost repeatedly. When the suite grows, hoist the container into an `ICollectionFixture` shared by a collection of test classes, and give each test its own schema or database so they stay isolated while sharing one server process. That pays for migrations once and keeps tests independent, which is the balance a large suite needs.

## The failures only a real engine produces

Real engines expose real bugs: a `decimal` precision you set in EF Core that truncates on Postgres, a unique index violation an in-memory provider ignores, a raw SQL query with a dialect-specific function. These are exactly the failures that pass every mock and reach production. Running the actual broker also catches serialisation and consumer-binding mistakes a mocked producer cannot, because the mock has no opinions about your message headers.

```csharp
var rabbit = new RabbitMqBuilder().WithImage("rabbitmq:3-management").Build();
await rabbit.StartAsync();

var factory = new ConnectionFactory { Uri = new Uri(rabbit.GetConnectionString()) };
await using var connection = await factory.CreateConnectionAsync();
```

## The trade-off

Containers make the suite slower and add a Docker requirement to every developer machine and CI runner, so integration tests belong in a separate category from the fast unit run and should be excluded from the quick inner-loop pass. The trade is a suite that fails for real reasons instead of passing for fake ones, and a bug that reaches CI rather than a customer. Optimise the image sizes and the number of containers you start, not the presence of containers themselves.
