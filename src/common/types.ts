export interface UnhealthyPod {
  name: string;
  namespace: string;
  clusterId: string;
  clusterName: string;
  phase: string;
  reason: string;
  message: string;
  restarts: number;
  age: string;
}

export interface PodDetail {
  name: string;
  namespace: string;
  clusterId: string;
  clusterName: string;
  statusCategory: "healthy" | "failing" | "pending";
  phase: string;
  reason: string;
  message: string;
  restarts: number;
  readyContainers: string;
  age: string;
}

export interface NodeHealth {
  name: string;
  role: string;
  ready: boolean;
  diskPressure: boolean;
  memoryPressure: boolean;
  pidPressure: boolean;
  kubeletVersion: string;
  cpuCores: string;
  memoryCapacity: string;
  cpuUsageCores?: string;
  cpuPercent?: number;
  memoryUsageBytes?: string;
  memoryPercent?: number;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
}

export interface ClusterMetrics {
  available: boolean;
  totalCpuPercent?: number;
  totalMemoryPercent?: number;
  cpuUsedFormatted?: string;
  memoryUsedFormatted?: string;
  cpuUsagePercentage?: number;
  memoryUsagePercentage?: number;
  topNodes?: Array<{
    name: string;
    cpuPercent: number;
    memoryPercent: number;
  }>;
  topPods?: Array<{
    name: string;
    namespace: string;
    cpuCores?: string;
    memoryBytes?: string;
  }>;
}

export interface ServiceSummary {
  total: number;
  byType: {
    ClusterIP: number;
    NodePort: number;
    LoadBalancer: number;
    ExternalName: number;
  };
  orphanCount: number;
  orphanServices: Array<{
    name: string;
    namespace: string;
    type: string;
  }>;
}

export interface PodFleetMetrics {
  healthy: number;
  failing: number;
  pending: number;
  terminating: number;
  total: number;
}

export interface ClusterSummary {
  id: string;
  name: string;
  alias?: string;
  serverUrl: string;
  status: "healthy" | "warning" | "error" | "unreachable";
  k8sVersion: string;
  latencyMs: number;
  lastSync: string;
  errorMessage?: string;
  pods: PodFleetMetrics;
  unhealthyPods: UnhealthyPod[];
  allPods?: PodDetail[];
  nodes: NodeHealth[];
  services: ServiceSummary;
  namespaces: string[];
  metrics?: ClusterMetrics;
}

export interface ClusterDrift {
  clusterAName: string;
  clusterBName: string;
  k8sVersion: {
    clusterA: string;
    clusterB: string;
    matches: boolean;
  };
  namespaces: {
    onlyInA: string[];
    onlyInB: string[];
    common: string[];
  };
  nodesCount: {
    clusterA: number;
    clusterB: number;
  };
  servicesCount: {
    clusterA: number;
    clusterB: number;
  };
  driftScore: "Identical" | "Minor Drift" | "Significant Drift";
}

export interface FleetTelemetryResponse {
  clusters: ClusterSummary[];
  timestamp: string;
}

export interface PodLogRequest {
  clusterId: string;
  namespace: string;
  podName: string;
  container?: string;
  tailLines?: number;
  previous?: boolean;
}

export interface PodLogResponse {
  logs: string;
  containers: string[];
  selectedContainer: string;
  error?: string;
}

export interface PodActionResponse {
  success: boolean;
  message: string;
}

export interface PodExecRequest {
  clusterId: string;
  namespace: string;
  podName: string;
  container?: string;
  command: string;
}

export interface PodExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface PodRestartAlarm {
  id: string;
  timestamp: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  previousRestarts: number;
  currentRestarts: number;
  restartDelta: number;
  reason: string;
  message: string;
  read: boolean;
}


