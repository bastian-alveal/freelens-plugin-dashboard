import React, { useState, useEffect, useMemo } from "react";
import { ClusterSummary, PodDetail } from "../../common/types";

interface Props {
  clusters: ClusterSummary[];
  preselectedAId?: string;
  preselectedBId?: string;
}

// Helper to extract clean base workload name from a Kubernetes pod name
function getWorkloadName(podName: string): string {
  // 1. Deployment / ReplicaSet: <name>-<hash8-10>-<id5>
  if (/-[a-z0-9]{8,10}-[a-z0-9]{5}$/i.test(podName)) {
    return podName.replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/i, "");
  }
  // 2. StatefulSet: <name>-<ordinal>
  if (/-[0-9]+$/.test(podName)) {
    return podName.replace(/-[0-9]+$/, "");
  }
  // 3. DaemonSet / Job: <name>-<id5>
  if (/-[a-z0-9]{5}$/i.test(podName)) {
    return podName.replace(/-[a-z0-9]{5}$/i, "");
  }
  return podName;
}

interface WorkloadParity {
  name: string;
  namespace: string;
  replicasA: number;
  healthyA: number;
  failingA: number;
  replicasB: number;
  healthyB: number;
  failingB: number;
  status: "matched" | "unbalanced" | "only_in_a" | "only_in_b";
}

export const DriftInspector: React.FC<Props> = ({
  clusters,
  preselectedAId,
  preselectedBId,
}) => {
  const availableClusters = clusters.filter((c) => c.status !== "unreachable");

  const [clusterAId, setClusterAId] = useState<string>(
    preselectedAId || availableClusters[0]?.id || ""
  );
  const [clusterBId, setClusterBId] = useState<string>(
    preselectedBId || availableClusters[1]?.id || availableClusters[0]?.id || ""
  );

  const [activeDriftTab, setActiveDriftTab] = useState<"general" | "workloads" | "namespaces" | "services">("general");
  const [workloadNamespaceFilter, setWorkloadNamespaceFilter] = useState<string>("all");
  const [workloadStatusFilter, setWorkloadStatusFilter] = useState<"all" | "divergent" | "matched">("all");
  const [workloadSearch, setWorkloadSearch] = useState<string>("");
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  useEffect(() => {
    if (preselectedAId) setClusterAId(preselectedAId);
  }, [preselectedAId]);

  useEffect(() => {
    if (preselectedBId) setClusterBId(preselectedBId);
  }, [preselectedBId]);

  if (availableClusters.length < 2) {
    return (
      <div className="empty-state" style={{ padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚖️</div>
        <h3 style={{ color: "#63b3ed" }}>Se requieren al menos 2 clústeres activos</h3>
        <p style={{ color: "#a0aec0", maxWidth: "500px", margin: "0 auto" }}>
          Asocia o activa al menos dos clústeres en tu flota para poder analizar y detectar derivas de configuración, cargas de trabajo y namespaces.
        </p>
      </div>
    );
  }

  const clusterA = availableClusters.find((c) => c.id === clusterAId) || availableClusters[0];
  const clusterB = availableClusters.find((c) => c.id === clusterBId) || availableClusters[1];

  const nameA = clusterA.alias || clusterA.name;
  const nameB = clusterB.alias || clusterB.name;

  // Swap function
  const handleSwap = () => {
    const temp = clusterAId;
    setClusterAId(clusterBId);
    setClusterBId(temp);
  };

  // 1. Namespaces Drift
  const setA = new Set(clusterA.namespaces);
  const setB = new Set(clusterB.namespaces);
  const onlyInA = clusterA.namespaces.filter((ns) => !setB.has(ns));
  const onlyInB = clusterB.namespaces.filter((ns) => !setA.has(ns));
  const common = clusterA.namespaces.filter((ns) => setB.has(ns));
  const allNamespaces = Array.from(new Set([...clusterA.namespaces, ...clusterB.namespaces])).sort();

  // 2. Compute Workloads Parity Map
  const workloadsParity = useMemo<WorkloadParity[]>(() => {
    const map = new Map<string, WorkloadParity>();

    // Process pods in Cluster A
    const podsA = clusterA.allPods || [];
    for (const pod of podsA) {
      const baseName = getWorkloadName(pod.name);
      const key = `${pod.namespace}/${baseName}`;
      if (!map.has(key)) {
        map.set(key, {
          name: baseName,
          namespace: pod.namespace,
          replicasA: 0,
          healthyA: 0,
          failingA: 0,
          replicasB: 0,
          healthyB: 0,
          failingB: 0,
          status: "only_in_a",
        });
      }
      const item = map.get(key)!;
      item.replicasA++;
      if (pod.statusCategory === "healthy") item.healthyA++;
      if (pod.statusCategory === "failing") item.failingA++;
    }

    // Process pods in Cluster B
    const podsB = clusterB.allPods || [];
    for (const pod of podsB) {
      const baseName = getWorkloadName(pod.name);
      const key = `${pod.namespace}/${baseName}`;
      if (!map.has(key)) {
        map.set(key, {
          name: baseName,
          namespace: pod.namespace,
          replicasA: 0,
          healthyA: 0,
          failingA: 0,
          replicasB: 0,
          healthyB: 0,
          failingB: 0,
          status: "only_in_b",
        });
      }
      const item = map.get(key)!;
      item.replicasB++;
      if (pod.statusCategory === "healthy") item.healthyB++;
      if (pod.statusCategory === "failing") item.failingB++;
    }

    // Classify parity status
    const result: WorkloadParity[] = [];
    for (const item of map.values()) {
      if (item.replicasA > 0 && item.replicasB === 0) {
        item.status = "only_in_a";
      } else if (item.replicasB > 0 && item.replicasA === 0) {
        item.status = "only_in_b";
      } else if (item.replicasA === item.replicasB) {
        item.status = "matched";
      } else {
        item.status = "unbalanced";
      }
      result.push(item);
    }

    return result.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  }, [clusterA, clusterB]);

  // Filtered Workloads
  const filteredWorkloads = useMemo(() => {
    return workloadsParity.filter((w) => {
      if (workloadNamespaceFilter !== "all" && w.namespace !== workloadNamespaceFilter) {
        return false;
      }
      if (workloadStatusFilter === "divergent" && w.status === "matched") {
        return false;
      }
      if (workloadStatusFilter === "matched" && w.status !== "matched") {
        return false;
      }
      if (workloadSearch.trim()) {
        const q = workloadSearch.toLowerCase().trim();
        if (!w.name.toLowerCase().includes(q) && !w.namespace.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [workloadsParity, workloadNamespaceFilter, workloadStatusFilter, workloadSearch]);

  const divergentWorkloadsCount = workloadsParity.filter((w) => w.status !== "matched").length;

  // 3. Infrastructure Cores and Memory
  const totalCoresA = clusterA.nodes.reduce((sum, n) => sum + (parseInt(n.cpuCores) || 0), 0);
  const totalCoresB = clusterB.nodes.reduce((sum, n) => sum + (parseInt(n.cpuCores) || 0), 0);

  // 4. Overall Drift Score
  const versionsMatch = clusterA.k8sVersion === clusterB.k8sVersion;
  let driftScore: "Identical" | "Minor" | "Significant" = "Identical";
  if (!versionsMatch || onlyInA.length > 2 || onlyInB.length > 2 || divergentWorkloadsCount > 5) {
    driftScore = "Significant";
  } else if (onlyInA.length > 0 || onlyInB.length > 0 || divergentWorkloadsCount > 0) {
    driftScore = "Minor";
  }

  // Copy Markdown Report to Clipboard
  const handleCopyReport = () => {
    const report = `# Reporte de Deriva Kubernetes: ${nameA} vs ${nameB}
Generado: ${new Date().toLocaleString()}

## 1. Resumen General
- **Clúster Base (A)**: ${nameA} (K8s ${clusterA.k8sVersion}, ${clusterA.nodes.length} Nodos, ${clusterA.pods.total} Pods)
- **Clúster Comparado (B)**: ${nameB} (K8s ${clusterB.k8sVersion}, ${clusterB.nodes.length} Nodos, ${clusterB.pods.total} Pods)
- **Diagnóstico Global**: ${driftScore === "Identical" ? "100% Alineados" : driftScore === "Minor" ? "Deriva Leve" : "Deriva Significativa"}
- **Paridad de Versión**: ${versionsMatch ? "Idénticas" : `Dispares (${clusterA.k8sVersion} vs ${clusterB.k8sVersion})`}
- **Namespaces Compartidos**: ${common.length}
- **Namespaces Exclusivos en A**: ${onlyInA.join(", ") || "Ninguno"}
- **Namespaces Exclusivos en B**: ${onlyInB.join(", ") || "Ninguno"}
- **Cargas con Desbalance o Ausentes**: ${divergentWorkloadsCount} de ${workloadsParity.length}
`;
    navigator.clipboard.writeText(report);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2500);
  };

  return (
    <div className="drift-card" style={{ background: "#20222a", border: "1px solid #2d3748", borderRadius: "10px", padding: "20px", marginTop: "12px" }}>
      
      {/* Top Comparer Selectors & Score Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", paddingBottom: "16px", borderBottom: "1px solid #2d3748" }}>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#a0aec0", marginBottom: "4px", fontWeight: 600 }}>
              Clúster Base (A):
            </label>
            <select
              className="drift-select"
              value={clusterA.id}
              onChange={(e) => setClusterAId(e.target.value)}
              style={{
                background: "#1a202c",
                border: "1px solid #4299e1",
                color: "#63b3ed",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
                minWidth: "220px",
              }}
            >
              {availableClusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.alias || c.name} ({c.k8sVersion})
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            onClick={handleSwap}
            style={{
              background: "#2d3748",
              border: "1px solid #4a5568",
              color: "#63b3ed",
              padding: "7px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "15px",
              fontWeight: "bold",
              marginTop: "16px",
              transition: "all 0.15s",
            }}
            title="Intercambiar Clúster A y B"
          >
            ⇄
          </button>

          <div>
            <label style={{ display: "block", fontSize: "11px", color: "#a0aec0", marginBottom: "4px", fontWeight: 600 }}>
              Clúster Comparado (B):
            </label>
            <select
              className="drift-select"
              value={clusterB.id}
              onChange={(e) => setClusterBId(e.target.value)}
              style={{
                background: "#1a202c",
                border: "1px solid #ecc94b",
                color: "#f6e05e",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
                minWidth: "220px",
              }}
            >
              {availableClusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.alias || c.name} ({c.k8sVersion})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Drift Score Badge & Copy Report */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background:
                driftScore === "Identical"
                  ? "rgba(72, 187, 120, 0.15)"
                  : driftScore === "Minor"
                  ? "rgba(236, 201, 75, 0.15)"
                  : "rgba(245, 101, 101, 0.15)",
              color:
                driftScore === "Identical"
                  ? "#68d391"
                  : driftScore === "Minor"
                  ? "#f6e05e"
                  : "#feb2b2",
              border:
                driftScore === "Identical"
                  ? "1px solid #48bb78"
                  : driftScore === "Minor"
                  ? "1px solid #d69e2e"
                  : "1px solid #e53e3e",
            }}
          >
            {driftScore === "Identical"
              ? "🟢 100% Alineados (Sin deriva)"
              : driftScore === "Minor"
              ? "🟡 Deriva Moderada"
              : "🔴 Deriva Significativa"}
          </span>

          <button
            onClick={handleCopyReport}
            style={{
              background: copiedReport ? "#22543d" : "#2d3748",
              border: "1px solid #4a5568",
              color: copiedReport ? "#68d391" : "#cbd5e0",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
            title="Copiar reporte de deriva en formato Markdown para Slack/Docs"
          >
            {copiedReport ? "✓ Copiado" : "📋 Copiar Reporte"}
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div style={{ display: "flex", gap: "8px", margin: "16px 0 12px 0", borderBottom: "1px solid #2d3748", paddingBottom: "8px" }}>
        <button
          onClick={() => setActiveDriftTab("general")}
          style={{
            background: activeDriftTab === "general" ? "#2b6cb0" : "transparent",
            color: activeDriftTab === "general" ? "#fff" : "#a0aec0",
            border: "none",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📊 Comparativa General
        </button>

        <button
          onClick={() => setActiveDriftTab("workloads")}
          style={{
            background: activeDriftTab === "workloads" ? "#2b6cb0" : "transparent",
            color: activeDriftTab === "workloads" ? "#fff" : "#a0aec0",
            border: "none",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📦 Deriva de Microservicios ({divergentWorkloadsCount > 0 ? `${divergentWorkloadsCount} ⚠️` : workloadsParity.length})
        </button>

        <button
          onClick={() => setActiveDriftTab("namespaces")}
          style={{
            background: activeDriftTab === "namespaces" ? "#2b6cb0" : "transparent",
            color: activeDriftTab === "namespaces" ? "#fff" : "#a0aec0",
            border: "none",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          📁 Deriva de Namespaces ({onlyInA.length + onlyInB.length > 0 ? `${onlyInA.length + onlyInB.length} exclusivos` : "Alineados"})
        </button>

        <button
          onClick={() => setActiveDriftTab("services")}
          style={{
            background: activeDriftTab === "services" ? "#2b6cb0" : "transparent",
            color: activeDriftTab === "services" ? "#fff" : "#a0aec0",
            border: "none",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🌐 Servicios de Red & Endpoints
        </button>
      </div>

      {/* 1. GENERAL COMPARISON TAB */}
      {activeDriftTab === "general" && (
        <table className="failing-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#1a202c", textAlign: "left", fontSize: "12px", color: "#a0aec0", borderBottom: "2px solid #2d3748" }}>
              <th style={{ padding: "10px 12px", width: "24%" }}>Dimensión</th>
              <th style={{ padding: "10px 12px", width: "33%" }}>{nameA}</th>
              <th style={{ padding: "10px 12px", width: "33%" }}>{nameB}</th>
              <th style={{ padding: "10px 12px", width: "10%" }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "10px 12px" }}><strong>Versión Kubernetes</strong></td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{clusterA.k8sVersion}</td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{clusterB.k8sVersion}</td>
              <td style={{ padding: "10px 12px" }}>
                {versionsMatch ? (
                  <span style={{ color: "#48bb78", fontWeight: 600 }}>✓ Idéntica</span>
                ) : (
                  <span style={{ color: "#fc8181", fontWeight: 700 }}>⚠️ Dispar</span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "10px 12px" }}><strong>Total Pods y Estado</strong></td>
              <td style={{ padding: "10px 12px" }}>
                <span style={{ color: "#48bb78" }}>{clusterA.pods.healthy} vivos</span>
                {clusterA.pods.failing > 0 && <span style={{ color: "#fc8181", marginLeft: "6px", fontWeight: 600 }}>({clusterA.pods.failing} caídos)</span>}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <span style={{ color: "#48bb78" }}>{clusterB.pods.healthy} vivos</span>
                {clusterB.pods.failing > 0 && <span style={{ color: "#fc8181", marginLeft: "6px", fontWeight: 600 }}>({clusterB.pods.failing} caídos)</span>}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {clusterA.pods.failing === 0 && clusterB.pods.failing === 0 ? (
                  <span style={{ color: "#48bb78" }}>✓ 100% Vivos</span>
                ) : (
                  <span style={{ color: "#fc8181" }}>⚠️ Fallos</span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "10px 12px" }}><strong>Capacidad Cómputo (Nodos)</strong></td>
              <td style={{ padding: "10px 12px" }}>
                {clusterA.nodes.length} nodos {totalCoresA > 0 && `(${totalCoresA} Cores CPU)`}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {clusterB.nodes.length} nodos {totalCoresB > 0 && `(${totalCoresB} Cores CPU)`}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {clusterA.nodes.length === clusterB.nodes.length ? (
                  <span style={{ color: "#48bb78" }}>✓ Paridad</span>
                ) : (
                  <span style={{ color: "#ecc94b" }}>Diferente escala</span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "10px 12px" }}><strong>Servicios Totales</strong></td>
              <td style={{ padding: "10px 12px" }}>
                {clusterA.services.total} (ClusterIP: {clusterA.services.byType.ClusterIP}, LB: {clusterA.services.byType.LoadBalancer})
              </td>
              <td style={{ padding: "10px 12px" }}>
                {clusterB.services.total} (ClusterIP: {clusterB.services.byType.ClusterIP}, LB: {clusterB.services.byType.LoadBalancer})
              </td>
              <td style={{ padding: "10px 12px" }}>
                {clusterA.services.total === clusterB.services.total ? (
                  <span style={{ color: "#48bb78" }}>✓ Mismo total</span>
                ) : (
                  <span style={{ color: "#a0aec0" }}>{Math.abs(clusterA.services.total - clusterB.services.total)} dif</span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "10px 12px" }}><strong>Latencia API Server</strong></td>
              <td style={{ padding: "10px 12px" }}>{clusterA.latencyMs}ms</td>
              <td style={{ padding: "10px 12px" }}>{clusterB.latencyMs}ms</td>
              <td style={{ padding: "10px 12px" }}>-</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* 2. WORKLOADS PARITY TAB */}
      {activeDriftTab === "workloads" && (
        <div>
          {/* Workload Filter Controls */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", margin: "10px 0 14px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "#a0aec0" }}>Namespace:</span>
              <select
                value={workloadNamespaceFilter}
                onChange={(e) => setWorkloadNamespaceFilter(e.target.value)}
                style={{
                  background: "#1a202c",
                  border: "1px solid #4a5568",
                  color: "#63b3ed",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  outline: "none",
                }}
              >
                <option value="all">Todos los namespaces ({allNamespaces.length})</option>
                {allNamespaces.map((ns) => (
                  <option key={ns} value={ns}>{ns}</option>
                ))}
              </select>

              {/* Status Filter */}
              <button
                onClick={() => setWorkloadStatusFilter("all")}
                style={{
                  background: workloadStatusFilter === "all" ? "#3182ce" : "#1a202c",
                  color: workloadStatusFilter === "all" ? "#fff" : "#a0aec0",
                  border: "1px solid #4a5568",
                  padding: "4px 10px",
                  borderRadius: "16px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Todas ({workloadsParity.length})
              </button>

              <button
                onClick={() => setWorkloadStatusFilter("divergent")}
                style={{
                  background: workloadStatusFilter === "divergent" ? "#744210" : "#1a202c",
                  color: workloadStatusFilter === "divergent" ? "#fbd38d" : "#a0aec0",
                  border: "1px solid #d69e2e",
                  padding: "4px 10px",
                  borderRadius: "16px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ⚠️ Desbalance o Ausentes ({divergentWorkloadsCount})
              </button>

              <button
                onClick={() => setWorkloadStatusFilter("matched")}
                style={{
                  background: workloadStatusFilter === "matched" ? "#22543d" : "#1a202c",
                  color: workloadStatusFilter === "matched" ? "#68d391" : "#a0aec0",
                  border: "1px solid #48bb78",
                  padding: "4px 10px",
                  borderRadius: "16px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                ✓ Sincronizadas ({workloadsParity.length - divergentWorkloadsCount})
              </button>
            </div>

            {/* Workload Search */}
            <input
              type="text"
              placeholder="🔍 Buscar microservicio / workload..."
              value={workloadSearch}
              onChange={(e) => setWorkloadSearch(e.target.value)}
              style={{
                background: "#1a202c",
                border: "1px solid #4a5568",
                color: "#fff",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "12px",
                minWidth: "220px",
                outline: "none",
              }}
            />
          </div>

          {/* Workload Parity Table */}
          <table className="failing-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1a202c", textAlign: "left", fontSize: "12px", color: "#a0aec0", borderBottom: "2px solid #2d3748" }}>
                <th style={{ padding: "10px 12px" }}>Carga de Trabajo (Microservicio)</th>
                <th style={{ padding: "10px 12px" }}>Namespace</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Réplicas en {nameA}</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>Réplicas en {nameB}</th>
                <th style={{ padding: "10px 12px" }}>Estado de Paridad</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkloads.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "20px", color: "#a0aec0" }}>
                    No se encontraron cargas de trabajo que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredWorkloads.map((w) => {
                  const isMatched = w.status === "matched";
                  const isOnlyA = w.status === "only_in_a";
                  const isOnlyB = w.status === "only_in_b";
                  const isUnbalanced = w.status === "unbalanced";

                  return (
                    <tr
                      key={`${w.namespace}/${w.name}`}
                      style={{
                        borderBottom: "1px solid #2d3748",
                        fontSize: "12px",
                        background: !isMatched ? "rgba(236, 201, 75, 0.04)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600, color: "#e2e8f0" }}>
                        {w.name}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#a0aec0" }}>
                        {w.namespace}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>
                        {w.replicasA > 0 ? (
                          <span style={{ color: w.failingA > 0 ? "#fc8181" : "#48bb78" }}>
                            {w.replicasA} {w.failingA > 0 ? `(${w.failingA} caídos)` : "vivos"}
                          </span>
                        ) : (
                          <span style={{ color: "#718096" }}>0 (Ausente)</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>
                        {w.replicasB > 0 ? (
                          <span style={{ color: w.failingB > 0 ? "#fc8181" : "#48bb78" }}>
                            {w.replicasB} {w.failingB > 0 ? `(${w.failingB} caídos)` : "vivos"}
                          </span>
                        ) : (
                          <span style={{ color: "#718096" }}>0 (Ausente)</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {isMatched && (
                          <span style={{ color: "#48bb78", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            ✓ Idéntico ({w.replicasA} réplicas)
                          </span>
                        )}
                        {isUnbalanced && (
                          <span style={{ color: "#ecc94b", fontWeight: 600 }}>
                            ⚠️ Desbalance ({w.replicasA} vs {w.replicasB})
                          </span>
                        )}
                        {isOnlyA && (
                          <span style={{ color: "#fc8181", fontWeight: 600 }}>
                            🔴 Solo en {nameA} (Falta en {nameB})
                          </span>
                        )}
                        {isOnlyB && (
                          <span style={{ color: "#fc8181", fontWeight: 600 }}>
                            🔴 Solo en {nameB} (Falta en {nameA})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 3. NAMESPACES TAB */}
      {activeDriftTab === "namespaces" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "12px" }}>
          
          {/* Only in A */}
          <div style={{ background: "#1a202c", padding: "14px", borderRadius: "8px", border: "1px solid #4a5568" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "#fbd38d", fontSize: "13px" }}>
              Namespaces únicos en {nameA} ({onlyInA.length}):
            </h4>
            {onlyInA.length > 0 ? (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {onlyInA.map((ns) => (
                  <span key={ns} style={{ background: "#744210", color: "#fbd38d", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                    {ns}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: "#a0aec0", fontSize: "12px" }}>Ninguno exclusivo (todos están presentes en {nameB})</span>
            )}
          </div>

          {/* Only in B */}
          <div style={{ background: "#1a202c", padding: "14px", borderRadius: "8px", border: "1px solid #4a5568" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "#feb2b2", fontSize: "13px" }}>
              Namespaces únicos en {nameB} ({onlyInB.length}):
            </h4>
            {onlyInB.length > 0 ? (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {onlyInB.map((ns) => (
                  <span key={ns} style={{ background: "#742a2a", color: "#feb2b2", padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                    {ns}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: "#a0aec0", fontSize: "12px" }}>Ninguno exclusivo (todos están presentes en {nameA})</span>
            )}
          </div>

          {/* Common */}
          <div style={{ background: "#1a202c", padding: "14px", borderRadius: "8px", border: "1px solid #2d3748" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "#81e6d9", fontSize: "13px" }}>
              Namespaces compartidos ({common.length}):
            </h4>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {common.map((ns) => (
                <span key={ns} style={{ background: "#234e52", color: "#81e6d9", padding: "3px 8px", borderRadius: "4px", fontSize: "11px" }}>
                  {ns}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. SERVICES TAB */}
      {activeDriftTab === "services" && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            
            {/* Services Cluster A */}
            <div style={{ background: "#1a202c", padding: "16px", borderRadius: "8px", border: "1px solid #4a5568" }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#63b3ed", fontSize: "14px" }}>
                {nameA} (Total: {clusterA.services.total})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                <div>ClusterIP: <strong>{clusterA.services.byType.ClusterIP}</strong></div>
                <div>NodePort: <strong>{clusterA.services.byType.NodePort}</strong></div>
                <div>LoadBalancer: <strong>{clusterA.services.byType.LoadBalancer}</strong></div>
                {clusterA.services.orphanCount > 0 && (
                  <div style={{ color: "#f6ad55", fontWeight: 600, marginTop: "6px" }}>
                    ⚠️ {clusterA.services.orphanCount} servicio(s) huérfanos (sin endpoints)
                  </div>
                )}
              </div>
            </div>

            {/* Services Cluster B */}
            <div style={{ background: "#1a202c", padding: "16px", borderRadius: "8px", border: "1px solid #4a5568" }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#f6e05e", fontSize: "14px" }}>
                {nameB} (Total: {clusterB.services.total})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                <div>ClusterIP: <strong>{clusterB.services.byType.ClusterIP}</strong></div>
                <div>NodePort: <strong>{clusterB.services.byType.NodePort}</strong></div>
                <div>LoadBalancer: <strong>{clusterB.services.byType.LoadBalancer}</strong></div>
                {clusterB.services.orphanCount > 0 && (
                  <div style={{ color: "#f6ad55", fontWeight: 600, marginTop: "6px" }}>
                    ⚠️ {clusterB.services.orphanCount} servicio(s) huérfanos (sin endpoints)
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
