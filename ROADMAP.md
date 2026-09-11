# Book Viewer V2 Roadmap

## Phase 0 - Bootstrap
Architecture docs, repository layout, config, logging, health endpoint, domain ports, minimal frontend shell, tests.

## Phase 1 - Backend core
Request IDs, standard errors, dependency wiring, lifecycle, configuration validation, test harness.

## Phase 2 - PostgreSQL viewer
Document list, TOC, chapter/section retrieval, coordinates, image paths, source navigation. Preserve useful viewer business rules while removing legacy coupling.

## Phase 3 - PostgreSQL to Elasticsearch indexing
Unified versioned document/maintenance indices, aliases, shared Korean analyzer, chunking, embedding provider, full rebuild and incremental synchronization.

## Phase 4 - Retrieval
Keyword, vector, hybrid, title boost, multi-document filters, deterministic merge/rerank, retrieval evaluation.

## Phase 5 - LLM and deterministic RAG
LiteLLM provider, vLLM route, context builder, prompt builder, citations, non-streaming end-to-end RAG.

## Phase 6 - Streaming
Provider-independent stream chunks, one transport contract, cancellation, timeout, disconnect handling, source/final events.

## Phase 7 - Agentic RAG
Planner, constrained retrieval tool registry, fallback strategy, tracing. Agent chooses safe tools; it does not emit arbitrary ES queries.

## Phase 8 - Frontend V2
Rebuild the agreed viewer layout, multi-document selection, TOC, viewer, chat, citation navigation, maintenance UI.

## Phase 9 - Evaluation and offline packaging
Hit@K, MRR, latency, answer/source quality, locked dependencies, wheels/npm artifacts/images/models/checksums and repeatable closed-network setup.
