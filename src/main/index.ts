import { Common, Main } from "@freelensapp/extensions";
import { ipcMain } from "electron";
import { K8sCollector } from "./k8s-collector";
import { FleetStore } from "./fleet-store";
import { FleetCategory } from "../common/category";
import { HotbarService } from "./hotbar-service";

export default class FleetDashboardMain extends Main.LensExtension {
  private collector = K8sCollector.getInstance();
  private fleetStore = FleetStore.getInstance();
  private hotbarService = HotbarService.getInstance();
  private fleetCategory = new FleetCategory();

  async onActivate() {
    console.log("[FleetDashboard] Extension Main process activated");
    
    // 1. Register Fleet Dashboard as a first-class Catalog Category
    try {
      Main.Catalog.catalogCategories.add(this.fleetCategory);
    } catch (err) {
      console.warn("[FleetDashboard] Could not register Catalog Category in Main:", err);
    }

    // 2. Register Fleet Dashboard as a Catalog Entity so FreeLens can pin it to the Hotbar
    try {
      const fleetEntity = new Common.Catalog.GeneralEntity({
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

      this.addCatalogSource("fleet-dashboard-source", {
        get: () => [fleetEntity],
      } as any);
      console.log("[FleetDashboard] Registered Fleet Dashboard Catalog Entity");
    } catch (err) {
      console.warn("[FleetDashboard] Could not register Fleet Dashboard Catalog Entity:", err);
    }

    const extIpc = (Main.Ipc as any).createInstance(this);

    const resolvePayload = (a: any, b: any) => {
      if (b !== undefined) return b;
      if (a && typeof a === "object" && ("sender" in a || "senderFrame" in a || "processId" in a)) {
        return undefined;
      }
      return a;
    };

    const handleDiscover = async () => {
      try {
        return this.collector.discoverKubeconfigs();
      } catch (err: any) {
        console.error("[FleetDashboard] Error discovering kubeconfigs:", err);
        return [];
      }
    };

    const handleTelemetry = async (a: any, b: any) => {
      const targets = resolvePayload(a, b);
      try {
        const safeTargets = Array.isArray(targets) ? targets : [];
        const results = await Promise.allSettled(
          safeTargets.map((t) =>
            Promise.race([
              this.collector.collectFromKubeconfig(t),
              new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      id: t.id || "unknown",
                      name: t.name || "Cluster",
                      alias: t.alias,
                      serverUrl: "Inaccesible",
                      status: "unreachable",
                      k8sVersion: "N/A",
                      latencyMs: 0,
                      lastSync: new Date().toLocaleTimeString(),
                      errorMessage: "Tiempo de espera agotado (>6s). Clúster o VPN no responde.",
                      pods: { healthy: 0, failing: 0, pending: 0, terminating: 0, total: 0 },
                      unhealthyPods: [],
                      nodes: [],
                      services: {
                        total: 0,
                        byType: { ClusterIP: 0, NodePort: 0, LoadBalancer: 0, ExternalName: 0 },
                        orphanCount: 0,
                        orphanServices: [],
                      },
                      namespaces: [],
                    }),
                  6500
                )
              ),
            ])
          )
        );
        return results.map((r: any) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);
      } catch (err: any) {
        console.error("[FleetDashboard] Error fetching telemetry:", err);
        return [];
      }
    };

    const handleDrift = async (a: any, b: any) => {
      const { clusterA, clusterB } = resolvePayload(a, b) || {};
      try {
        return this.collector.calculateDrift(clusterA, clusterB);
      } catch (err: any) {
        console.error("[FleetDashboard] Error calculating drift:", err);
        return null;
      }
    };

    const handleGetStorage = async () => {
      try {
        return this.fleetStore.getStorage();
      } catch (err: any) {
        console.error("[FleetDashboard] Error reading storage:", err);
        return { activeProfile: "Principal", profiles: { Principal: [] } };
      }
    };

    const handleSaveStorage = async (a: any, b: any) => {
      const data = resolvePayload(a, b);
      try {
        return this.fleetStore.saveStorage(data);
      } catch (err: any) {
        console.error("[FleetDashboard] Error saving storage:", err);
        return false;
      }
    };

    const handleSaveUploadedKubeconfig = async (a: any, b: any) => {
      const { clusterId, yamlContent } = resolvePayload(a, b) || {};
      try {
        const savedPath = this.fleetStore.saveUploadedKubeconfig(clusterId, yamlContent);
        return { success: true, savedPath };
      } catch (err: any) {
        console.error("[FleetDashboard] Error saving uploaded kubeconfig:", err);
        return { success: false, savedPath: "" };
      }
    };

    const handleGetHotbarStatus = async () => {
      return { isPinned: this.hotbarService.isPinned() };
    };

    const handleToggleHotbarPin = async () => {
      const isPinned = this.hotbarService.togglePin();
      return { isPinned };
    };

    const handleGetPodLogs = async (a: any, b: any) => {
      const req = resolvePayload(a, b);
      try {
        return await this.collector.getPodLogs(req);
      } catch (err: any) {
        return { logs: `Error IPC: ${err?.message || err}`, containers: [], selectedContainer: "", error: String(err) };
      }
    };

    const handleRestartPod = async (a: any, b: any) => {
      const { clusterId, namespace, podName } = resolvePayload(a, b) || {};
      try {
        return await this.collector.restartPod(clusterId, namespace, podName);
      } catch (err: any) {
        return { success: false, message: `Error IPC al reiniciar pod: ${err?.message || err}` };
      }
    };

    const handleGetPodManifest = async (a: any, b: any) => {
      const { clusterId, namespace, podName } = resolvePayload(a, b) || {};
      try {
        return await this.collector.getPodManifest(clusterId, namespace, podName);
      } catch (err: any) {
        return null;
      }
    };

    const handleExecPodCommand = async (a: any, b: any) => {
      const { clusterId, namespace, podName, container, command } = resolvePayload(a, b) || {};
      try {
        return await this.collector.execPodCommand(clusterId, namespace, podName, container, command);
      } catch (err: any) {
        return { stdout: "", stderr: `Error IPC al ejecutar comando: ${err?.message || err}`, exitCode: 1 };
      }
    };

    // Register with extension IPC
    extIpc.handle("discover-clusters", handleDiscover);
    extIpc.handle("fetch-telemetry", handleTelemetry);
    extIpc.handle("calculate-drift", handleDrift);
    extIpc.handle("get-storage", handleGetStorage);
    extIpc.handle("save-storage", handleSaveStorage);
    extIpc.handle("save-uploaded-kubeconfig", handleSaveUploadedKubeconfig);
    extIpc.handle("get-hotbar-status", handleGetHotbarStatus);
    extIpc.handle("toggle-hotbar-pin", handleToggleHotbarPin);
    extIpc.handle("get-pod-logs", handleGetPodLogs);
    extIpc.handle("restart-pod", handleRestartPod);
    extIpc.handle("get-pod-manifest", handleGetPodManifest);
    extIpc.handle("exec-pod-command", handleExecPodCommand);

    // Also register with raw electron ipcMain (fallback)
    const rawChannels = [
      ["fleet:discover-clusters", handleDiscover],
      ["fleet:fetch-telemetry", handleTelemetry],
      ["fleet:calculate-drift", handleDrift],
      ["fleet:get-storage", handleGetStorage],
      ["fleet:save-storage", handleSaveStorage],
      ["fleet:save-uploaded-kubeconfig", handleSaveUploadedKubeconfig],
      ["fleet:get-hotbar-status", handleGetHotbarStatus],
      ["fleet:toggle-hotbar-pin", handleToggleHotbarPin],
      ["fleet:get-pod-logs", handleGetPodLogs],
      ["fleet:restart-pod", handleRestartPod],
      ["fleet:get-pod-manifest", handleGetPodManifest],
      ["fleet:exec-pod-command", handleExecPodCommand],
    ];

    for (const [chan, handler] of rawChannels) {
      try {
        ipcMain.removeHandler(chan as string);
        ipcMain.handle(chan as string, handler as any);
      } catch (e) {
        console.warn(`[FleetDashboard] Could not register raw ipcMain for ${chan}:`, e);
      }
    }
  }

  onDeactivate() {
    console.log("[FleetDashboard] Extension Main process deactivated");
    const channels = [
      "fleet:discover-clusters",
      "fleet:fetch-telemetry",
      "fleet:calculate-drift",
      "fleet:get-storage",
      "fleet:save-storage",
      "fleet:save-uploaded-kubeconfig",
      "fleet:get-hotbar-status",
      "fleet:toggle-hotbar-pin",
      "fleet:get-pod-logs",
      "fleet:restart-pod",
      "fleet:get-pod-manifest",
      "fleet:exec-pod-command",
    ];
    for (const chan of channels) {
      try {
        ipcMain.removeHandler(chan);
      } catch {}
    }
  }
}
