/**
 * Chapter 5: OpenTelemetry Instrumentation Setup
 * ================================================
 * Configures the OpenTelemetry SDK for a Node.js application.
 * Must be required BEFORE any other modules.
 *
 * Usage: node --require ./instrumentation.js app.js
 *
 * Prerequisites:
 *   npm install @opentelemetry/sdk-node \
 *     @opentelemetry/auto-instrumentations-node \
 *     @opentelemetry/exporter-trace-otlp-proto \
 *     @opentelemetry/exporter-metrics-otlp-proto \
 *     @opentelemetry/sdk-metrics \
 *     @opentelemetry/resources \
 *     @opentelemetry/semantic-conventions
 */

'use strict';

const { NodeSDK }                       = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations }   = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter }             = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter }            = require('@opentelemetry/exporter-metrics-otlp-proto');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource }                      = require('@opentelemetry/resources');
const { SemanticResourceAttributes }    = require('@opentelemetry/semantic-conventions');

const serviceName     = process.env.OTEL_SERVICE_NAME                     || 'demo-app';
const traceEndpoint   = process.env.OTEL_EXPORTER_OTLP_ENDPOINT           || 'http://otel-collector.platform:4318/v1/traces';
const metricEndpoint  = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT   || 'http://otel-collector.platform:4318/v1/metrics';

// PeriodicExportingMetricReader is required — without it, metrics.getMeter()
// calls in app.js are registered but never flushed, making all counters and
// histograms silent no-ops. The reader pushes metric snapshots to the
// collector on a fixed interval (default: 60 s, set to 10 s here for demos).
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:           serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]:        process.env.APP_VERSION || '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV   || 'development',
  }),
  traceExporter: new OTLPTraceExporter({ url: traceEndpoint }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: metricEndpoint }),
    exportIntervalMillis: 10_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http':    { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-fs':      { enabled: false },
    }),
  ],
});

sdk.start();
console.log(`OpenTelemetry initialized for ${serviceName} → ${traceEndpoint}`);

process.on('SIGTERM', () => {
  sdk.shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
});
