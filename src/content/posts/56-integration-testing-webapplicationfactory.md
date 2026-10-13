---
title: "Integration Testing with WebApplicationFactory"
slug: "integration-testing-webapplicationfactory"
excerpt: "WebApplicationFactory boots the real app in-process so tests exercise the actual pipeline, catching wiring bugs unit tests can never see."
category: "Testing & Quality"
tags: ["testing", "integration", "aspnetcore"]
date: "2025-11-16"
level: "Advanced"
author: "Riad Hossain"
---

Unit tests prove a class works; they do not prove the application wires up. Dependency injection registrations, middleware order, configuration binding and JSON serialisation are all invisible to a unit test and all capable of failing in production on the first request. `WebApplicationFactory<TEntryPoint>` boots the real application in-process, in memory, with no port and no network hop, so an integration test exercises the actual pipeline. The failure it catches is the one that only appears once the pieces are assembled.

## Bootstrapping the app in-process

The factory hosts your `Program` in a `TestServer`, so the `HttpClient` from `CreateClient` runs the full middleware chain without Kestrel listening. The entry point must be nameable, which is why .NET 6+ minimal APIs want `public partial class Program { }` at the end of the file — otherwise `Program` is internal and the test project cannot reference it.

```csharp
public sealed class OrdersApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Db"] = _connectionString,
            });
        });
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IPaymentGateway>();
            services.AddSingleton<IPaymentGateway, FakePaymentGateway>();
        });
    }
}
```

### Replacing dependencies

`ConfigureTestServices` runs after the application's own registrations, so it is where you override a real dependency with a fake: a payment gateway, a clock, an outbound HTTP client. Removing and re-adding is deliberate, because `AddSingleton` alone leaves two registrations and the real one may win. For anything you cannot fake, point the client at a stub handler or a real container, which is where Testcontainers takes over.

## One client per test, state per class

`CreateClient` is cheap and should be called per test for isolation, but the host and its DI container are shared across the whole factory. That sharing is exactly how integration tests become order-dependent: a singleton cache, a static counter, a database row left behind by the previous test all leak between tests that assumed a clean slate. Reset shared state in a fixture per collection, and when full isolation is required, spin up a fresh factory with its own database container per test class rather than per assertion.

## Asserting on the wire, not the internals

An integration test should speak HTTP and assert on status codes, headers and the serialised body, because that is the contract clients depend on. Reaching into the container to call a service directly re-tests the unit and skips the pipeline that is the whole point. Use the returned client and `System.Net.Http.Json` so serialisation is exercised end to end, and assert the error shape, not only the status, because a 400 with a body of the wrong schema is still a broken API.

```csharp
[Fact]
public async Task Returns_conflict_on_duplicate_sku()
{
    await using var factory = new OrdersApiFactory();
    var client = factory.CreateClient();

    var first = await client.PostAsJsonAsync("/orders", new { sku = "A-1", quantity = 2 });
    first.EnsureSuccessStatusCode();

    var second = await client.PostAsJsonAsync("/orders", new { sku = "A-1", quantity = 2 });

    Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
}
```

## The trade-off

An in-process test is faster than a real network hop but still boots the whole application, so a suite of them is orders of magnitude slower than unit tests; keep the count focused on wiring and cross-cutting behaviour rather than every validation branch. It also gives false confidence about transport, because `TestServer` bypasses Kestrel, TLS and real HTTP limits, so a deployment-shape bug can pass here and fail behind the ingress. Treat it as the seam between unit and end-to-end, not a replacement for either.
