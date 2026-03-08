# Chapter 14: Agentic and AI-Augmented Platforms

## Overview

This chapter builds AI-augmented tooling for platform engineering — agents that triage incidents, answer documentation questions, enforce safety guardrails, and measure their own impact. Every script runs locally with mock data by default; add an API key to connect a real LLM.

**What you'll build:**
- A RAG pipeline that indexes platform docs and answers questions using ChromaDB + an LLM
- An incident triage agent that correlates alerts, logs, and deployments to find root causes
- A multi-agent system (investigate → plan → execute) with human-in-the-loop approval gates
- A guardrails framework that enforces action allowlists, confidence thresholds, and audit logging
- Prometheus metrics and alerting rules for monitoring AI agent health
- An impact measurement script comparing AI-assisted vs. manual incident response

---

## Prerequisites

**Python 3.10+** and a virtual environment:

```bash
cd Ch14
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip3 install -r requirements.txt
```

> On Linux without a venv, add `--break-system-packages` to the pip command.

**LLM Configuration (optional):** All scripts fall back to mock LLM responses when no API key is set. To use a real LLM:

```bash
# Option A: Anthropic Claude (recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# Option B: Local LLM with Ollama (no API key needed)
# Install from https://ollama.ai, then:
ollama pull mistral && ollama serve
```

If you set up Bitwarden in Chapter 1, `source load-secrets.sh` pulls the keys from your vault automatically.

**Docker Desktop + Kind cluster** (for Steps 7–8 only — not needed for Python scripts):

> If you are jumping into this chapter without running earlier chapters, you need Docker Desktop running and a Kind cluster with the Prometheus Operator installed. If you already have these from a prior chapter, skip ahead.

```bash
# 1. Start Docker Desktop (macOS: open from Applications or Spotlight)
open -a "Docker"
# Wait for the whale icon in the menu bar to stop animating

# 2. Create a Kind cluster (skip if you already have one)
kind get clusters                       # Check for existing clusters
kind create cluster --name platform-dev # Create one if none listed

# 3. Verify the cluster is reachable
kubectl get nodes                       # Should show node(s) in Ready state

# 4. Install Prometheus Operator (needed for ai-governance-alerts.yaml)
kubectl create namespace monitoring
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --wait

# 5. Confirm monitoring stack is running
kubectl get pods -n monitoring          # All pods should be Running
```

---

## File Map

| File | What It Does |
|------|-------------|
| `platform_chatbot/rag_pipeline.py` | RAG system: loads docs → embeds in ChromaDB → retrieves context → generates LLM answers |
| `rag-platform-docs.py` | Lightweight TF-IDF retrieval alternative (no embeddings, no API key needed) |
| `platform_chatbot/incident_triage.py` | Correlates error spikes, deployments, and latency signals to identify root causes |
| `alert-correlator.py` | Groups related alerts by time window and metric similarity, reduces noise |
| `incident-agent.py` | Three-agent pipeline: triage → diagnosis → remediation proposal |
| `agents/multi_agent_system.py` | Supervisor pattern: Investigation → Planning → Execution with approval gates |
| `ai-guardrails.py` | Action allowlists, confidence thresholds, approval workflows, audit logging |
| `ai_governance/observability.py` | Prometheus metrics: latency, confidence, override rates, error tracking |
| `ai-governance-alerts.yaml` | PrometheusRule with 7 alerts + SLOs for AI agent health |
| `runbook-automator.py` | Parses markdown runbooks into executable steps with safety validation |
| `measure-ai-impact.py` | Compares MTTR, triage speed, and diagnosis time (AI-assisted vs. manual) |
| `backstage-ai-template.yaml` | Backstage scaffolder template for AI-generated microservice configs |
| `test-ai-agents.py` | Unit tests validating all modules |
| `load-secrets.sh` | Loads ANTHROPIC_API_KEY from Bitwarden vault |

---

## Step-by-Step Instructions

### Step 1: RAG Pipeline — Index and Query Platform Docs

The RAG pipeline loads documentation, creates embeddings, stores them in ChromaDB, and uses an LLM to synthesize answers from retrieved context.

```bash
python3 platform_chatbot/rag_pipeline.py
```

**What happens:** The script indexes sample platform docs (deployment guide, troubleshooting, scaling), then queries "How do I deploy to production?" — retrieving relevant chunks and generating an answer.

**Expected output:**
```
RAG Pipeline initialized (mock mode - no API key)
Indexed 5 documents (15 chunks)
Query: How do I deploy to production?
Retrieved 3 relevant chunks (similarity > 0.6)
Answer: Based on the Deployment Guide: build image, push to registry, deploy with Helm...
Retrieval time: 45ms
```

> **With a real LLM:** Set `ANTHROPIC_API_KEY` and re-run. The pipeline switches from mock to real embeddings and LLM synthesis automatically.

For a zero-dependency alternative, `rag-platform-docs.py` uses TF-IDF retrieval instead of vector embeddings:

```bash
python3 rag-platform-docs.py
```

---

### Step 2: Incident Triage — Correlate Signals and Find Root Causes

The triage agent takes an incident with multiple signals (error rate spike, recent deployment, latency increase) and identifies the most likely root cause.

```bash
python3 platform_chatbot/incident_triage.py
```

**What happens:** Processes a payment service incident with two signals — an error rate spike (25.5%, threshold 5%) and a recent deployment (revision 42). The agent correlates these signals, identifies "recent deployment caused regression" as root cause with 85% confidence, and recommends rollback steps.

**Expected output:**
```
Incident ID: INC-A7F3D2E1
Root Cause: Recent deployment caused regression
Confidence: 85%
Affected: deployment_service
Runbook: Check logs → Verify deployments → Rollback
```

The alert correlator groups related alerts by time proximity and metric similarity:

```bash
python3 alert-correlator.py
```

**Expected output:** 5 raw alerts → grouped into 2 correlated incidents with root cause analysis (resource constraint on api-server, database connection pool exhaustion).

---

### Step 3: Multi-Agent System — Orchestrated Remediation

Four agents work together: Investigation (read-only data gathering) → Planning (create remediation plan) → Execution (run approved steps) → Supervisor (coordinates and enforces approval gates).

```bash
python3 agents/multi_agent_system.py
```

**What happens:** The supervisor receives a `pod_crash_loop` issue. The investigation agent checks pod status and logs, the planning agent creates a remediation plan (increase memory), and the execution agent flags it as requiring human approval since it's a resource modification.

**Expected output:**
```
=== Multi-Agent Kubernetes Operations Demo ===
[InvestigationAgent] Investigating pod_crash_loop...
  Findings: High restart count, OOMKilled status
  Confidence: 0.95

[PlanningAgent] Creating remediation plan...
  Step 1: update_resource_requests (requires approval: true)

[ExecutionAgent] Step requires human approval — queued
  Action: update_resource_requests
  Rollback: revert_resource_requests

Audit Trail:
  10:30:45 InvestigationAgent: investigated pod_crash_loop → success
  10:30:47 PlanningAgent: created plan → success
  10:30:49 ExecutionAgent: queued for approval → pending
```

**Key pattern:** Read-only investigation runs autonomously. Destructive or state-changing actions are blocked until a human approves — this is the supervision pattern from the chapter.

---

### Step 4: AI Guardrails — Safety Constraints in Code

The guardrails framework enforces what each agent type can do. Guardrails are deterministic (code, not prompts) — an agent cannot talk its way past them.

```bash
python3 ai-guardrails.py
```

**What happens:** Tests five scenarios at increasing severity levels — from read-only log access (auto-approved) to a critical action at low confidence (blocked with two violations: insufficient confidence + requires approval).

**Expected output:**
```
=== AI Guardrails Demo ===

Test 1: READONLY - get_logs (confidence: 0.90)
  Result: SAFE — auto-approved

Test 2: LOW - acknowledge_alert (confidence: 0.80)
  Result: SAFE — auto-approved

Test 3: MEDIUM - restart_service (confidence: 0.85)
  Result: REQUIRES APPROVAL — queued for human review

Test 4: HIGH - deploy_version (confidence: 0.90)
  Result: REQUIRES APPROVAL — queued for human review

Test 5: CRITICAL - delete_namespace (confidence: 0.60)
  Result: BLOCKED — 2 violations
    - Confidence 0.60 below threshold 0.95 for critical actions
    - Critical actions always require human approval
```

**Severity tiers and confidence thresholds:**

| Severity | Confidence Required | Approval |
|----------|-------------------|----------|
| READONLY | 0.0 | Autonomous |
| LOW | 0.6 | Autonomous |
| MEDIUM | 0.75 | Human required |
| HIGH | 0.85 | Human required |
| CRITICAL | 0.95 | Always human |

---

### Step 5: Incident Agent Pipeline — Triage → Diagnosis → Remediation

A three-stage pipeline where each agent has a distinct role: triage classifies severity, diagnosis identifies root cause, remediation proposes actions with risk assessment.

```bash
python3 incident-agent.py
```

**What happens:** Processes three incidents — a CPU spike (infrastructure), database connection pool exhaustion, and a security breach. Each goes through triage → diagnosis → remediation proposal. The security breach triggers automatic escalation.

**Expected output (3 incidents):**
```
Incident 1: CPU spike on api-server
  Triage: critical / infrastructure (confidence: 0.95)
  Diagnosis: CPU saturation — scale horizontally
  Remediation: scale_deployment (risk: medium, approval: required)

Incident 2: Database connection pool exhausted
  Triage: high / database (confidence: 0.80)
  Diagnosis: Connection leak — restart connection pool
  Remediation: restart_service (risk: medium, approval: required)

Incident 3: Unauthorized access attempt
  Triage: critical / security (confidence: 0.95, ESCALATION REQUIRED)
  Diagnosis: Security breach — block source IP
  Remediation: manual intervention (risk: high, approval: required)
```

---

### Step 6: Observability — Prometheus Metrics for AI Agents

Deploy Prometheus alerting rules that monitor AI agent health: confidence scores, override rates, error rates, and latency.

```bash
kubectl apply -f ai-governance-alerts.yaml
kubectl get prometheusrule -n monitoring ai-governance-alerts
```

**Expected output:**
```
NAME                    AGE
ai-governance-alerts    5s
```

The rules include 7 alerts (LowAIConfidence, HighHumanOverrideRate, AIAgentErrors, AILatencyHigh, etc.) and SLO targets: >99% success rate, <5% override rate, <1% error rate, <5s p99 latency.

To see the Python metrics instrumentation:

```bash
python3 ai_governance/observability.py
```

This demonstrates the `@track_agent_call` decorator that automatically records latency, confidence, and error rates to Prometheus counters and histograms.

---

### Step 7: Measure AI Impact — Before/After Comparison

Quantify the business impact of AI-augmented operations by comparing MTTR, triage speed, and diagnosis time.

```bash
python3 measure-ai-impact.py
```

**Expected output:**
```
=== AI Impact Analysis (Demo Data) ===

MTTR (Mean Time to Resolution):
  Manual:      ~90 minutes
  AI-Assisted: ~30 minutes
  Improvement: ~67%

Triage Speed (Alert → Acknowledgment):
  Manual:      ~12 minutes
  AI-Assisted: ~3 minutes
  Improvement: ~75%

Diagnosis Speed (Ack → Root Cause):
  Manual:      ~45 minutes
  AI-Assisted: ~12 minutes
  Improvement: ~73%
```

---

### Step 8: Runbook Automation — Safe Execution with Approval Gates

The runbook automator parses markdown runbooks into executable steps, validates each for safety (detects destructive keywords like `kill`, `rm`, `delete`), and blocks unsafe steps until approved.

```bash
python3 runbook-automator.py
```

**Expected output:** Parses a 7-step database recovery runbook. Diagnostic steps (read-only) execute automatically. Action steps with destructive commands are flagged and queued for approval.

---

### Step 9: Run Tests

```bash
python3 test-ai-agents.py -v
```

**Expected output:**
```
test_guardrails_defines_action_allowlist ... ok
test_guardrails_has_human_approval ... ok
test_correlator_handles_empty_alerts ... ok
test_incident_agent_has_role_separation ... ok
test_automator_has_safety_checks ... ok
test_rag_valid_python ... ok

Ran 6 tests in 0.23s
OK
```

---

## Architecture Patterns

**Pattern 1 — RAG Pipeline:**
Query → Embed → Vector similarity search → Retrieved context → LLM + context → Grounded answer. Use for documentation, runbook selection, knowledge-based responses.

**Pattern 2 — Multi-Agent Supervision:**
Task → Investigation (read-only) → Planning → Risk check → Low risk: execute autonomously / High risk: request human approval → Audit log. Use for incident remediation, infrastructure automation.

**Pattern 3 — Guardrails in Code:**
Action request → Check allowlist → Check confidence threshold → Check rate limits → Auto-approve or queue for human. Guardrails are deterministic code, not LLM prompts — an agent cannot bypass them.

---

## Troubleshooting

**"ModuleNotFoundError: No module named 'langchain'"** — Activate your venv (`source venv/bin/activate`) and install dependencies.

**Scripts show "mock mode" output** — This is expected without an API key. Set `ANTHROPIC_API_KEY` to use a real LLM.

**"No module named 'chromadb'"** — `pip3 install chromadb` (or `--break-system-packages` on Linux).

**PrometheusRule not created** — Ensure the monitoring stack is running: `kubectl get pods -n monitoring`.

---

**Author:** Ajay Chankramath (ajay@platformetrics.com)
**Book:** The Platform Engineer's Handbook (Packt Publishing)
**Last Updated**: March 2026
