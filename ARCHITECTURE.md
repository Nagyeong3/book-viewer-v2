# Book Viewer V2 Architecture

## Goal
Rebuild the booklet viewer and RAG chatbot as a clean, testable system. PostgreSQL is the source of truth; Elasticsearch is a derived search index. Legacy code is reference-only.

## Runtime architecture

```text
Frontend (Next.js)
  -> Backend API (FastAPI)
      -> Viewer services -> PostgreSQL
      -> RAG service
          -> Retrieval (keyword/vector/hybrid)
          -> Context builder
          -> LLM provider -> LiteLLM -> vLLM -> gpt-oss-120b

PostgreSQL -> Indexing pipeline -> Elasticsearch
```

## Search storage
Use versioned physical indices with stable aliases:
- `rag-documents-v1` behind alias `rag-documents`
- `rag-maintenance-v1` behind alias `rag-maintenance`

Do not create one index per document. Every searchable row carries `document_id` as a keyword so a request can constrain search to one or many selected documents.

Document search model must preserve at least: `document_id`, `chunk_id`, `text`, `title_num`, `title_list`, `page`, `start_index`, `doc_type`, `source`, `has_image`, `vector`, and extensible metadata.

Maintenance search model must preserve at least: `record_id`, `document_id`, `author`, `part`, `task_date`, `task_number`, `text`, `vector`, and extensible metadata.

Korean full-text analysis uses a shared custom analyzer based on `nori_tokenizer`, `lowercase`, and `nori_readingform`. Embedding dimensions are configuration, not hard-coded domain constants.

## Data ownership
- PostgreSQL: authoritative document/viewer/maintenance data.
- Elasticsearch: disposable/rebuildable search projection.
- Maintenance writes go to PostgreSQL first, then are synchronized to Elasticsearch.
- Neo4j is not part of V2 until a concrete graph-retrieval requirement is proven.

## Backend boundaries
```text
api -> application -> domain ports <- infrastructure
```
Rules:
- API handlers never query DB/ES directly.
- Application services never import FastAPI or Socket.IO.
- Domain never imports LangChain.
- Infrastructure adapters normalize external types before returning them.

## LLM abstraction
`LLMProvider` exposes non-streaming and streaming methods. Application code receives project-owned response/chunk types, never `AIMessage` or `AIMessageChunk`.

Default production route: Backend -> LiteLLM (virtual key) -> vLLM -> gpt-oss-120b.

## Retrieval abstraction
Search must support keyword, vector, and hybrid retrieval with mandatory scope filters. `document_ids` may contain multiple documents. Agentic RAG may choose among safe retrieval tools later, but must not construct arbitrary Elasticsearch DSL.

## Delivery order
1. Deterministic non-streaming RAG.
2. Quality/regression tests.
3. Streaming transport.
4. Agentic planner/tool routing.
5. Frontend integration and refinement.

## Observability
Each RAG request gets a request ID and timings for retrieval, context building, LLM first token, LLM total, and total request latency. Record provider/model and token usage when available.
