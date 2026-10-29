import * as k8s from "@kubernetes/client-node";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as stream from "stream";
import {
  ClusterSummary,
  ClusterDrift,
  NodeHealth,
  PodFleetMetrics,
  UnhealthyPod,
  PodDetail,
  ServiceSummary,
  PodLogRequest,
  PodLogResponse,
  PodActionResponse,
  PodExecResponse,
  ClusterMetrics,
} from "../common/types";

function parseCpuToCores(cpuStr?: string | number): number {
  if (!cpuStr) return 0;
  const str = String(cpuStr).trim();
  if (str.endsWith("n")) return parseFloat(str.slice(0, -1)) / 1e9;
  if (str.endsWith("u")) return parseFloat(str.slice(0, -1)) / 1e6;
  if (str.endsWith("m")) return parseFloat(str.slice(0, -1)) / 1e3;
  return parseFloat(str) || 0;
}

function parseMemoryToBytes(memStr?: string | number): number {
  if (!memStr) return 0;
  const str = String(memStr).trim();
  if (str.endsWith("Ki")) return parseFloat(str.slice(0, -2)) * 1024;
  if (str.endsWith("Mi")) return parseFloat(str.slice(0, -2)) * 1024 * 1024;
  if (str.endsWith("Gi")) return parseFloat(str.slice(0, -2)) * 1024 * 1024 * 1024;
  if (str.endsWith("Ti")) return parseFloat(str.slice(0, -2)) * 1024 * 1024 * 1024 * 1024;
  if (str.endsWith("k")) return parseFloat(str.slice(0, -1)) * 1000;
  if (str.endsWith("M")) return parseFloat(str.slice(0, -1)) * 1000 * 1000;
  if (str.endsWith("G")) return parseFloat(str.slice(0, -1)) * 1000 * 1000 * 1000;
  if (str.endsWith("T")) return parseFloat(str.slice(0, -1)) * 1000 * 1000 * 1000 * 1000;
  return parseFloat(str) || 0;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GiB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MiB`;
}

function formatCpuCores(cores: number): string {
  if (cores >= 1) return `${cores.toFixed(2)} cores`;
  return `${Math.round(cores * 1000)}m`;
}

export class K8sCollector {
  private static instance: K8sCollector;
  private telemetryCache = new Map<string, { timestamp: number; data: ClusterSummary }>();
  private readonly CACHE_TTL_MS = 8000;
  private podContainersCache = new Map<string, { timestamp: number; containers: string[] }>();

  private constructor() {}

  public static getInstance(): K8sCollector {
    if (!K8sCollector.instance) {
      K8sCollector.instance = new K8sCollector();
    }
    return K8sCollector.instance;
  }

  /**
   * Discovers available kubeconfig files in standard locations and workspace
   */
  public discoverKubeconfigs(): Array<{ name: string; path: string }> {
    const configs: Array<{ name: string; path: string }> = [];

    // Standard ~/.kube/config
    const defaultKube = path.join(os.homedir(), ".kube", "config");
    if (fs.existsSync(defaultKube)) {
      configs.push({ name: "Default (~/.kube/config)", path: defaultKube });
    }

    // Workspace specific kubeconfigs (balveal-app, balveal-core) and defaults
    const possibleDirs = [
      path.join(os.homedir(), "Desktop", "Padsystem", "kubeconfigs", "K8S-IC"),
      path.join(os.homedir(), ".kube"),
      path.resolve(__dirname, "../../.."),
      process.cwd(),
    ];

    for (const dir of possibleDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file.endsWith("-config") || file.endsWith(".kubeconfig") || file.endsWith(".yaml")) {
              const fullPath = path.join(dir, file);
              const stat = fs.statSync(fullPath);
              if (stat.isFile() && stat.size > 100) {
                // Check if it looks like a kubeconfig
                const content = fs.readFileSync(fullPath, "utf-8");
                if (content.includes("apiVersion: v1") && content.includes("clusters:")) {
                  configs.push({
                    name: path.basename(file),
                    path: fullPath,
                  });
                }
              }
            }
          }
        } catch (e) {
          // ignore directory read errors
        }
      }
    }

    // Deduplicate by path
    const unique = new Map<string, { name: string; path: string }>();
    for (const c of configs) {
      unique.set(c.path, c);
    }
    return Array.from(unique.values());
  }

  /**
   * Collects telemetry from a specific kubeconfig file or YAML content
   */
  public async collectFromKubeconfig(
    target: string | { name: string; path?: string; yamlContent?: string },
    displayName?: string
  ): Promise<ClusterSummary> {
    const isObj = typeof target === "object" && target !== null;
    const filePath = typeof target === "string" ? target : target.path;
    const yamlContent = isObj ? (target as any).yamlContent : undefined;
    const clusterName = displayName || (isObj ? (target as any).name : (filePath ? path.basename(filePath) : "Cluster"));
    const targetId = isObj ? (target as any).id : undefined;
    const targetAlias = isObj ? (target as any).alias : undefined;
    const clusterId = targetId || (filePath ? path.basename(filePath) : clusterName);
    const startTime = Date.now();

    // Telemetry Cache Check (8s TTL) for high-speed multi-cluster dashboarding
    const cached = this.telemetryCache.get(clusterId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return { ...cached.data, alias: targetAlias || cached.data.alias };
    }

    const kc = new k8s.KubeConfig();
    try {
      if (yamlContent) {
        kc.loadFromString(yamlContent);
      } else if (filePath) {
        kc.loadFromFile(filePath);
      } else {
        throw new Error("No se proporcionó ruta ni contenido YAML");
      }
    } catch (err: any) {
      return this.createUnreachableSummary(
        clusterId,
        clusterName,
        "N/A",
        `Error al cargar archivo kubeconfig: ${err?.message || err}`,
        targetAlias
      );
    }

    if (!kc.contexts || kc.contexts.length === 0) {
      return this.createUnreachableSummary(
        clusterId,
        clusterName,
        "N/A",
        "El kubeconfig no contiene contextos válidos",
        targetAlias
      );
    }
    if (!kc.currentContext && kc.contexts.length > 0) {
      kc.setCurrentContext(kc.contexts[0].name);
    }

    const currentCluster = kc.getCurrentCluster();
    if (!currentCluster || !currentCluster.server) {
      return this.createUnreachableSummary(
        clusterId,
        clusterName,
        "N/A",
        "El contexto no tiene servidor o clúster configurado",
        targetAlias
      );
    }
    const serverUrl = currentCluster.server;

    // Helper to wrap calls with a strict timeout and TLS error self-healing
    const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
      let timer: any;
      return Promise.race([
        promise.then((res) => {
          clearTimeout(timer);
          return res;
        }).catch((err) => {
          clearTimeout(timer);
          const errStr = String(err?.message || err);
          if (
            errStr.includes("certificate") ||
            errStr.includes("CERT_") ||
            errStr.includes("unable to verify") ||
            errStr.includes("self signed")
          ) {
            kc.clusters.forEach((c) => ((c as any).skipTLSVerify = true));
          }
          return fallback;
        }),
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), ms);
        }),
      ]);
    };

    try {
      this.applyTlsFallback(kc);
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      const versionApi = kc.makeApiClient(k8s.VersionApi);
      const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

      // 1. Fetch version and check latency with 3.5s timeout (with TLS error recovery)
      let k8sVersion = "v1.x";
      try {
        const versionRes: any = await withTimeout(versionApi.getCode(), 3500, null);
        k8sVersion = versionRes?.gitVersion || versionRes?.body?.gitVersion || "v1.x";
      } catch (verErr: any) {
        const errStr = String(verErr?.message || verErr);
        if (
          errStr.includes("certificate") ||
          errStr.includes("CERT_") ||
          errStr.includes("unable to verify") ||
          errStr.includes("self signed")
        ) {
          kc.clusters.forEach((c) => ((c as any).skipTLSVerify = true));
          try {
            const retryRes: any = await withTimeout(versionApi.getCode(), 3500, null);
            k8sVersion = retryRes?.gitVersion || retryRes?.body?.gitVersion || "v1.x";
          } catch {
            k8sVersion = "Desconocida";
          }
        } else {
          k8sVersion = "Desconocida";
        }
      }
      const latencyMs = Date.now() - startTime;

      // Helper to extract items array regardless of client-node version (res.items vs res.body.items)
      const extractItems = (res: PromiseSettledResult<any>): any[] => {
        if (res.status !== "fulfilled" || !res.value) return [];
        const val = res.value;
        if (Array.isArray(val.items)) return val.items;
        if (Array.isArray(val.body?.items)) return val.body.items;
        return [];
      };

      // 2. Fetch Nodes, Pods, Services, Endpoints, Namespaces, and Node Metrics in parallel
      const [nodesRes, podsRes, servicesRes, endpointsRes, namespacesRes, nodeMetricsRes] = await Promise.allSettled([
        withTimeout(coreApi.listNode(), 5000, null),
        withTimeout(coreApi.listPodForAllNamespaces(), 5000, null),
        withTimeout(coreApi.listServiceForAllNamespaces(), 5000, null),
        withTimeout(coreApi.listEndpointsForAllNamespaces(), 5000, null),
        withTimeout(coreApi.listNamespace(), 5000, null),
        withTimeout(
          customApi.listClusterCustomObject({
            group: "metrics.k8s.io",
            version: "v1beta1",
            plural: "nodes",
          }),
          3500,
          null
        ),
      ]);

      // Index node metrics from metrics-server (if available)
      const rawMetrics = extractItems(nodeMetricsRes);
      const nodeMetricsMap = new Map<string, { cpuUsage: number; memUsage: number }>();
      for (const item of rawMetrics) {
        const nodeName = item.metadata?.name;
        if (!nodeName) continue;
        const cpu = parseCpuToCores(item.usage?.cpu);
        const mem = parseMemoryToBytes(item.usage?.memory);
        nodeMetricsMap.set(nodeName, { cpuUsage: cpu, memUsage: mem });
      }

      // Process Nodes
      const nodes: NodeHealth[] = [];
      const rawNodes = extractItems(nodesRes);
      for (const node of rawNodes) {
        const conditions = node.status?.conditions || [];
        const readyCond = conditions.find((c: any) => c.type === "Ready");
        const diskCond = conditions.find((c: any) => c.type === "DiskPressure");
        const memCond = conditions.find((c: any) => c.type === "MemoryPressure");
        const pidCond = conditions.find((c: any) => c.type === "PIDPressure");

        const labels = node.metadata?.labels || {};
        const isControlPlane =
          labels["node-role.kubernetes.io/control-plane"] !== undefined ||
          labels["node-role.kubernetes.io/master"] !== undefined;

        const allocatableCpu = parseCpuToCores(node.status?.allocatable?.cpu);
        const allocatableMem = parseMemoryToBytes(node.status?.allocatable?.memory);

        let nodeCpuUsageCores: string | undefined;
        let nodeCpuPercent: number | undefined;
        let nodeMemUsageBytes: string | undefined;
        let nodeMemPercent: number | undefined;

        const nodeMetric = nodeMetricsMap.get(node.metadata?.name || "");
        if (nodeMetric) {
          nodeCpuUsageCores = formatCpuCores(nodeMetric.cpuUsage);
          nodeMemUsageBytes = formatBytes(nodeMetric.memUsage);
          if (allocatableCpu > 0) {
            nodeCpuPercent = Math.min(100, Math.round((nodeMetric.cpuUsage / allocatableCpu) * 100));
          }
          if (allocatableMem > 0) {
            nodeMemPercent = Math.min(100, Math.round((nodeMetric.memUsage / allocatableMem) * 100));
          }
        }

        nodes.push({
          name: node.metadata?.name || "unnamed",
          role: isControlPlane ? "control-plane" : "worker",
          ready: readyCond?.status === "True",
          diskPressure: diskCond?.status === "True",
          memoryPressure: memCond?.status === "True",
          pidPressure: pidCond?.status === "True",
          kubeletVersion: node.status?.nodeInfo?.kubeletVersion || "N/A",
          cpuCores: String(node.status?.allocatable?.cpu || "N/A"),
          memoryCapacity: String(node.status?.allocatable?.memory || "N/A"),
          cpuUsageCores: nodeCpuUsageCores,
          cpuPercent: nodeCpuPercent,
          cpuUsagePercent: nodeCpuPercent,
          memoryUsageBytes: nodeMemUsageBytes,
          memoryPercent: nodeMemPercent,
          memoryUsagePercent: nodeMemPercent,
        });
      }

      // Process Pods
      const podMetrics: PodFleetMetrics = {
        healthy: 0,
        failing: 0,
        pending: 0,
        terminating: 0,
        total: 0,
      };
      const unhealthyPods: UnhealthyPod[] = [];
      const allPods: PodDetail[] = [];

      const pods = extractItems(podsRes);
      podMetrics.total = pods.length;

      for (const pod of pods) {
        const phase = pod.status?.phase || "Unknown";
        const containerStatuses = pod.status?.containerStatuses || [];
        const isTerminating = Boolean(pod.metadata?.deletionTimestamp);

        let hasCrashLoop = false;
        let hasOomKilled = false;
        let hasImagePullBackOff = false;
        let failureReason = "";
        let failureMessage = "";
        let totalRestarts = 0;

        for (const cs of containerStatuses) {
          totalRestarts += cs.restartCount || 0;
          const waitingReason = cs.state?.waiting?.reason;
          const terminatedReason = cs.state?.terminated?.reason;

          if (waitingReason === "CrashLoopBackOff") {
            hasCrashLoop = true;
            failureReason = "CrashLoopBackOff";
            failureMessage = cs.state?.waiting?.message || "El contenedor se reinicia constantemente";
          } else if (terminatedReason === "OOMKilled" || waitingReason === "OOMKilled") {
            hasOomKilled = true;
            failureReason = "OOMKilled";
            failureMessage = "Superó el límite de memoria asignado (Out Of Memory)";
          } else if (waitingReason === "ImagePullBackOff" || waitingReason === "ErrImagePull") {
            hasImagePullBackOff = true;
            failureReason = waitingReason;
            failureMessage = cs.state?.waiting?.message || "No se pudo descargar la imagen";
          }
        }

        const readyCount = containerStatuses.filter((c: any) => c.ready).length;
        const totalContainers = containerStatuses.length || (pod.spec?.containers?.length || 1);
        const readyContainers = `${readyCount}/${totalContainers}`;

        let statusCategory: "healthy" | "failing" | "pending" = "pending";

        if (isTerminating) {
          statusCategory = "pending";
          podMetrics.terminating++;
        } else if (hasCrashLoop || hasOomKilled || hasImagePullBackOff || phase === "Failed") {
          statusCategory = "failing";
          podMetrics.failing++;
          unhealthyPods.push({
            name: pod.metadata?.name || "unknown",
            namespace: pod.metadata?.namespace || "default",
            clusterId,
            clusterName,
            phase,
            reason: failureReason || phase,
            message: failureMessage || `Pod en estado ${phase}`,
            restarts: totalRestarts,
            age: pod.metadata?.creationTimestamp || "Reciente",
          });
        } else if (phase === "Pending") {
          statusCategory = "pending";
          podMetrics.pending++;
        } else if (phase === "Running") {
          const allContainersReady =
            containerStatuses.length > 0 && containerStatuses.every((c: any) => c.ready);
          if (allContainersReady) {
            statusCategory = "healthy";
            podMetrics.healthy++;
          } else {
            statusCategory = "pending";
            podMetrics.pending++;
          }
        } else {
          statusCategory = "pending";
          podMetrics.pending++;
        }

        allPods.push({
          name: pod.metadata?.name || "unknown",
          namespace: pod.metadata?.namespace || "default",
          clusterId,
          clusterName,
          statusCategory,
          phase: isTerminating ? "Terminating" : phase,
          reason: failureReason || (isTerminating ? "Terminating" : phase),
          message: failureMessage || (statusCategory === "healthy" ? "Operativo y saludable" : `Pod en estado ${phase}`),
          restarts: totalRestarts,
          readyContainers,
          age: pod.metadata?.creationTimestamp || "",
        });
      }

      // Process Services & Orphan Endpoints Detection
      const servicesSummary: ServiceSummary = {
        total: 0,
        byType: {
          ClusterIP: 0,
          NodePort: 0,
          LoadBalancer: 0,
          ExternalName: 0,
        },
        orphanCount: 0,
        orphanServices: [],
      };

      const services = extractItems(servicesRes);
      servicesSummary.total = services.length;

      // Map endpoints by namespace + name
      const endpointsMap = new Map<string, boolean>();
      const rawEndpoints = extractItems(endpointsRes);
      for (const ep of rawEndpoints) {
        const key = `${ep.metadata?.namespace}/${ep.metadata?.name}`;
        const subsets = ep.subsets || [];
        const hasAddresses = subsets.some((s: any) => (s.addresses?.length || 0) > 0);
        endpointsMap.set(key, hasAddresses);
      }

      for (const svc of services) {
        const type = (svc.spec?.type || "ClusterIP") as keyof typeof servicesSummary.byType;
        if (servicesSummary.byType[type] !== undefined) {
          servicesSummary.byType[type]++;
        }

        // Check if it's an orphan service (has selectors but 0 endpoints)
        const hasSelectors = svc.spec?.selector && Object.keys(svc.spec.selector).length > 0;
        if (hasSelectors && type !== "ExternalName") {
          const key = `${svc.metadata?.namespace}/${svc.metadata?.name}`;
          const hasActiveEndpoints = endpointsMap.get(key);
          if (hasActiveEndpoints === false) {
            servicesSummary.orphanCount++;
            servicesSummary.orphanServices.push({
              name: svc.metadata?.name || "unknown",
              namespace: svc.metadata?.namespace || "default",
              type,
            });
          }
        }
      }

      // Process Namespaces
      const namespaces: string[] = [];
      const rawNamespaces = extractItems(namespacesRes);
      for (const ns of rawNamespaces) {
        if (ns.metadata?.name) {
          namespaces.push(ns.metadata.name);
        }
      }

      // Compute status
      let status: "healthy" | "warning" | "error" = "healthy";
      const hasUnhealthyNodes = nodes.some((n) => !n.ready || n.diskPressure || n.memoryPressure);
      if (podMetrics.failing > 0 || hasUnhealthyNodes) {
        status = podMetrics.failing > 3 ? "error" : "warning";
      }

      // Compute cluster-wide resource metrics
      let clusterMetrics: ClusterMetrics | undefined;
      if (nodeMetricsMap.size > 0) {
        let totalAllocCpu = 0;
        let totalAllocMem = 0;
        let totalUsedCpu = 0;
        let totalUsedMem = 0;

        for (const node of rawNodes) {
          const allocCpu = parseCpuToCores(node.status?.allocatable?.cpu);
          const allocMem = parseMemoryToBytes(node.status?.allocatable?.memory);
          totalAllocCpu += allocCpu;
          totalAllocMem += allocMem;

          const metric = nodeMetricsMap.get(node.metadata?.name || "");
          if (metric) {
            totalUsedCpu += metric.cpuUsage;
            totalUsedMem += metric.memUsage;
          }
        }

        const totalCpuPercent = totalAllocCpu > 0 ? Math.min(100, Math.round((totalUsedCpu / totalAllocCpu) * 100)) : 0;
        const totalMemoryPercent = totalAllocMem > 0 ? Math.min(100, Math.round((totalUsedMem / totalAllocMem) * 100)) : 0;

        clusterMetrics = {
          available: true,
          totalCpuPercent,
          totalMemoryPercent,
          cpuUsagePercentage: totalCpuPercent,
          memoryUsagePercentage: totalMemoryPercent,
          cpuUsedFormatted: `${formatCpuCores(totalUsedCpu)} / ${formatCpuCores(totalAllocCpu)}`,
          memoryUsedFormatted: `${formatBytes(totalUsedMem)} / ${formatBytes(totalAllocMem)}`,
        };
      } else {
        clusterMetrics = {
          available: false,
        };
      }

      const summary: ClusterSummary = {
        id: clusterId,
        name: clusterName,
        alias: targetAlias,
        serverUrl,
        status,
        k8sVersion,
        latencyMs,
        lastSync: new Date().toLocaleTimeString(),
        pods: podMetrics,
        unhealthyPods,
        allPods,
        nodes,
        services: servicesSummary,
        namespaces,
        metrics: clusterMetrics,
      };

      this.telemetryCache.set(clusterId, { timestamp: Date.now(), data: summary });
      return summary;
    } catch (err: any) {
      return this.createUnreachableSummary(
        clusterId,
        clusterName,
        serverUrl,
        `No se pudo conectar al API Server: ${err?.message || err}`
      );
    }
  }

  /**
   * Computes structural difference (drift) between two clusters
   */
  public calculateDrift(clusterA: ClusterSummary, clusterB: ClusterSummary): ClusterDrift {
    const setA = new Set(clusterA.namespaces);
    const setB = new Set(clusterB.namespaces);

    const onlyInA = clusterA.namespaces.filter((ns) => !setB.has(ns));
    const onlyInB = clusterB.namespaces.filter((ns) => !setA.has(ns));
    const common = clusterA.namespaces.filter((ns) => setB.has(ns));

    const versionMatches = clusterA.k8sVersion === clusterB.k8sVersion;

    let driftScore: "Identical" | "Minor Drift" | "Significant Drift" = "Identical";
    if (!versionMatches || onlyInA.length > 3 || onlyInB.length > 3) {
      driftScore = "Significant Drift";
    } else if (onlyInA.length > 0 || onlyInB.length > 0) {
      driftScore = "Minor Drift";
    }

    return {
      clusterAName: clusterA.name,
      clusterBName: clusterB.name,
      k8sVersion: {
        clusterA: clusterA.k8sVersion,
        clusterB: clusterB.k8sVersion,
        matches: versionMatches,
      },
      namespaces: {
        onlyInA,
        onlyInB,
        common,
      },
      nodesCount: {
        clusterA: clusterA.nodes.length,
        clusterB: clusterB.nodes.length,
      },
      servicesCount: {
        clusterA: clusterA.services.total,
        clusterB: clusterB.services.total,
      },
      driftScore,
    };
  }

  private createUnreachableSummary(
    id: string,
    name: string,
    serverUrl: string,
    errorMessage: string,
    alias?: string
  ): ClusterSummary {
    return {
      id,
      name,
      alias,
      serverUrl,
      status: "unreachable",
      k8sVersion: "N/A",
      latencyMs: 0,
      lastSync: new Date().toLocaleTimeString(),
      errorMessage,
      pods: { healthy: 0, failing: 0, pending: 0, terminating: 0, total: 0 },
      unhealthyPods: [],
      allPods: [],
      nodes: [],
      services: {
        total: 0,
        byType: { ClusterIP: 0, NodePort: 0, LoadBalancer: 0, ExternalName: 0 },
        orphanCount: 0,
        orphanServices: [],
      },
      namespaces: [],
    };
  }

  public applyTlsFallback(kc: k8s.KubeConfig) {
    for (const c of kc.clusters) {
      if (c.skipTLSVerify === undefined || c.skipTLSVerify === false) {
        // If server uses a private network IP, localhost, or port 16443/6443, enable skipTLSVerify
        if (
          /https?:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|127\.|localhost)/.test(c.server || "") ||
          (c.server && (c.server.includes(":16443") || c.server.includes(":6443")))
        ) {
          (c as any).skipTLSVerify = true;
        }
      }
    }
  }

  public getKubeConfigForCluster(clusterId: string): k8s.KubeConfig | null {
    const kc = new k8s.KubeConfig();
    try {
      // 1. Check FleetStore profiles
      const storageFile = path.join(os.homedir(), ".freelens", "fleet-storage", "profiles.json");
      if (fs.existsSync(storageFile)) {
        const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
        const activeProf = storage.activeProfile || "Principal";
        const profiles = storage.profiles || {};
        const profileOrder = [activeProf, ...Object.keys(profiles).filter((p) => p !== activeProf)];

        for (const profName of profileOrder) {
          const clusters = profiles[profName] || [];
          const found = clusters.find((c: any) => c.id === clusterId || c.name === clusterId);
          if (found) {
            // Prioritize yamlContent so exact cluster credentials and server URL are respected!
            if (found.yamlContent) {
              kc.loadFromString(found.yamlContent);
              this.applyTlsFallback(kc);
              return kc;
            }
            if (found.path && fs.existsSync(found.path)) {
              kc.loadFromFile(found.path);
              this.applyTlsFallback(kc);
              return kc;
            }
          }
        }
      }

      // 2. Check saved YAML in ~/.freelens/fleet-storage/kubeconfigs/<id>.yaml
      const savedYaml = path.join(os.homedir(), ".freelens", "fleet-storage", "kubeconfigs", `${clusterId}.yaml`);
      if (fs.existsSync(savedYaml)) {
        kc.loadFromFile(savedYaml);
        this.applyTlsFallback(kc);
        return kc;
      }

      // 3. Check FreeLens cluster store
      const home = os.homedir();
      const lensStorePaths = [
        path.join(home, "Library/Application Support/Freelens/lens-cluster-store.json"),
        path.join(home, ".config/Freelens/lens-cluster-store.json"),
        path.join(process.env.APPDATA || "", "Freelens/lens-cluster-store.json"),
      ];
      for (const p of lensStorePaths) {
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, "utf-8"));
          const clusters = data.clusters || [];
          const match = clusters.find((c: any) => c.id === clusterId || c.contextName === clusterId);
          if (match && match.kubeConfigPath && fs.existsSync(match.kubeConfigPath)) {
            kc.loadFromFile(match.kubeConfigPath);
            if (match.contextName && kc.contexts.some((ctx) => ctx.name === match.contextName)) {
              kc.setCurrentContext(match.contextName);
            }
            this.applyTlsFallback(kc);
            return kc;
          }
        }
      }

      // 4. Default ~/.kube/config
      const defKube = path.join(os.homedir(), ".kube", "config");
      if (fs.existsSync(defKube)) {
        kc.loadFromFile(defKube);
        const matchCtx = kc.contexts.find((c) => c.name === clusterId);
        if (matchCtx) {
          kc.setCurrentContext(matchCtx.name);
        }
        this.applyTlsFallback(kc);
        return kc;
      }
    } catch (err) {
      console.error(`[K8sCollector] Error resolving kubeconfig for cluster ${clusterId}:`, err);
    }
    return null;
  }

  public async getPodLogs(req: PodLogRequest): Promise<PodLogResponse> {
    const kc = this.getKubeConfigForCluster(req.clusterId);
    if (!kc) {
      return {
        logs: "Error: No se encontró la configuración Kubeconfig para el clúster seleccionado.",
        containers: [],
        selectedContainer: "",
        error: "Kubeconfig no encontrado",
      };
    }

    try {
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);

      const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
        let timer: any;
        return Promise.race([
          promise.then((res) => {
            clearTimeout(timer);
            return res;
          }).catch(() => {
            clearTimeout(timer);
            return fallback;
          }),
          new Promise<T>((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
          }),
        ]);
      };

      // 1. Fetch Pod spec to extract available containers (cached for ultra-fast streaming/polling)
      let allContainers: string[] = [];
      const cacheKey = `${req.clusterId}:${req.namespace}:${req.podName}`;
      const cached = this.podContainersCache.get(cacheKey);
      const now = Date.now();
      if (cached && now - cached.timestamp < 30000) {
        allContainers = cached.containers;
      } else {
        try {
          const podRes: any = await withTimeout(
            coreApi.readNamespacedPod({ name: req.podName, namespace: req.namespace }),
            3500,
            null
          );
          const podObj = podRes?.body || podRes;
          const appContainers = (podObj?.spec?.containers || []).map((c: any) => c.name);
          const initContainers = (podObj?.spec?.initContainers || []).map((c: any) => c.name);
          allContainers = [...appContainers, ...initContainers];
          if (allContainers.length > 0) {
            this.podContainersCache.set(cacheKey, { timestamp: now, containers: allContainers });
          }
        } catch {}
      }

      const selectedContainer = req.container || allContainers[0] || "";

      // 2. Fetch logs with timestamps using ObjectParamAPI required by @kubernetes/client-node v1.x
      const logRes: any = await withTimeout(
        coreApi.readNamespacedPodLog({
          name: req.podName,
          namespace: req.namespace,
          container: selectedContainer || undefined,
          previous: Boolean(req.previous),
          tailLines: req.tailLines || 100,
          timestamps: true,
        }),
        6000,
        null
      );

      const rawLogs = typeof logRes === "string" ? logRes : (logRes?.body ?? "");
      const logs = rawLogs || (req.previous ? "No hay logs disponibles de la instancia previa." : "El contenedor no ha generado logs aún o el buffer está vacío.");

      return {
        logs,
        containers: allContainers,
        selectedContainer,
      };
    } catch (err: any) {
      return {
        logs: `Error al conectar con el pod para leer logs: ${err?.message || err}`,
        containers: [],
        selectedContainer: req.container || "",
        error: err?.message || String(err),
      };
    }
  }

  public async restartPod(clusterId: string, namespace: string, podName: string): Promise<PodActionResponse> {
    const kc = this.getKubeConfigForCluster(clusterId);
    if (!kc) {
      return { success: false, message: "Kubeconfig no encontrado para este clúster." };
    }
    try {
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      await coreApi.deleteNamespacedPod({
        name: podName,
        namespace: namespace,
        gracePeriodSeconds: 0,
      });
      this.telemetryCache.delete(clusterId);
      return {
        success: true,
        message: `Pod '${podName}' reiniciado con éxito (eliminado para regeneración de Kubernetes).`,
      };
    } catch (err: any) {
      return { success: false, message: `Error al reiniciar pod: ${err?.message || err}` };
    }
  }

  public async execPodCommand(
    clusterId: string,
    namespace: string,
    podName: string,
    container: string | undefined,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }> {
    const kc = this.getKubeConfigForCluster(clusterId);
    if (!kc) {
      return {
        stdout: "",
        stderr: "Error: No se encontró la configuración Kubeconfig para el clúster seleccionado.",
        exitCode: 1,
        error: "Kubeconfig no encontrado",
      };
    }

    let targetContainer = container;
    if (!targetContainer) {
      try {
        const coreApi = kc.makeApiClient(k8s.CoreV1Api);
        const podRes: any = await coreApi.readNamespacedPod({ name: podName, namespace });
        const podObj = podRes?.body || podRes;
        const containers = (podObj?.spec?.containers || []).map((c: any) => c.name);
        if (containers.length > 0) {
          targetContainer = containers[0];
        }
      } catch {
        // Fallback or leave undefined/empty
      }
    }

    return new Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }>(async (resolve) => {
      let isResolved = false;
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      let wsClient: any = null;

      const stdoutStream = new stream.PassThrough();
      const stderrStream = new stream.PassThrough();

      stdoutStream.on("data", (chunk) => {
        stdout += chunk.toString("utf-8");
      });

      stderrStream.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });

      const finish = (err?: string) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timeoutTimer);
        try {
          if (wsClient && typeof wsClient.close === "function") {
            wsClient.close();
          }
        } catch {}
        resolve({
          stdout,
          stderr,
          exitCode,
          ...(err ? { error: err } : {}),
        });
      };

      const timeoutTimer = setTimeout(() => {
        if (!isResolved) {
          if (exitCode === 0) exitCode = 124;
          if (!stderr && !stdout) {
            stderr = "Error: Tiempo de espera agotado (10s). El comando no respondió a tiempo.";
          }
          finish("Timeout de seguridad de 10s alcanzado");
        }
      }, 10000);

      try {
        const exec = new k8s.Exec(kc);
        const cmd = ["sh", "-c", command];

        const ws = await exec.exec(
          namespace,
          podName,
          targetContainer || "",
          cmd,
          stdoutStream,
          stderrStream,
          null,
          false,
          (status: any) => {
            if (status?.status === "Success") {
              exitCode = 0;
            } else {
              const causes = status?.details?.causes;
              if (Array.isArray(causes)) {
                const exitCodeCause = causes.find((c: any) => c.reason === "ExitCode");
                if (exitCodeCause && exitCodeCause.message) {
                  const parsed = parseInt(exitCodeCause.message, 10);
                  exitCode = !isNaN(parsed) ? parsed : 1;
                } else {
                  exitCode = 1;
                }
              } else {
                exitCode = 1;
              }
              if (status?.message && !stderr) {
                stderr = status.message;
              }
            }
            setTimeout(() => {
              finish();
            }, 60);
          }
        );

        wsClient = ws;

        if (typeof (ws as any).on === "function") {
          (ws as any).on("close", () => {
            setTimeout(() => finish(), 60);
          });
          (ws as any).on("error", (err: any) => {
            const errMsg = err?.message || String(err);
            if (!stderr) stderr = `Error en WebSocket: ${errMsg}`;
            exitCode = exitCode || 1;
            finish(errMsg);
          });
        } else {
          const prevClose = ws.onclose;
          ws.onclose = (ev: any) => {
            if (typeof prevClose === "function") prevClose(ev);
            setTimeout(() => finish(), 60);
          };
          const prevErr = ws.onerror;
          ws.onerror = (ev: any) => {
            if (typeof prevErr === "function") prevErr(ev);
            const errMsg = ev?.message || "Error en conexión WebSocket";
            if (!stderr) stderr = errMsg;
            exitCode = exitCode || 1;
            finish(errMsg);
          };
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        stderr = stderr ? `${stderr}\n${msg}` : msg;
        exitCode = 1;
        finish(msg);
      }
    });
  }

  public async getPodManifest(clusterId: string, namespace: string, podName: string): Promise<any> {
    const kc = this.getKubeConfigForCluster(clusterId);
    if (!kc) return null;
    try {
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      const res: any = await coreApi.readNamespacedPod({ name: podName, namespace: namespace });
      return res?.body || res;
    } catch {
      return null;
    }
  }
}
