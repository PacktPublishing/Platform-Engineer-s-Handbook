/**
 * services/teamService.js
 * Chapter 7 — Self-Service Team Onboarding
 *
 * Implements the Service layer of the Controller → Service → Repository
 * pattern. The class receives injected service clients via its constructor,
 * making each dependency explicit and testable.
 *
 * Dependencies injected at construction time:
 *   authzService   — permission check (OPA/RBAC)
 *   k8sService     — Kubernetes namespace, RBAC, quota operations
 *   gitService     — GitHub/GitLab repository creation
 *   catalogService — Backstage catalog registration
 *
 * Full companion code: https://github.com/peh-book/ch7
 */

'use strict';

const k8s = require('@kubernetes/client-node');
const { Octokit } = require('@octokit/rest');

// --- Default service clients (used when no injection is provided) ---
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi      = kc.makeApiClient(k8s.CoreV1Api);
const k8sRbacApi  = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
const octokit     = new Octokit({ auth: process.env.GITHUB_TOKEN });

class TeamService {
  /**
   * Construct a TeamService with injected service clients.
   * All four dependencies are required. In tests, pass mock implementations.
   *
   * @param {Object} opts
   * @param {Object} opts.authzService  — exposes requirePermission(user, permission)
   * @param {Object} opts.k8sService    — exposes createNamespace, applyTeamRBAC, applyResourceQuota
   * @param {Object} opts.gitService    — exposes createRepository(teamRequest)
   * @param {Object} opts.catalogService — exposes registerTeam(teamRequest, namespace, repo)
   */
  constructor({ authzService, k8sService, gitService, catalogService } = {}) {
    this.authzService   = authzService   || defaultAuthzService;
    this.k8sService     = k8sService     || defaultK8sService;
    this.gitService     = gitService     || defaultGitService;
    this.catalogService = catalogService || defaultCatalogService;
  }

  /**
   * Create a complete team environment:
   *   1. Validate the requester has platform:teams:create permission
   *   2. Create a Kubernetes namespace with team labels
   *   3. Apply RBAC roles and resource quota
   *   4. Create the team's source repository
   *   5. Register the team in the Backstage catalog
   *
   * All steps are idempotent — retrying on failure is safe.
   *
   * @param {Object} teamRequest
   * @param {string} teamRequest.name     — team slug (e.g. "team-beta")
   * @param {string} teamRequest.tier     — "starter" | "standard" | "enterprise"
   * @param {Array}  teamRequest.members  — list of member email addresses
   * @param {Object} requestingUser       — { email, id } of the user making the request
   * @returns {Promise<{namespace, repo, status}>}
   */
  async createTeam(teamRequest, requestingUser) {
    // 1. Validate the requester has permission
    await this.authzService.requirePermission(
      requestingUser,
      'platform:teams:create'
    );

    // 2. Create namespace with labels
    //    teamRequest.name is the team slug (e.g. "team-beta"), validated by
    //    the controller as lowercase alphanumeric + hyphens, max 63 chars.
    const namespace = await this.k8sService.createNamespace({
      name: `team-${teamRequest.name}`,
      labels: {
        'platform.io/team':       teamRequest.name,
        'platform.io/owner':      requestingUser.email,
        'platform.io/created-by': 'onboarding-api',
      },
    });

    // 3. Apply RBAC roles and resource quota for the tier
    await this.k8sService.applyTeamRBAC(namespace, teamRequest.members);
    await this.k8sService.applyResourceQuota(namespace, teamRequest.tier);

    // 4. Create source repository
    const repo = await this.gitService.createRepository(teamRequest);

    // 5. Register in the Backstage catalog
    await this.catalogService.registerTeam(teamRequest, namespace, repo);

    return { namespace, repo, status: 'provisioning' };
  }
}

// ---------------------------------------------------------------------------
// Default service implementations — these use the real K8s and GitHub APIs.
// In unit tests, replace with mocks via the constructor.
// ---------------------------------------------------------------------------

const defaultAuthzService = {
  async requirePermission(user, permission) {
    // In production, delegate to OPA or your RBAC backend.
    // Throws an Error if the user lacks the permission.
    if (!user || !user.email) {
      throw new Error(`Permission denied: unauthenticated request for ${permission}`);
    }
    // Stub: in a real implementation, call your policy engine here.
  },
};

const defaultK8sService = {
  async createNamespace({ name, labels }) {
    try {
      await k8sApi.readNamespace(name);
      console.log(`Namespace ${name} already exists (idempotent).`);
      return name;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
    await k8sApi.createNamespace({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name, labels },
    });
    console.log(`Created namespace: ${name}`);
    return name;
  },

  async applyTeamRBAC(namespace, members) {
    const roleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: `${namespace}-team-binding`, namespace },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind:     'ClusterRole',
        name:     'team-developer',
      },
      subjects: members.map(email => ({
        kind:     'User',
        name:     email,
        apiGroup: 'rbac.authorization.k8s.io',
      })),
    };
    try {
      await k8sRbacApi.readNamespacedRoleBinding(`${namespace}-team-binding`, namespace);
      console.log(`RoleBinding for ${namespace} already exists (idempotent).`);
    } catch (err) {
      if (err.statusCode === 404) {
        await k8sRbacApi.createNamespacedRoleBinding(namespace, roleBinding);
        console.log(`Created RoleBinding for ${namespace}`);
      } else throw err;
    }
  },

  async applyResourceQuota(namespace, tier) {
    const quotas = {
      starter:    { 'requests.cpu': '2',  'requests.memory': '4Gi',  pods: '10'  },
      standard:   { 'requests.cpu': '8',  'requests.memory': '16Gi', pods: '50'  },
      enterprise: { 'requests.cpu': '32', 'requests.memory': '64Gi', pods: '200' },
    };
    const quota = {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: `${namespace}-quota`, namespace },
      spec: { hard: quotas[tier] || quotas.starter },
    };
    try {
      await k8sApi.readNamespacedResourceQuota(`${namespace}-quota`, namespace);
      console.log(`ResourceQuota for ${namespace} already exists (idempotent).`);
    } catch (err) {
      if (err.statusCode === 404) {
        await k8sApi.createNamespacedResourceQuota(namespace, quota);
      } else throw err;
    }
  },
};

const defaultGitService = {
  async createRepository(teamRequest) {
    const owner   = process.env.GITHUB_ORG;
    const repoName = `team-${teamRequest.name}`;
    try {
      await octokit.repos.get({ owner, repo: repoName });
      console.log(`Repo ${owner}/${repoName} already exists (idempotent).`);
    } catch (err) {
      if (err.status === 404) {
        await octokit.repos.createInOrg({
          org:         owner,
          name:        repoName,
          private:     true,
          description: `Repository for team: ${teamRequest.name}`,
        });
        console.log(`Created repo: ${owner}/${repoName}`);
      } else throw err;
    }
    return { owner, name: repoName, url: `https://github.com/${owner}/${repoName}` };
  },
};

const defaultCatalogService = {
  async registerTeam(teamRequest, namespace, repo) {
    // In production, POST to your Backstage backend catalog API.
    // For the companion demo, this is handled by catalog-info.yaml in the repo.
    console.log(`Catalog registration queued for team: ${teamRequest.name}`);
  },
};

module.exports = { TeamService };
