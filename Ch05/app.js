/**
 * Chapter 5: Express App with Custom OpenTelemetry Spans
 * =======================================================
 * Demonstrates manual span creation for business logic tracing.
 *
 * Usage: node --require ./instrumentation.js app.js
 */

'use strict';

const express = require('express');
// context is needed to explicitly wire the parent span when using startSpan()
// instead of startActiveSpan() — without it, dbSpan is a detached root span.
const { trace, metrics, context, SpanStatusCode } = require('@opentelemetry/api');

const app     = express();
const PORT    = process.env.PORT || 8080;
const tracer  = trace.getTracer('demo-app', '1.0.0');
const meter   = metrics.getMeter('demo-app', '1.0.0');

// ── Custom metrics ────────────────────────────────────────────────────────────
// These instruments are only functional when instrumentation.js is required
// first and a PeriodicExportingMetricReader is registered in the NodeSDK.
// Without a metricReader, getMeter() returns instruments that are silently
// discarded — no error, no data in Prometheus/Grafana.
const requestCounter  = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});
const requestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

app.use(express.json());

// ── Health and readiness endpoints ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'healthy' }));
app.get('/ready',  (req, res) => res.json({ status: 'ready' }));

// ── /api/items — startActiveSpan() pattern ────────────────────────────────────
// startActiveSpan() sets the new span as the active span for its callback
// scope, so any child span started inside the callback is automatically
// parented without explicit context wiring.
app.get('/api/items', async (req, res) => {
  const startTime = Date.now();

  await tracer.startActiveSpan('fetch-items', {
    attributes: {
      'http.method': 'GET',
      'app.query.limit': req.query.limit || '10',
    },
  }, async (span) => {
    try {
      // dbSpan is automatically a child of span because span is the active span.
      const items = await tracer.startActiveSpan('db-query', async (dbSpan) => {
        dbSpan.setAttribute('db.system', 'postgresql');
        dbSpan.setAttribute('db.statement', 'SELECT * FROM items LIMIT $1');
        dbSpan.addEvent('query-started');
        const result = [
          { id: 1, name: 'Platform SDK', version: '2.1.0' },
          { id: 2, name: 'CLI Tool',     version: '1.5.3'  },
        ];
        dbSpan.addEvent('query-completed', { 'db.rows_returned': result.length });
        dbSpan.end();
        return result;
      });

      span.setAttribute('app.items.count', items.length);
      span.setStatus({ code: SpanStatusCode.OK });
      requestCounter.add(1, { endpoint: '/api/items', status: '200' });
      res.json({ items });
    } catch (error) {
      // recordException attaches the stack trace as a span event.
      // setStatus marks the span outcome as ERROR — both are required;
      // recordException alone does not change the span's status.
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      requestCounter.add(1, { endpoint: '/api/items', status: '500' });
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      requestDuration.record(Date.now() - startTime, { endpoint: '/api/items' });
      span.end();
    }
  });
});

// ── /api/users/:id — explicit context pattern ─────────────────────────────────
// When the parent span is created with startSpan() (not startActiveSpan()),
// it is NOT set as the active span, so child spans started inside the handler
// would be detached root spans. To wire the parent-child relationship manually:
//   1. Build a context that carries the parent span.
//   2. Pass that context as the third argument to tracer.startSpan().
app.get('/api/users/:id', async (req, res) => {
  const startTime = Date.now();
  const span      = tracer.startSpan('fetch_user_data');

  try {
    span.setAttribute('user.id', req.params.id);

    // Explicitly set span as active so dbSpan is parented to it.
    const ctx    = trace.setSpan(context.active(), span);
    const dbSpan = tracer.startSpan(
      'database.query',
      { attributes: { 'db.operation': 'SELECT', 'db.system': 'postgresql' } },
      ctx,
    );

    const userData = await fetchUserFromDatabase(req.params.id);
    dbSpan.setStatus({ code: SpanStatusCode.OK });
    dbSpan.end();

    requestCounter.add(1, { endpoint: '/api/users', status: '200' });
    requestDuration.record(Date.now() - startTime, { endpoint: '/api/users' });
    span.setStatus({ code: SpanStatusCode.OK });
    res.json(userData);
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    requestCounter.add(1, { endpoint: '/api/users', status: '500' });
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    requestDuration.record(Date.now() - startTime, { endpoint: '/api/users' });
    span.end();
  }
});

// ── Stub — replace with real DB client ───────────────────────────────────────
async function fetchUserFromDatabase(id) {
  return { id, name: 'Maria', role: 'platform-engineer' };
}

app.listen(PORT, () => console.log(`Demo app listening on port ${PORT}`));

module.exports = app;
