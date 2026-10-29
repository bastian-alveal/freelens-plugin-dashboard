import { Common } from "@freelensapp/extensions";

export class FleetCategory extends Common.Catalog.CatalogCategory {
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
