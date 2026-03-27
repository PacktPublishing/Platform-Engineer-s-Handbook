/**
 * keycloak-oidc-module.ts
 * Chapter 6 — Backstage OIDC Backend Module for Keycloak
 *
 * Backstage's new backend system requires that each auth provider
 * is registered as a backend module. This file registers the OIDC
 * provider under the ID 'oidc', which matches the app-config.yaml
 * auth.providers.oidc configuration.
 *
 * Add this file to: packages/backend/src/
 * Import and register it in: packages/backend/src/index.ts
 *
 * Install the required package:
 *   yarn --cwd packages/backend add @backstage/plugin-auth-backend-module-oidc-provider
 *
 * Reference: https://backstage.io/docs/auth/oidc/
 */

import { createBackendModule } from '@backstage/backend-plugin-api';
import { authProvidersExtensionPoint } from '@backstage/plugin-auth-node';
import {
  oidcAuthenticator,
  createOidcProvider,
} from '@backstage/plugin-auth-backend-module-oidc-provider';

/**
 * Backend module that registers Keycloak as an OIDC auth provider.
 *
 * In app-config.yaml this maps to:
 *   auth.providers.oidc.production.metadataUrl: <keycloak-realm-url>
 *   auth.signInPage: oidc
 */
export const keycloakOidcModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'keycloak-oidc',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'oidc',
          factory: createOidcProvider({
            // Sign-in resolver: match the Keycloak email claim to the
            // catalog User entity's email field.
            // Ensure groups and users are imported into the catalog first
            // (org.yaml ingestion) so that ownership references resolve.
            signIn: {
              resolver: async (info, ctx) => {
                const { profile } = info;
                if (!profile.email) {
                  throw new Error('OIDC login requires an email claim');
                }
                return ctx.signInWithCatalogUser({
                  filter: {
                    kind: 'User',
                    'spec.profile.email': profile.email,
                  },
                });
              },
            },
          }),
        });
      },
    });
  },
});
