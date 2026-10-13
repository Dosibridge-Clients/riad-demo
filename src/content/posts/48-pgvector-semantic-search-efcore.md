---
title: "Semantic Search with pgvector and EF Core"
slug: "pgvector-semantic-search-efcore"
excerpt: "Embeddings in Postgres turn keyword search into meaning search, but the index type and distance operator decide whether the query is fast."
category: "Data & EF Core"
tags: ["pgvector", "embeddings", "search"]
date: "2026-01-03"
level: "Advanced"
author: "Riad Hossain"
---

Keyword search matches tokens; semantic search matches vectors. You embed a document and a query with the same model, store the document vector in the database, and rank by distance. The reason teams reach for `pgvector` rather than a dedicated vector store is that the vectors live next to the relational data, so a similarity query can join against tenant, status and permissions in one round trip and participate in the same transaction. The reason it goes wrong is almost always the index: an exact nearest-neighbour scan over a million rows is a sequential scan that ignores every index you hoped for.

## Wiring the provider and the column

`NpgsqlDataSourceBuilder.UseVector()` registers the type mapping, and the column is typed `vector(n)` where `n` is the embedding dimension and must match the model. The EF mapping is done with an extension method on the property.

```csharp
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connString);
dataSourceBuilder.UseVector();
await using var dataSource = dataSourceBuilder.Build();

builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(dataSource));

protected override void OnModelCreating(ModelBuilder b)
{
    b.Entity<Document>().OwnsOne(d => d.Embedding, e =>
    {
        e.Property(p => p.Vector).HasColumnType("vector(1536)");
    });
}
```

The dimension mismatch is the first failure: an index built for `vector(1536)` will not serve a query against a `vector(768)` column, and if you change embedding models you are looking at a full re-embed and a column rewrite, not a config change.

## Choosing the index

An HNSW index gives better recall and query latency than IVFFlat but is slower to build and takes more memory. IVFFlat needs a representative sample to build its lists and must be rebuilt as the table grows; its recall depends on `lists` and the `probes` setting at query time. For most workloads start with HNSW and accept the build cost.

```sql
CREATE INDEX ix_documents_embedding
    ON documents
    USING hnsw (embedding_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

The operator class must match the distance operator you query with: `vector_cosine_ops` pairs with the `<=>` cosine operator, `vector_l2_ops` with `<->`. Query with `<=>` while the index is built for L2 and the planner falls back to a sequential scan.

### Querying through EF Core

EF Core has no first-class vector operators, so the ranking is expressed with `FromSqlInterpolated` or a shadow property and raw SQL, then projected. The key detail is that the ordering must be applied in SQL — pulling all rows and sorting in memory defeats the index entirely.

```csharp
var hits = await db.Documents
    .FromSqlInterpolated($"""
        SELECT * FROM documents
        ORDER BY embedding_vector <=> {new Vector(queryEmbedding)}
        LIMIT 20
        """)
    .AsNoTracking()
    .ToListAsync(ct);
```

## The trade-off

Vector search returns the most similar rows, not the most correct ones, so a hybrid of lexical `tsvector` ranking and vector distance usually beats either alone. HNSW trades memory and index build time for speed, and approximate search will occasionally miss a true nearest neighbour. The real win is keeping everything in Postgres: one transaction, one backup, joins that respect row-level security. The price is that you now own the embedding pipeline and its re-indexing, which is the part people underestimate.
