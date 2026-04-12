# conftest Rego Policies for Shift-Left Validation
# These policies validate Kubernetes manifests before deployment
# Run with: conftest test -p policy.rego *.yaml

package main

import rego.v1

# Require resource limits on all containers
deny contains msg if {
    container := input.spec.containers[_]
    not container.resources.limits.cpu
    msg := sprintf("Container '%v' missing CPU limits", [container.name])
}

deny contains msg if {
    container := input.spec.containers[_]
    not container.resources.limits.memory
    msg := sprintf("Container '%v' missing memory limits", [container.name])
}

deny contains msg if {
    container := input.spec.containers[_]
    not container.resources.requests.cpu
    msg := sprintf("Container '%v' missing CPU requests", [container.name])
}

deny contains msg if {
    container := input.spec.containers[_]
    not container.resources.requests.memory
    msg := sprintf("Container '%v' missing memory requests", [container.name])
}

# Warn on latest image tag (better: use specific versions)
warn contains msg if {
    container := input.spec.containers[_]
    endswith(container.image, ":latest")
    msg := sprintf("Container '%v' uses ':latest' tag (use specific versions)", [container.name])
}

# Deny privileged containers
deny contains msg if {
    container := input.spec.containers[_]
    container.securityContext.privileged == true
    msg := sprintf("Container '%v' cannot run in privileged mode", [container.name])
}

# Require non-root user
deny contains msg if {
    container := input.spec.containers[_]
    container.securityContext.runAsUser == 0
    msg := sprintf("Container '%v' cannot run as root (UID 0)", [container.name])
}

# Require readOnlyRootFilesystem for security
warn contains msg if {
    container := input.spec.containers[_]
    container.securityContext.readOnlyRootFilesystem != true
    msg := sprintf("Container '%v' should set readOnlyRootFilesystem to true", [container.name])
}

# Require allowPrivilegeEscalation disabled
deny contains msg if {
    container := input.spec.containers[_]
    container.securityContext.allowPrivilegeEscalation != false
    msg := sprintf("Container '%v' must set allowPrivilegeEscalation to false", [container.name])
}

# Require specific image registries
deny contains msg if {
    container := input.spec.containers[_]
    not allowed_registry(container.image)
    msg := sprintf("Container '%v' image not from allowed registry: %v", [container.name, container.image])
}

allowed_registry(image) if {
    registries := ["gcr.io/", "quay.io/", "docker.io/library/", "k8s.gcr.io/"]
    startswith(image, registries[_])
}

# Require mandatory labels — workload resources only
# ConstraintTemplates, CRDs, and other non-workload resources are excluded.
workload_kinds := {"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"}

deny contains msg if {
    workload_kinds[input.kind]
    not input.metadata.labels.team
    msg := sprintf("%v missing 'team' label", [input.kind])
}

deny contains msg if {
    workload_kinds[input.kind]
    not input.metadata.labels.owner
    msg := sprintf("%v missing 'owner' label", [input.kind])
}

deny contains msg if {
    workload_kinds[input.kind]
    not input.metadata.labels["cost-center"]
    msg := sprintf("%v missing 'cost-center' label", [input.kind])
}

# Warn on missing containers — workload resources only
warn contains msg if {
    workload_kinds[input.kind]
    not input.spec.containers
    msg := sprintf("%v spec missing containers", [input.kind])
}
