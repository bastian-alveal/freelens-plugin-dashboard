import React from "react";
import { Common, Renderer } from "@freelensapp/extensions";
import { FleetDashboard } from "./components/FleetDashboard";
import "./styles.css";

class FleetCategory extends Common.Catalog.CatalogCategory {
  apiVersion = "catalog.k8slens.dev/v1alpha1";
  kind = "CatalogCategory";
  metadata = {
    name: "Fleet Dashboard",
    icon: "dashboard",
  };
  spec = {
    group: "entity.freelens.app",
    versions: [],
    names: {
      kind: "FleetDashboard",
    },
  };
}

class FleetEntity extends Common.Catalog.CatalogEntity {
  apiVersion = "entity.freelens.app/v1alpha1";
  kind = "FleetDashboard";

  constructor() {
    super({
      metadata: {
        uid: "fleet-dashboard-entity",
        name: "Fleet Dashboard",
        source: "local",
        shortName: "FD",
        labels: {},
      },
      status: {
        phase: "active",
        enabled: true,
      },
      spec: {
        path: "/extension/freelens-fleet-dashboard/fleet",
        icon: {
          material: "dashboard",
          background: "#3182ce",
        },
      },
    });
  }

  async onRun(context: any) {
    if (context && typeof context.navigate === "function") {
      context.navigate(this.spec.path);
    }
  }
}

// Fleet Icon for sidebar
const FleetIcon: React.FC = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
};

export default class FleetDashboardRenderer extends Renderer.LensExtension {
  private fleetCategory = new FleetCategory();
  private fleetEntity?: FleetEntity;

  async onActivate() {
    console.log("[FleetDashboard] Extension Renderer process activated");
    // 1. Register Fleet Dashboard as a first-class Catalog Category alongside Clusters, Web Links, General
    try {
      Renderer.Catalog.catalogCategories.add(this.fleetCategory);
      console.log("[FleetDashboard] Catalog Category registered successfully in Renderer");
    } catch (err) {
      console.warn("[FleetDashboard] Could not register Catalog Category in Renderer:", err);
    }

    // 2. Register Fleet Dashboard Catalog Entity so that clicks from Hotbar (Dock) route to /extension/freelens-fleet-dashboard/fleet
    try {
      this.fleetEntity = new FleetEntity();
      (this as any).addCatalogSource("fleet-dashboard-source", {
        get: () => (this.fleetEntity ? [this.fleetEntity] : []),
      } as any);
      console.log("[FleetDashboard] Catalog Source registered successfully in Renderer");
    } catch (err) {
      console.warn("[FleetDashboard] Could not register Catalog Source in Renderer:", err);
    }
  }

  // 1. Sidebar menu inside cluster view
  clusterPageMenus = [
    {
      id: "fleet-dashboard-menu",
      title: "Fleet Dashboard",
      target: {
        pageId: "cluster-fleet",
      },
      components: {
        Icon: FleetIcon,
      },
    },
  ];

  // 2. Page component when rendered inside a cluster frame
  clusterPages = [
    {
      id: "cluster-fleet",
      components: {
        Page: () => <FleetDashboard extension={this} />,
      },
    },
  ];

  // 3. Standalone Global Full-Screen Page (Directly opened by Dock button)
  globalPages = [
    {
      id: "fleet",
      components: {
        Page: () => <FleetDashboard extension={this} />,
      },
    },
    {
      components: {
        Page: () => <FleetDashboard extension={this} />,
      },
    },
  ];

  // 4. Status Bar Button (Always visible at the bottom right of FreeLens)
  statusBarItems = [
    {
      components: {
        position: "right" as const,
        Item: () => (
          <div
            onClick={() => {
              this.navigate("fleet");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              padding: "0 10px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#63b3ed",
              userSelect: "none",
            }}
            title="Hacer clic para abrir el Dashboard Unificado Multiclúster"
          >
            <span>⚡ Fleet Dashboard</span>
          </div>
        ),
      },
    },
  ];

  // 5. Dedicated Catalog Category View (At the exact same level as Clusters, Web Links, General)
  customCategoryViews = [
    {
      group: "entity.freelens.app",
      kind: "FleetDashboard",
      priority: 10,
      components: {
        View: () => <FleetDashboard extension={this} />,
      },
    },
  ];
}
