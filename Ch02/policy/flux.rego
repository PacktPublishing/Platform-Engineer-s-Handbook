# =============================================================================
# policy/flux.rego — OPA Policy: Deployment Governance
# =============================================================================
# Rego policies evaluated by conftest before manifests are committed to the
# GitOps repository. Run as part of the pre-merge CI step to catch
# misconfigurations before they reach any cluster.
#
# Usage (in CI pipeline):
#   conftest test environments/ --policy policy/
#   conftest test smoke/        --policy policy/
#
# Install conftest: brew install open-policy-agent/tap/conftest
# Reference: https://www.conftest.dev / https://www.openpolicyagent.org/docs/latest/
# =============================================================================

package main

# ── Rule 1: Deny :latest image tags ──────────────────────────────────────────
# Unpinned :latest tags cause non-reproducible deployments: the image that
# runs in sandbox may differ from what runs in production.

deny contains msg if {
  input.kind == "Deployment"
  some i
  endswith(input.spec.template.spec.containers[i].image, ":latest")
  msg := sprintf(
    "Deployment %s uses :latest tag in container %s — pin to an explicit version",
    [input.metadata.name, input.spec.template.spec.containers[i].name],
  )
}

# Also apply to init containers
deny contains msg if {
  input.kind == "Deployment"
  some i
  endswith(input.spec.template.spec.initContainers[i].image, ":latest")
  msg := sprintf(
    "Deployment %s uses :latest tag in initContainer %s — pin to an explicit version",
    [input.metadata.name, input.spec.template.spec.initContainers[i].name],
  )
}

# ── Rule 2: Deny deployments to unauthorized namespaces ──────────────────────
# Restrict workloads to approved namespaces to enforce multi-tenancy boundaries.

deny contains msg if {
  input.kind == "Deployment"
  allowed_namespaces := {"app-dev", "app-qa", "app-prod", "platform-sandbox"}
  not allowed_namespaces[input.metadata.namespace]
  msg := sprintf(
    "Deployment %s targets unauthorized namespace: %s",
    [input.metadata.name, input.metadata.namespace],
  )
}

# ── Rule 3: Require resource limits on all containers ────────────────────────
# Missing resource limits prevent the scheduler from making optimal placement
# decisions and can allow one workload to starve others (noisy neighbour).

deny contains msg if {
  input.kind == "Deployment"
  some i
  container := input.spec.template.spec.containers[i]
  not container.resources.limits.cpu
  msg := sprintf(
    "Container %s in Deployment %s is missing a CPU limit",
    [container.name, input.metadata.name],
  )
}

deny contains msg if {
  input.kind == "Deployment"
  some i
  container := input.spec.template.spec.containers[i]
  not container.resources.limits.memory
  msg := sprintf(
    "Container %s in Deployment %s is missing a memory limit",
    [container.name, input.metadata.name],
  )
}

# ── Rule 4: Deny HelmRelease with floating chart versions ────────────────────
# Wildcard version specifiers (e.g. v2.*.*) make upgrades unpredictable.
# Every HelmRelease must pin an explicit semver string.

deny contains msg if {
  input.kind == "HelmRelease"
  version := input.spec.chart.spec.version
  contains(version, "*")
  msg := sprintf(
    "HelmRelease %s uses a floating chart version '%s' — specify an exact semver",
    [input.metadata.name, version],
  )
}

deny contains msg if {
  input.kind == "HelmRelease"
  version := input.spec.chart.spec.version
  startswith(version, ">=")
  msg := sprintf(
    "HelmRelease %s uses a range version '%s' — specify an exact semver",
    [input.metadata.name, version],
  )
}

# ── Rule 5: Require standard labels on Deployments ───────────────────────────
# Labels enable cost attribution, ownership tracking, and selector-based ops.

required_labels := {"app", "owner", "env"}

deny contains msg if {
  input.kind == "Deployment"
  some label in required_labels
  not input.metadata.labels[label]
  msg := sprintf(
    "Deployment %s is missing required label: %s",
    [input.metadata.name, label],
  )
}
