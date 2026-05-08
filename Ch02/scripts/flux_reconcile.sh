#!/bin/bash
# =============================================================================
# scripts/flux_reconcile.sh — Force Flux Reconciliation & Gateway Smoke Test
# =============================================================================
# Forces an immediate GitOps reconciliation for the platform-services
# Kustomization, then runs the Gateway smoke test to validate that Istio is
# routing traffic correctly after deployment.
#
# Called as a post-deploy step in the CircleCI pipeline (.circleci/config.yml)
# after every Pulumi update to an environment.
#
# Usage:
#   PULUMI_STACK=platform-sandbox SMOKE_HOST=platform-sandbox.local \
#     ./scripts/flux_reconcile.sh
#
# Prerequisites:
#   - flux CLI installed (brew install fluxcd/tap/flux)
#   - kubectl configured for the target cluster (KUBECONFIG set)
#   - jq installed
# =============================================================================

set -euo pipefail

KUSTOMIZATION="${KUSTOMIZATION:-platform-services}"
NAMESPACE="${FLUX_NAMESPACE:-flux-system}"
SMOKE_HOST="${SMOKE_HOST:-platform-sandbox.local}"
RECONCILE_TIMEOUT="${RECONCILE_TIMEOUT:-300}"   # seconds

echo "==> Forcing Flux reconciliation: ${KUSTOMIZATION} in ${NAMESPACE}"
flux reconcile kustomization "${KUSTOMIZATION}" \
  -n "${NAMESPACE}" \
  --with-source

echo "==> Waiting for reconciliation to settle..."
DEADLINE=$(( $(date +%s) + RECONCILE_TIMEOUT ))
while true; do
  STATUS=$(flux get kustomization "${KUSTOMIZATION}" \
    -n "${NAMESPACE}" \
    -o json 2>/dev/null \
    | jq -r '.status.conditions[] | select(.type=="Ready") | .status' || echo "Unknown")

  if [ "${STATUS}" = "True" ]; then
    echo "==> Kustomization is Ready."
    break
  fi

  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    echo "ERROR: Reconciliation did not complete within ${RECONCILE_TIMEOUT}s"
    flux get kustomization "${KUSTOMIZATION}" -n "${NAMESPACE}"
    exit 1
  fi

  echo "    Status: ${STATUS} — waiting 5s..."
  sleep 5
done

# ── Gateway smoke test ────────────────────────────────────────────────────────
echo "==> Running Gateway smoke test (Host: ${SMOKE_HOST})"

kubectl -n istio-system apply -f smoke/http-gateway.yaml

# Wait up to 120s for the Job to complete; print logs if it fails
kubectl -n istio-system wait \
  --for=condition=complete \
  job/smoke-gateway \
  --timeout=120s \
  || {
    echo "ERROR: smoke-gateway Job did not complete — fetching logs:"
    kubectl -n istio-system logs job/smoke-gateway
    kubectl -n istio-system delete -f smoke/http-gateway.yaml --ignore-not-found
    exit 1
  }

echo "==> Smoke test PASSED. Cleaning up test resources."
kubectl -n istio-system delete -f smoke/http-gateway.yaml --ignore-not-found

echo "==> Reconciliation and smoke test complete."
