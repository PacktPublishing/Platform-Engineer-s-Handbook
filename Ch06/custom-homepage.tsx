/**
 * custom-homepage.tsx
 * Chapter 6 — Custom Backstage Homepage using PageBlueprint API
 *
 * MIGRATION NOTE (DS35): createPageExtension from @backstage/frontend-plugin-api
 * is deprecated as of Backstage 1.28. Use PageBlueprint.make() instead.
 * See: https://github.com/backstage/backstage/issues/27962
 *
 * COMPONENT NOTE (DS36): KubernetesStatusCard and ServiceHealthCard below are
 * CUSTOM React components that wrap Backstage's standard InfoCard. They are not
 * shipped with Backstage out of the box. Build them in your own frontend plugin,
 * or replace them with standard Backstage catalog/kubernetes plugin components.
 *
 * Place this file in: packages/app/src/components/home/
 * Register it in:     packages/app/src/App.tsx (see comment at bottom of file)
 *
 * Full companion code: https://github.com/peh-book/ch6
 */

import React from 'react';
import { PageBlueprint } from '@backstage/frontend-plugin-api';
import { Grid } from '@material-ui/core';
import { InfoCard, Header, Page, Content } from '@backstage/core-components';

// ─── Custom components (build these in your own frontend plugin) ─────────────
// KubernetesStatusCard wraps the standard @backstage/plugin-kubernetes component
// to show cluster health for a specific namespace or label selector.
import { KubernetesStatusCard } from '../kubernetes/KubernetesStatusCard';

// ServiceHealthCard fetches the /health endpoint of a catalog Component
// and renders its current status inline on the homepage.
import { ServiceHealthCard } from '../serviceHealth/ServiceHealthCard';
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HomepageComponent — the React component rendered at the portal root.
 *
 * Gives developers immediate visibility into the pilot environment health
 * and demo application status without navigating through multiple screens.
 * As your platform matures, add CI/CD status, recent deployments, or
 * team announcements to this grid.
 */
const HomepageComponent = () => (
  <Page themeId="home">
    <Header title="Welcome to the Platform Portal" />
    <Content>
      <Grid container spacing={3}>
        {/* Row 1: Welcome banner */}
        <Grid item xs={12}>
          <InfoCard title="Welcome to My IDP">
            Your single pane of glass for the NewTech platform.
          </InfoCard>
        </Grid>

        {/* Row 2: Operational health — pilot Kubernetes environment */}
        <Grid item md={6} xs={12}>
          {/* Custom component — see note at top of file */}
          <KubernetesStatusCard title="Pilot Environment Status" />
        </Grid>

        {/* Row 2: Demo app health — surfaces the /health endpoint */}
        <Grid item md={6} xs={12}>
          {/* Custom component — see note at top of file */}
          <ServiceHealthCard serviceId="demo-app" />
        </Grid>
      </Grid>
    </Content>
  </Page>
);

/**
 * CustomHomepageBlueprint — registers the component as the portal homepage.
 *
 * PageBlueprint.make() replaces the deprecated createPageExtension() API.
 * Import and add this to your frontend plugin's extensions array.
 */
export const CustomHomepageBlueprint = PageBlueprint.make({
  params: {
    defaultPath: '/',
    loader: async () => <HomepageComponent />,
  },
});

/*
 * Registration in packages/app/src/App.tsx:
 *
 *   import { CustomHomepageBlueprint } from './components/home/custom-homepage';
 *
 *   // Add to your app's createApp extensions:
 *   createApp({
 *     features: [
 *       CustomHomepageBlueprint,
 *       // ... other features
 *     ],
 *   });
 */
