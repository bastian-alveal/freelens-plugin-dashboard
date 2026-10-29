import React, { useState, useMemo } from "react";
import { ClusterSummary, PodDetail } from "../../common/types";

interface Props {
  clusters: ClusterSummary[];
  initialClusterId?: string;
  initialStatusCategory?: "all" | "healthy" | "failing" | "pending";
  onOpenLogs?: (clusterId: string, clusterName: string, namespace: string, podName: string) => void;
  onOpenShell?: (clusterId: string, clusterName: string, namespace: string, podName: string) => void;
  onOpenManifest?: (clusterId: string, clusterName: string, namespace: string, podName: string) => void;
  invokeIpc?: (channel: string, ...args: any[]) => Promise<any>;
  onRefreshTelemetry?: () => void;
}

function formatAge(timestamp?: string): string {
  if (!timestamp) return "Reciente";
  const diff = Date.now() - new Date(timestamp).getTime();
  if (isNaN(diff) || diff < 0) return "Reciente";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export const PodsInspector: React.FC<Props> = ({
  clusters,
  initialClusterId = "all",
  initialStatusCategory = "all",
  onOpenLogs,
  onOpenShell,
  onOpenManifest,
  invokeIpc,
  onRefreshTelemetry,
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>(initialClusterId);
  const [statusFilter, setStatusFilter] = useState<"all" | "healthy" | "failing" | "pending">(initialStatusCategory);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Sorting State (default: newest pods first)
  type SortField = "clusterName" | "namespace" | "name" | "statusCategory" | "restarts" | "age";
  type SortOrder = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("age");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Pagination & Actions
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [podToRestart, setPodToRestart] = useState<PodDetail | null>(null);
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Contextual Pod Action Menu State (declutters table)
  const [activeActionPod, setActiveActionPod] = useState<PodDetail | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Close contextual action menu on click outside or ESC
  React.useEffect(() => {
    if (!activeActionPod) return;
    const handleOutsideClick = () => setActiveActionPod(null);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveActionPod(null);
    };
    window.addEventListener("click", handleOutsideClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [activeActionPod]);

  // Close restart modal on ESC
  React.useEffect(() => {
    if (!podToRestart) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRestarting) {
        setPodToRestart(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [podToRestart, isRestarting]);

  // Update filter if initial props change
  React.useEffect(() => {
    if (initialClusterId) setSelectedClusterId(initialClusterId);
  }, [initialClusterId]);

  React.useEffect(() => {
    if (initialStatusCategory) setStatusFilter(initialStatusCategory);
  }, [initialStatusCategory]);

  // Aggregate all pods across active clusters
  const allPods = useMemo<PodDetail[]>(() => {
    const list: PodDetail[] = [];
    for (const c of clusters) {
      const clusterDisplayName = c.alias || c.name;
      if (c.allPods && c.allPods.length > 0) {
        for (const p of c.allPods) {
          list.push({
            ...p,
            clusterName: clusterDisplayName,
          });
        }
      } else if (c.unhealthyPods && c.unhealthyPods.length > 0) {
        // Fallback for unhealthyPods
        for (const p of c.unhealthyPods) {
          list.push({
            name: p.name,
            namespace: p.namespace,
            clusterId: c.id,
            clusterName: clusterDisplayName,
            statusCategory: "failing",
            phase: p.phase,
            reason: p.reason,
            message: p.message,
            restarts: p.restarts,
            readyContainers: "0/1",
            age: p.age,
          });
        }
      }
    }
    return list;
  }, [clusters]);

  // Compute counts for filter pills
  const counts = useMemo(() => {
    let source = allPods;
    if (selectedClusterId !== "all") {
      source = source.filter((p) => p.clusterId === selectedClusterId);
    }
    return {
      all: source.length,
      healthy: source.filter((p) => p.statusCategory === "healthy").length,
      failing: source.filter((p) => p.statusCategory === "failing").length,
      pending: source.filter((p) => p.statusCategory === "pending").length,
    };
  }, [allPods, selectedClusterId]);

  // Filtered pods based on UI controls
  const filteredPods = useMemo(() => {
    return allPods.filter((pod) => {
      // 1. Cluster Filter
      if (selectedClusterId !== "all" && pod.clusterId !== selectedClusterId) {
        return false;
      }
      // 2. Status Filter
      if (statusFilter !== "all" && pod.statusCategory !== statusFilter) {
        return false;
      }
      // 3. Search query (matches pod name or namespace)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = pod.name.toLowerCase().includes(q);
        const matchNs = pod.namespace.toLowerCase().includes(q);
        const matchReason = pod.reason.toLowerCase().includes(q);
        if (!matchName && !matchNs && !matchReason) {
          return false;
        }
      }
      return true;
    });
  }, [allPods, selectedClusterId, statusFilter, searchQuery]);

  // Sort pods based on sortField & sortOrder
  const sortedPods = useMemo(() => {
    const list = [...filteredPods];
    const getTime = (timestamp?: string) => {
      if (!timestamp) return 0;
      const t = new Date(timestamp).getTime();
      return isNaN(t) ? 0 : t;
    };

    list.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "age": {
          comparison = getTime(a.age) - getTime(b.age);
          break;
        }
        case "statusCategory": {
          const weight = (s: string) => (s === "failing" ? 3 : s === "pending" ? 2 : 1);
          comparison = weight(a.statusCategory) - weight(b.statusCategory);
          break;
        }
        case "restarts": {
          comparison = (a.restarts || 0) - (b.restarts || 0);
          break;
        }
        case "name": {
          comparison = a.name.localeCompare(b.name);
          break;
        }
        case "namespace": {
          comparison = a.namespace.localeCompare(b.namespace);
          break;
        }
        case "clusterName": {
          comparison = (a.clusterName || "").localeCompare(b.clusterName || "");
          break;
        }
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
    return list;
  }, [filteredPods, sortField, sortOrder]);

  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      if (field === "age" || field === "statusCategory" || field === "restarts") {
        setSortOrder("desc");
      } else {
        setSortOrder("asc");
      }
    }
  };

  // Reset to page 1 whenever filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [selectedClusterId, statusFilter, searchQuery, pageSize, sortField, sortOrder]);

  const totalPages = Math.ceil(sortedPods.length / pageSize) || 1;
  const paginatedPods = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedPods.slice(start, start + pageSize);
  }, [sortedPods, currentPage, pageSize]);

  const handleConfirmRestart = async () => {
    if (!podToRestart || !invokeIpc) return;
    setIsRestarting(true);
    try {
      const res = await invokeIpc("restart-pod", {
        clusterId: podToRestart.clusterId,
        namespace: podToRestart.namespace,
        podName: podToRestart.name,
      });
      if (res && res.success) {
        setToastMessage({ type: "success", text: res.message || "Pod reiniciado correctamente." });
        if (onRefreshTelemetry) {
          setTimeout(() => onRefreshTelemetry(), 1500);
        }
      } else {
        setToastMessage({ type: "error", text: res?.message || "No se pudo reiniciar el pod." });
      }
    } catch (err: any) {
      setToastMessage({ type: "error", text: `Error: ${err?.message || err}` });
    } finally {
      setIsRestarting(false);
      setPodToRestart(null);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  return (
    <div className="pods-inspector" style={{ background: "#20222a", borderRadius: "8px", border: "1px solid #2d3748", padding: "16px", marginTop: "12px", position: "relative" }}>
      {/* Toast Alert */}
      {toastMessage && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            backgroundColor: toastMessage.type === "success" ? "#238636" : "#da3633",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            fontSize: "12px",
            fontWeight: 600,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>{toastMessage.type === "success" ? "✓" : "⚠️"}</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Control Bar: Filters and Search */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
        
        {/* Cluster Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "#a0aec0", fontWeight: 600 }}>Clúster:</span>
          <select
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
            style={{
              background: "#1a202c",
              border: "1px solid #4a5568",
              color: "#63b3ed",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 600,
              outline: "none",
            }}
          >
            <option value="all">🌐 Todos los clústeres ({clusters.length})</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.alias || c.name} ({c.pods.total} pods)
              </option>
            ))}
          </select>
        </div>

        {/* Status Category Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => setStatusFilter("all")}
            style={{
              background: statusFilter === "all" ? "#3182ce" : "#1a202c",
              color: statusFilter === "all" ? "#fff" : "#cbd5e0",
              border: statusFilter === "all" ? "1px solid #63b3ed" : "1px solid #4a5568",
              borderRadius: "20px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Todos ({counts.all})
          </button>

          <button
            onClick={() => setStatusFilter("healthy")}
            style={{
              background: statusFilter === "healthy" ? "#38a169" : "#1a202c",
              color: statusFilter === "healthy" ? "#fff" : "#cbd5e0",
              border: statusFilter === "healthy" ? "1px solid #48bb78" : "1px solid #4a5568",
              borderRadius: "20px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🟢 Vivos ({counts.healthy})
          </button>

          <button
            onClick={() => setStatusFilter("failing")}
            style={{
              background: statusFilter === "failing" ? "#e53e3e" : "#1a202c",
              color: statusFilter === "failing" ? "#fff" : "#cbd5e0",
              border: statusFilter === "failing" ? "1px solid #f56565" : "1px solid #4a5568",
              borderRadius: "20px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🔴 Fallo / Muertos ({counts.failing})
          </button>

          <button
            onClick={() => setStatusFilter("pending")}
            style={{
              background: statusFilter === "pending" ? "#d69e2e" : "#1a202c",
              color: statusFilter === "pending" ? "#fff" : "#cbd5e0",
              border: statusFilter === "pending" ? "1px solid #ecc94b" : "1px solid #4a5568",
              borderRadius: "20px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🟡 En Transición ({counts.pending})
          </button>
        </div>

        {/* Quick Sort Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "#a0aec0", fontWeight: 600 }}>Ordenar:</span>
          <select
            value={`${sortField}-${sortOrder}`}
            onChange={(e) => {
              const [f, o] = e.target.value.split("-") as [SortField, SortOrder];
              setSortField(f);
              setSortOrder(o);
            }}
            style={{
              background: "#1a202c",
              border: "1px solid #4a5568",
              color: "#63b3ed",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="age-desc">🕒 Más recientes primero</option>
            <option value="age-asc">⏳ Más antiguos primero</option>
            <option value="statusCategory-desc">🔴 Fallos y errores primero</option>
            <option value="statusCategory-asc">🟢 Vivos y saludables primero</option>
            <option value="restarts-desc">🔄 Más reinicios primero</option>
            <option value="restarts-asc">🔄 Menos reinicios primero</option>
            <option value="name-asc">🔤 Nombre (A → Z)</option>
            <option value="name-desc">🔤 Nombre (Z → A)</option>
            <option value="namespace-asc">📁 Namespace (A → Z)</option>
            <option value="clusterName-asc">🌐 Clúster (A → Z)</option>
          </select>
        </div>

        {/* Real-time Search Box */}
        <div style={{ position: "relative", minWidth: "220px" }}>
          <input
            type="text"
            placeholder="🔍 Filtrar por pod, namespace o fallo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "#1a202c",
              border: "1px solid #4a5568",
              color: "#fff",
              borderRadius: "6px",
              padding: "5px 10px",
              fontSize: "12px",
              width: "100%",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: "6px",
                top: "5px",
                background: "transparent",
                border: "none",
                color: "#a0aec0",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Results Header Info & Pagination Controls */}
      <div style={{ fontSize: "12px", color: "#a0aec0", marginBottom: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <span>
          Mostrando <strong>{sortedPods.length}</strong> de {counts.all} pods
          {selectedClusterId !== "all" && " en el clúster seleccionado"}
          {statusFilter !== "all" && ` (${statusFilter === "healthy" ? "Vivos" : statusFilter === "failing" ? "Fallo / Muertos" : "En transición"})`}
        </span>

        {/* Page size picker */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Mostrar:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={{
              background: "#1a202c",
              border: "1px solid #4a5568",
              color: "#cbd5e0",
              borderRadius: "4px",
              padding: "2px 6px",
              fontSize: "11px",
              outline: "none",
            }}
          >
            <option value={25}>25 por pág.</option>
            <option value={50}>50 por pág.</option>
            <option value={100}>100 por pág.</option>
          </select>
        </div>
      </div>

      {/* Pods Table */}
      {sortedPods.length === 0 ? (
        <div className="empty-state" style={{ padding: "30px 20px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>
            {statusFilter === "failing" ? "🎉" : "🔍"}
          </div>
          <h4 style={{ margin: "0 0 4px 0", color: statusFilter === "failing" ? "#48bb78" : "#e2e8f0" }}>
            {statusFilter === "failing"
              ? "¡No hay pods caídos ni con fallos en esta selección!"
              : "No se encontraron pods que coincidan con los filtros."}
          </h4>
          <p style={{ margin: 0, fontSize: "12px", color: "#a0aec0" }}>
            {searchQuery ? "Intenta con otro término de búsqueda." : "Prueba seleccionando otro estado o clúster."}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="failing-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1a202c", textAlign: "left", fontSize: "12px", color: "#a0aec0", borderBottom: "2px solid #2d3748" }}>
                <th
                  onClick={() => handleToggleSort("clusterName")}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "clusterName" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "clusterName" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Clúster"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Clúster</span>
                    <span style={{ fontSize: "10px", color: sortField === "clusterName" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "clusterName" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th
                  onClick={() => handleToggleSort("namespace")}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "namespace" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "namespace" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Namespace"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Namespace</span>
                    <span style={{ fontSize: "10px", color: sortField === "namespace" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "namespace" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th
                  onClick={() => handleToggleSort("name")}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "name" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "name" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Nombre del Pod"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Nombre del Pod</span>
                    <span style={{ fontSize: "10px", color: sortField === "name" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "name" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th style={{ padding: "10px 8px", textAlign: "center" }}>Contenedores</th>
                <th
                  onClick={() => handleToggleSort("statusCategory")}
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "statusCategory" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "statusCategory" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Estado (Errores primero o Vivos primero)"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Estado / Fase</span>
                    <span style={{ fontSize: "10px", color: sortField === "statusCategory" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "statusCategory" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th
                  onClick={() => handleToggleSort("restarts")}
                  style={{
                    padding: "10px 8px",
                    textAlign: "center",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "restarts" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "restarts" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Cantidad de Reinicios"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Reinicios</span>
                    <span style={{ fontSize: "10px", color: sortField === "restarts" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "restarts" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th
                  onClick={() => handleToggleSort("age")}
                  style={{
                    padding: "10px 10px",
                    cursor: "pointer",
                    userSelect: "none",
                    color: sortField === "age" ? "#63b3ed" : "#a0aec0",
                    background: sortField === "age" ? "rgba(99, 179, 237, 0.08)" : "transparent",
                  }}
                  title="Ordenar por Edad / Creación del Pod"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>Edad</span>
                    <span style={{ fontSize: "10px", color: sortField === "age" ? "#63b3ed" : "#4a5568" }}>
                      {sortField === "age" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  </span>
                </th>
                <th style={{ padding: "10px 12px" }}>Diagnóstico / Mensaje</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedPods.map((pod, idx) => {
                const isFailed = pod.statusCategory === "failing";
                const isPending = pod.statusCategory === "pending";
                return (
                  <tr
                    key={`${pod.clusterId}-${pod.namespace}-${pod.name}-${idx}`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName !== "BUTTON" && target.tagName !== "INPUT" && target.tagName !== "A") {
                        setActiveActionPod(activeActionPod?.name === pod.name && activeActionPod?.clusterId === pod.clusterId ? null : pod);
                        setActionMenuPos({ x: e.clientX, y: e.clientY });
                      }
                    }}
                    style={{
                      borderBottom: "1px solid #2d3748",
                      fontSize: "12px",
                      background: activeActionPod?.name === pod.name && activeActionPod?.clusterId === pod.clusterId
                        ? "rgba(56, 189, 248, 0.12)"
                        : isFailed
                        ? "rgba(245, 101, 101, 0.05)"
                        : "transparent",
                      cursor: "pointer",
                      transition: "background 0.15s ease",
                    }}
                    className="pod-row"
                  >
                    {/* Cluster Name */}
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ fontWeight: 600, color: "#63b3ed" }}>{pod.clusterName}</span>
                    </td>

                    {/* Namespace */}
                    <td style={{ padding: "8px 12px", color: "#cbd5e0" }}>{pod.namespace}</td>

                    {/* Pod Name */}
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600, color: isFailed ? "#feb2b2" : "#e2e8f0" }}>
                      {pod.name}
                    </td>

                    {/* Ready Containers */}
                    <td style={{ padding: "8px 8px", textAlign: "center", color: "#a0aec0", fontFamily: "monospace" }}>
                      {pod.readyContainers}
                    </td>

                    {/* Status Badge */}
                    <td style={{ padding: "8px 12px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          background: isFailed
                            ? pod.reason === "OOMKilled"
                              ? "#742a2a"
                              : "#9b2c2c"
                            : isPending
                            ? "#744210"
                            : "rgba(72, 187, 120, 0.15)",
                          color: isFailed
                            ? "#feb2b2"
                            : isPending
                            ? "#fbd38d"
                            : "#68d391",
                          border: isFailed
                            ? "1px solid #e53e3e"
                            : isPending
                            ? "1px solid #d69e2e"
                            : "1px solid #38a169",
                        }}
                      >
                        {pod.reason}
                      </span>
                    </td>

                    {/* Restarts */}
                    <td
                      style={{
                        padding: "8px 8px",
                        textAlign: "center",
                        fontWeight: pod.restarts > 0 ? 700 : 400,
                        color: pod.restarts > 5 ? "#fc8181" : pod.restarts > 0 ? "#ecc94b" : "#718096",
                      }}
                    >
                      {pod.restarts}
                    </td>

                    {/* Age */}
                    <td style={{ padding: "8px 10px", color: "#a0aec0" }}>
                      {formatAge(pod.age)}
                    </td>

                    {/* Diagnostic Message */}
                    <td
                      style={{
                        padding: "8px 12px",
                        color: isFailed ? "#fbd38d" : "#a0aec0",
                        fontSize: "11px",
                        maxWidth: "280px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={pod.message}
                    >
                      {pod.message}
                    </td>

                    {/* Clean Contextual Actions Trigger */}
                    <td style={{ padding: "6px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionPod(activeActionPod?.name === pod.name && activeActionPod?.clusterId === pod.clusterId ? null : pod);
                          setActionMenuPos({ x: e.clientX, y: e.clientY });
                        }}
                        style={{
                          background: activeActionPod?.name === pod.name && activeActionPod?.clusterId === pod.clusterId ? "#38bdf8" : "#1e293b",
                          color: activeActionPod?.name === pod.name && activeActionPod?.clusterId === pod.clusterId ? "#000000" : "#e2e8f0",
                          border: "1px solid #334155",
                          borderRadius: "5px",
                          padding: "4px 10px",
                          fontSize: "11px",
                          cursor: "pointer",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          transition: "all 0.15s ease",
                        }}
                        title="Seleccionar y ver opciones de acción para este pod"
                      >
                        <span>⚡ Acciones</span>
                        <span style={{ fontSize: "8px" }}>▼</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "14px",
            paddingTop: "10px",
            borderTop: "1px solid #2d3748",
            fontSize: "12px",
            color: "#a0aec0",
          }}
        >
          <span>
            Página <strong>{currentPage}</strong> de {totalPages} ({filteredPods.length} pods en total)
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              style={{
                background: "#1a202c",
                border: "1px solid #4a5568",
                color: currentPage <= 1 ? "#718096" : "#cbd5e0",
                borderRadius: "4px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: currentPage <= 1 ? "not-allowed" : "pointer",
              }}
            >
              ◀ Anterior
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              style={{
                background: "#1a202c",
                border: "1px solid #4a5568",
                color: currentPage >= totalPages ? "#718096" : "#cbd5e0",
                borderRadius: "4px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
              }}
            >
              Siguiente ▶
            </button>
          </div>
        </div>
      )}

      {/* Pod Restart Confirmation Modal */}
      {podToRestart && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRestarting) {
              setPodToRestart(null);
            }
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#161b22",
              border: "1px solid #f85149",
              borderRadius: "10px",
              padding: "20px",
              maxWidth: "480px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
              <span style={{ fontSize: "24px" }}>⚠️</span>
              <h3 style={{ margin: 0, color: "#f85149", fontSize: "16px" }}>¿Reiniciar este Pod?</h3>
            </div>
            <p style={{ fontSize: "13px", color: "#c9d1d9", lineHeight: "1.5", margin: "0 0 14px 0" }}>
              Estás a punto de eliminar el pod <code style={{ color: "#58a6ff", fontWeight: 700 }}>{podToRestart.name}</code> en el namespace <code style={{ color: "#79c0ff" }}>{podToRestart.namespace}</code> ({podToRestart.clusterName}).
            </p>
            <p style={{ fontSize: "12px", color: "#8b949e", margin: "0 0 20px 0" }}>
              Kubernetes lo regenerará automáticamente si está respaldado por un Deployment, StatefulSet o DaemonSet.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => setPodToRestart(null)}
                disabled={isRestarting}
                style={{
                  background: "#21262d",
                  border: "1px solid #30363d",
                  color: "#c9d1d9",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmRestart}
                disabled={isRestarting}
                style={{
                  background: "#da3633",
                  border: "none",
                  color: "#fff",
                  borderRadius: "6px",
                  padding: "6px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {isRestarting ? "Reiniciando..." : "Sí, Reiniciar Pod"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Action Popover on Selected Pod */}
      {activeActionPod && (
        <div
          style={{
            position: "fixed",
            top: Math.min(actionMenuPos.y + 6, window.innerHeight - 260),
            left: Math.min(actionMenuPos.x - 170, window.innerWidth - 240),
            backgroundColor: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: "8px",
            boxShadow: "0 12px 28px rgba(0, 0, 0, 0.75)",
            zIndex: 9999,
            minWidth: "220px",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popover Header */}
          <div style={{ padding: "8px 12px", backgroundColor: "#161b22", borderBottom: "1px solid #21262d" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#f0f6fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeActionPod.name}
            </div>
            <div style={{ fontSize: "10px", color: "#8b949e", marginTop: "2px" }}>
              {activeActionPod.clusterName} • ns: {activeActionPod.namespace}
            </div>
          </div>

          {/* Action Items */}
          <div style={{ padding: "4px" }}>
            {onOpenLogs && (
              <button
                onClick={() => {
                  onOpenLogs(activeActionPod.clusterId, activeActionPod.clusterName, activeActionPod.namespace, activeActionPod.name);
                  setActiveActionPod(null);
                }}
                className="pod-action-menu-item"
              >
                <span style={{ fontSize: "14px" }}>📄</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "#f0f6fc", fontSize: "11px" }}>Logs (En Vivo)</div>
                  <div style={{ fontSize: "10px", color: "#8b949e" }}>Streaming continuo con filtros</div>
                </div>
              </button>
            )}

            {onOpenShell && (
              <button
                onClick={() => {
                  onOpenShell(activeActionPod.clusterId, activeActionPod.clusterName, activeActionPod.namespace, activeActionPod.name);
                  setActiveActionPod(null);
                }}
                className="pod-action-menu-item"
              >
                <span style={{ fontSize: "14px", color: "#a78bfa" }}>&gt;_</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "#f0f6fc", fontSize: "11px" }}>Terminal Shell (Exec)</div>
                  <div style={{ fontSize: "10px", color: "#8b949e" }}>Comandos de diagnóstico en pod</div>
                </div>
              </button>
            )}

            {onOpenManifest && (
              <button
                onClick={() => {
                  onOpenManifest(activeActionPod.clusterId, activeActionPod.clusterName, activeActionPod.namespace, activeActionPod.name);
                  setActiveActionPod(null);
                }}
                className="pod-action-menu-item"
              >
                <span style={{ fontSize: "14px" }}>📋</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "#f0f6fc", fontSize: "11px" }}>Estructura del Manifiesto</div>
                  <div style={{ fontSize: "10px", color: "#8b949e" }}>Especificación YAML / JSON</div>
                </div>
              </button>
            )}

            <div style={{ height: "1px", backgroundColor: "#21262d", margin: "4px 0" }} />

            {invokeIpc && (
              <button
                onClick={() => {
                  setPodToRestart(activeActionPod);
                  setActiveActionPod(null);
                }}
                className="pod-action-menu-item danger"
              >
                <span style={{ fontSize: "14px" }}>🔄</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600, color: "#f85149", fontSize: "11px" }}>Reiniciar / Eliminar Pod</div>
                  <div style={{ fontSize: "10px", color: "#ff7b72" }}>Re-creación automática por K8s</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
