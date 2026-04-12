#!/bin/bash
# Exercise 12.1 Prerequisites Setup
# Chapter 12 — Optimizing Cost, Performance, and Scalability
#
# This script prepares your cluster for Exercise 12.1:
#   "Reduce the cost of an application by 30% without degrading performance."
#
# What it does:
#   1. Verifies kubectl connectivity
#   2. Installs Metrics Server (for kubectl top and HPA CPU metrics)
#   3. Installs OpenCost (lightweight mode — no Prometheus required for Kind/local clusters)
#   4. Deploys the sample checkout-api workload with HPA enabled
#   5. Captures a baseline cost snapshot and prints your 30% reduction target
#
# Requirements:
#   - kubectl configured against your cluster
#   - Helm 3 installed
#   - curl and jq installed
#
# Usage:
#   chmod +x exercise-12-1-setup.sh
#   ./exercise-12-1-setup.sh
#
# To clean up after the exercise:
#   kubectl delete -f checkout-api-hpa.yaml
#   kubectl delete namespace opencost
#   kubectl delete -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

set -e

OPENCOST_NAMESPACE="opencost"
OPENCOST_PORT="9003"
BASELINE_FILE="exercise-12-1-baseline.json"

# ── Colours for readability ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Step 1: Verify kubectl connectivity ─────────────────────────────────────
info "Step 1/5: Verifying cluster connectivity..."

if ! kubectl cluster-info --request-timeout=5s > /dev/null 2>&1; then
  error "Cannot reach cluster. Check that kubectl is configured correctly (kubectl cluster-info)."
fi

CLUSTER=$(kubectl config current-context)
info "Connected to cluster: ${CLUSTER}"

# ── Step 2: Install Metrics Server ──────────────────────────────────────────
info "Step 2/5: Checking Metrics Server..."

if kubectl get deployment metrics-server -n kube-system > /dev/null 2>&1; then
  info "Metrics Server already installed — skipping."
else
  info "Installing Metrics Server..."
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

  # For Kind/local clusters: patch to allow insecure TLS (kubelet self-signed cert)
  CONTEXT_NAME=$(kubectl config current-context)
  if echo "${CONTEXT_NAME}" | grep -qiE "kind|local|minikube|docker"; then
    warn "Detected local cluster — patching Metrics Server to skip TLS verification."
    kubectl patch deployment metrics-server -n kube-system \
      --type='json' \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  fi

  info "Waiting for Metrics Server to become ready..."
  kubectl rollout status deployment/metrics-server -n kube-system --timeout=2m
fi

# Confirm Metrics Server is returning data (may need 30 s after fresh install)
info "Verifying node metrics are available..."
for i in $(seq 1 12); do
  if kubectl top nodes > /dev/null 2>&1; then
    info "Metrics Server responding — node metrics available."
    break
  fi
  if [ "$i" -eq 12 ]; then
    warn "Metrics Server installed but not yet returning data. Continue — it may need another minute."
  fi
  sleep 5
done

# ── Step 3: Install OpenCost ─────────────────────────────────────────────────
info "Step 3/5: Checking OpenCost..."

if kubectl get deployment opencost -n "${OPENCOST_NAMESPACE}" > /dev/null 2>&1; then
  info "OpenCost already installed — skipping."
else
  info "Installing OpenCost (lightweight mode, no external Prometheus required)..."

  kubectl create namespace "${OPENCOST_NAMESPACE}" \
    --dry-run=client -o yaml | kubectl apply -f -

  # Install via Helm with built-in Prometheus disabled (uses OpenCost's own scraper).
  # For a cluster that already has Prometheus (from Chapter 4), use install-opencost.sh
  # which connects OpenCost to the existing Prometheus instance instead.
  helm repo add opencost https://opencost.github.io/opencost-helm-chart 2>/dev/null || true
  helm repo update > /dev/null

  helm upgrade --install opencost opencost/opencost \
    --namespace "${OPENCOST_NAMESPACE}" \
    --set opencost.ui.enabled=true \
    --set opencost.exporter.defaultClusterId="${CLUSTER}" \
    --set opencost.prometheus.internal.enabled=false \
    --set opencost.metrics.serviceMonitor.enabled=false \
    --wait --timeout=5m

  info "OpenCost installed."
fi

# Port-forward the OpenCost API in the background
info "Opening port-forward to OpenCost API on port ${OPENCOST_PORT}..."
# Kill any existing port-forward for this port
pkill -f "port-forward.*${OPENCOST_PORT}" 2>/dev/null || true
sleep 1

kubectl port-forward -n "${OPENCOST_NAMESPACE}" \
  svc/opencost "${OPENCOST_PORT}:${OPENCOST_PORT}" \
  > /tmp/opencost-pf.log 2>&1 &

PF_PID=$!
echo "${PF_PID}" > /tmp/opencost-pf.pid

# Wait for port-forward to be ready
info "Waiting for OpenCost API to respond..."
for i in $(seq 1 20); do
  if curl -sf "http://localhost:${OPENCOST_PORT}/allocation?window=1h" > /dev/null 2>&1; then
    info "OpenCost API is responding."
    break
  fi
  if [ "$i" -eq 20 ]; then
    warn "OpenCost API not responding yet — it may need a few more minutes to collect data."
    warn "Re-run: kubectl port-forward -n ${OPENCOST_NAMESPACE} svc/opencost ${OPENCOST_PORT}:${OPENCOST_PORT}"
  fi
  sleep 3
done

# ── Step 4: Deploy sample workload ───────────────────────────────────────────
info "Step 4/5: Deploying sample checkout-api workload..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if kubectl get deployment checkout-api > /dev/null 2>&1; then
  info "checkout-api already deployed — skipping."
else
  if [ -f "${SCRIPT_DIR}/checkout-api-hpa.yaml" ]; then
    kubectl apply -f "${SCRIPT_DIR}/checkout-api-hpa.yaml"
    info "Waiting for checkout-api to be ready..."
    kubectl rollout status deployment/checkout-api --timeout=3m
  else
    warn "checkout-api-hpa.yaml not found at ${SCRIPT_DIR}/checkout-api-hpa.yaml"
    warn "Skipping workload deployment — deploy your own application before the exercise."
  fi
fi

# ── Step 5: Capture baseline cost ────────────────────────────────────────────
info "Step 5/5: Capturing baseline cost snapshot..."

# Allow OpenCost a moment to scrape initial data
sleep 5

BASELINE=$(curl -sf \
  "http://localhost:${OPENCOST_PORT}/allocation/compute?window=1d&aggregate=namespace" \
  2>/dev/null || echo "")

if [ -z "${BASELINE}" ]; then
  warn "OpenCost has not yet collected enough data for a baseline (needs ~5 minutes)."
  warn "After a few minutes, run this to get your baseline:"
  echo ""
  echo "  curl -s 'http://localhost:${OPENCOST_PORT}/allocation/compute?window=1d&aggregate=namespace' \\"
  echo "    | jq '.data[0][\"default\"] | {cpuCost, ramCost, totalCost}'"
  echo ""
  warn "Record the totalCost. Your 30%% reduction target = totalCost * 0.70"
else
  echo "${BASELINE}" > "${BASELINE_FILE}"
  TOTAL=$(echo "${BASELINE}" | jq -r '.data[0]["default"].totalCost // "N/A"' 2>/dev/null || echo "N/A")

  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Exercise 12.1 — Baseline Cost Snapshot"
  echo "═══════════════════════════════════════════════════════"
  echo "  Cluster     : ${CLUSTER}"
  echo "  Window      : 1 day"
  echo "  Namespace   : default"
  if [ "${TOTAL}" != "N/A" ]; then
    TARGET=$(echo "${TOTAL} * 0.70" | bc -l 2>/dev/null || echo "N/A")
    echo "  Total cost  : \$${TOTAL}"
    echo "  Target (−30%%): \$${TARGET}"
  else
    echo "  Full baseline saved to: ${BASELINE_FILE}"
  fi
  echo "═══════════════════════════════════════════════════════"
  echo ""
  info "Full baseline saved to: ${BASELINE_FILE}"
  info "Reference this number throughout the exercise."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Setup Complete — Next Steps"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  OpenCost UI:  kubectl port-forward -n ${OPENCOST_NAMESPACE} svc/opencost 9090:9090"
echo "                http://localhost:9090"
echo ""
echo "  Cost API:     http://localhost:${OPENCOST_PORT}/allocation/compute?window=1d&aggregate=namespace"
echo ""
echo "  kubectl top:  kubectl top pods"
echo "                kubectl top nodes"
echo ""
echo "  To stop the background port-forward:"
echo "    kill \$(cat /tmp/opencost-pf.pid)"
echo ""
echo "  Exercise goal: reduce totalCost by 30%% without violating your SLO."
echo "  Levers: HPA tuning, VPA right-sizing, Spot instances via Karpenter."
echo "  Tools:  checkout-api-hpa.yaml, checkout-api-vpa.yaml, karpenter-provisioner.yaml"
echo ""
