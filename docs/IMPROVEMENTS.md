# Switchboard — Suggestions for Improvement

## High-Priority Improvements

1. **Dashboard is severely under-built.** The current dashboard only has an identity configuration page. It needs:
   - Approval queue UI (approve/reject/patch pending actions)
   - Audit log viewer with search and filtering
   - Policy editor (create/edit guardrail rules visually)
   - Connection manager (add/test/rotate API credentials)
   - Real-time activity feed
   - Analytics dashboards (proposal counts, approval rates, execution success rates, latency)
   - Organization management
   - Conversation thread viewer (for lead bot monitoring)

2. **No real entity graph implementation.** The cross-cartridge enrichment system references an `EntityGraphService` interface, but the actual entity graph is not implemented. Currently, entity resolution across cartridges relies on simple parameter-name-based inference. A proper entity graph would enable:
   - Reliable cross-cartridge entity resolution
   - Impact analysis ("which campaigns does this contact appear in?")
   - Cascade protection ("don't delete this contact, they have active deals")

3. **No multi-tenancy isolation at the database level.** Org-scoping is done via query-level `WHERE organizationId = ?` filters. This is functional but has risks:
   - A bug in any query could leak data across orgs
   - No row-level security in PostgreSQL
   - Consider PostgreSQL RLS policies or schema-per-tenant for stronger isolation

4. **ConversionBus is in-memory only.** The `InMemoryConversionBus` doesn't survive process restarts and doesn't work in multi-process deployments. For production:
   - Implement a Redis/NATS-backed ConversionBus
   - Add persistent event storage for replay
   - Add dead-letter queue for failed handlers

5. **No webhook delivery guarantees.** Outbound notifications (Telegram, Slack, WhatsApp) are fire-and-forget. If a notification fails after retries, there's no persistent retry queue or human alerting. Need:
   - Persistent outbound notification queue
   - Retry with exponential backoff and dead-letter
   - Notification delivery status tracking

## Medium-Priority Improvements

6. **Goal Parser is regex-only.** The `@experimental` goal parser uses regex patterns for intent classification. This will fail for nuanced natural language. Should be upgraded to LLM-based intent classification with structured output.

7. **No automated testing for skin/profile configuration.** Skins and profiles are pure JSON with Zod validation, but there are no integration tests that verify a specific skin+profile combination actually works end-to-end through the governance pipeline.

8. **Mock providers dominate external integrations.** Most cartridges default to mock providers when API credentials aren't present. This is fine for development, but the boundary between mock and real is sometimes unclear. Consider:
   - Explicit "dev mode" flag instead of implicit credential detection
   - Integration test suite that runs against real APIs (separate CI job with secrets)
   - Provider health dashboard showing which connections are real vs mock

9. **Audit chain verification is background-only.** The hash chain integrity check runs as a periodic background job. There's no on-demand verification endpoint or automated alerting when chain integrity is broken. Add:
   - `GET /api/audit/verify` endpoint
   - Alert integration when `verifyChain()` fails
   - Automatic chain repair recommendations

10. **No rate limiting on audit queries.** The audit log can grow very large. Querying without pagination limits could cause performance issues. Add:
    - Mandatory pagination
    - Time-range requirements for large queries
    - Query cost estimation

11. **Cadence engine has no timezone awareness.** Cadence step delays are in milliseconds, but there's no timezone-aware scheduling. A follow-up scheduled for "tomorrow morning" should respect the business's timezone, not UTC.

12. **No A/B testing framework for conversation flows.** The conversation engine is deterministic — every lead gets the same flow. Adding flow variants with automatic performance comparison would improve conversion rates.

## Architectural Gaps to North Star

13. **No event sourcing.** The current architecture uses traditional CRUD with audit entries appended separately. A true event-sourced architecture would:
    - Make the audit trail the primary source of truth (not a secondary log)
    - Enable time-travel debugging ("show me the state at 3pm yesterday")
    - Simplify multi-instance consistency

14. **No real-time streaming.** The dashboard and API are request-response only. For a production operator cockpit, you'd want:
    - WebSocket or SSE for real-time activity feeds
    - Live approval notifications in the dashboard
    - Real-time conversation monitoring

15. **No cartridge marketplace / dynamic loading.** Cartridges are compiled into the deployment at build time. The north star would be:
    - Dynamic cartridge loading at runtime
    - Cartridge versioning and compatibility checking
    - Community/marketplace for third-party cartridges
    - Sandboxed execution for untrusted cartridges

16. **No multi-region / geo-distributed deployment.** The current architecture assumes a single database instance. For a global SaaS:
    - Read replicas for audit queries
    - Regional write routing
    - Conflict resolution for concurrent approvals across regions

17. **No workflow builder.** Data flow plans are currently defined in code. A visual workflow builder in the dashboard would let non-technical users create multi-step automations.

18. **LLM provider abstraction is thin.** The `LLMClient` interface exists but switching providers (Anthropic ↔ OpenAI ↔ local) requires code changes. Need a robust model router with:
    - Automatic failover between providers
    - Cost tracking per model/provider
    - Quality monitoring (response relevance scoring)

19. **No user-facing API documentation portal.** Swagger/OpenAPI is configured but there's no hosted documentation site, API playground, or SDK generation.

20. **Billing and usage metering is absent.** For a SaaS platform, you need:
    - Per-org action metering
    - Tiered pricing enforcement
    - Usage dashboards
    - LLM token cost allocation per org

21. **No observability stack integration.** Telemetry abstractions exist (OpenTelemetry, Prometheus) but there's no:
    - Grafana dashboard definitions
    - Alert rules for SLO breaches
    - Distributed tracing visualization
    - Log aggregation (structured logging exists, but no ELK/Loki integration)

22. **OAuth flow is half-built.** Token refresh exists but the initial OAuth authorization flow (user consent, callback handling, code exchange) is not implemented. Users must manually paste access tokens into connection credentials.
