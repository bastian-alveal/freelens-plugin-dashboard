import React, { useState } from "react";
import { ClusterSummary } from "../../common/types";

interface Props {
  cluster: ClusterSummary;
  isActive?: boolean;
  onDisassociate?: (clusterId: string) => void;
  onRename?: (clusterId: string, newAlias: string) => void;
  onToggleScan?: (clusterId: string) => void;
  onCompare?: (clusterId: string) => void;
  onInspectPods?: (clusterId: string, statusCategory: "all" | "healthy" | "failing" | "pending") => void;
}

export const ClusterCard: React.FC<Props> = ({
  cluster,
  isActive = true,
  onDisassociate,
  onRename,
  onToggleScan,
  onCompare,
  onInspectPods,
}) => {
  const { pods, services, nodes, status } = cluster;
  const isUnreachable = status === "unreachable";

  const [isEditingName, setIsEditingName] = useState(false);
  const [aliasInput, setAliasInput] = useState(cluster.alias || "");

  const displayName = cluster.alias || cluster.name;

  const handleSaveName = () => {
    setIsEditingName(false);
    if (onRename && aliasInput.trim() !== (cluster.alias || "")) {
      onRename(cluster.id, aliasInput.trim());
    }
  };

  const healthyPct = pods.total > 0 ? (pods.healthy / pods.total) * 100 : 100;
  const failingPct = pods.total > 0 ? (pods.failing / pods.total) * 100 : 0;
  const pendingPct = pods.total > 0 ? ((pods.pending + pods.terminating) / pods.total) * 100 : 0;

  return (
    <div
      className={`cluster-card ${!isActive ? "cluster-card-paused" : ""}`}
      style={{
        opacity: isActive ? 1 : 0.7,
        border: isActive ? "1px solid #2d3748" : "1px dashed #4a5568",
        transition: "all 0.2s ease",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Card Header: Title, Alias, Edit, and Top-Right Actions */}
      <div className="cluster-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="cluster-name-block" style={{ flex: 1, minWidth: 0 }}>
          {isEditingName ? (
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
              <input
                type="text"
                value={aliasInput}
                placeholder="Nombre descriptivo..."
                autoFocus
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setIsEditingName(false);
                }}
                style={{
                  background: "#1a202c",
                  border: "1px solid #63b3ed",
                  color: "#fff",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: 600,
                  outline: "none",
                  width: "100%",
                }}
              />
              <button
                onClick={handleSaveName}
                style={{
                  background: "#3182ce",
                  border: "none",
                  color: "#fff",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Guardar
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className={`status-dot ${status}`} />
              <h3
                style={{
                  margin: 0,
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#ffffff",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title="Haz clic para renombrar este clúster"
                onClick={() => setIsEditingName(true)}
              >
                {displayName}
              </h3>
              <button
                onClick={() => setIsEditingName(true)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#718096",
                  cursor: "pointer",
                  fontSize: "12px",
                  padding: "0 2px",
                }}
                title="Renombrar alias"
              >
                ✏️
              </button>
            </div>
          )}

          {/* Subtitle with context / server */}
          <div className="cluster-meta" style={{ fontSize: "11px", color: "#a0aec0", marginTop: "3px", wordBreak: "break-all" }}>
            {cluster.alias && (
              <span style={{ color: "#718096", marginRight: "4px" }}>({cluster.name})</span>
            )}
            <span style={{ color: "#4299e1" }}>{cluster.serverUrl.replace(/^https?:\/\//, "")}</span> •{" "}
            <span style={{ color: cluster.latencyMs > 0 ? (cluster.latencyMs < 200 ? "#48bb78" : "#ecc94b") : "#fc8181" }}>
              {cluster.latencyMs > 0 ? `${cluster.latencyMs}ms` : "Sin conexión"}
            </span>
          </div>
        </div>

        {/* Top-Right: Version badge and Disassociate button */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px", flexShrink: 0 }}>
          <span className="badge-version" style={{ fontSize: "11px", padding: "2px 6px" }}>
            {cluster.k8sVersion}
          </span>
          {onDisassociate && (
            <button
              className="disassociate-btn"
              onClick={() => onDisassociate(cluster.id)}
              title="Desasociar este clúster del Dashboard"
              style={{
                background: "transparent",
                border: "none",
                color: "#718096",
                cursor: "pointer",
                fontSize: "12px",
                padding: "2px 4px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Internal Action Bar (Always stays neatly inside the card) */}
      <div
        className="cluster-card-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingBottom: "8px",
          borderBottom: "1px solid #2d3748",
        }}
      >
        {onToggleScan && (
          <button
            onClick={() => onToggleScan(cluster.id)}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              background: isActive ? "#2b6cb0" : "#2d3748",
              border: isActive ? "1px solid #4299e1" : "1px solid #4a5568",
              color: isActive ? "#ffffff" : "#a0aec0",
              padding: "5px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            title={isActive ? "Pausar este clúster del escaneo activo" : "Reactivar e incluir en el escaneo"}
          >
            <span>{isActive ? "⚡ Activo" : "⏸️ Pausado"}</span>
          </button>
        )}

        {onCompare && (
          <button
            onClick={() => onCompare(cluster.id)}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              background: "#2d3748",
              border: "1px solid #4a5568",
              color: "#e2e8f0",
              padding: "5px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            title="Comparar diferencias (drift) contra otro clúster"
          >
            <span>⚖️ Comparar</span>
          </button>
        )}
      </div>

      {isUnreachable ? (
        <div style={{ color: "#fc8181", fontSize: "12px", padding: "8px 0", background: "rgba(252, 129, 129, 0.1)", borderRadius: "6px", textAlign: "center" }}>
          ⚠️ {cluster.errorMessage || "No se pudo conectar con este clúster"}
        </div>
      ) : (
        <>
          {/* Pods Telemetry */}
          <div>
            <div className="card-section-title" style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e0", marginBottom: "4px" }}>
              Pods ({pods.total} en total)
            </div>
            <div className="pod-status-bar" style={{ height: "6px", borderRadius: "3px", overflow: "hidden", display: "flex", background: "#1a202c", margin: "4px 0 6px 0" }}>
              <div className="pod-bar-segment green" style={{ width: `${healthyPct}%`, background: "#48bb78" }} />
              <div className="pod-bar-segment red" style={{ width: `${failingPct}%`, background: "#f56565" }} />
              <div className="pod-bar-segment yellow" style={{ width: `${pendingPct}%`, background: "#ecc94b" }} />
            </div>
            <div className="pod-status-counts" style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
              <span
                onClick={() => onInspectPods && onInspectPods(cluster.id, "healthy")}
                style={{ color: "#48bb78", fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px" }}
                title="Ver lista de pods vivos en este clúster"
              >
                🟢 {pods.healthy} Vivos
              </span>
              <span
                onClick={() => onInspectPods && onInspectPods(cluster.id, "failing")}
                style={{
                  color: pods.failing > 0 ? "#fc8181" : "#a0aec0",
                  fontWeight: pods.failing > 0 ? 700 : 400,
                  cursor: "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
                title="Inspeccionar pods con fallos o caídos en este clúster"
              >
                🔴 {pods.failing} Muertos
              </span>
              <span
                onClick={() => onInspectPods && onInspectPods(cluster.id, "pending")}
                style={{ color: "#ecc94b", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "3px" }}
                title="Ver pods pendientes o en transición en este clúster"
              >
                🟡 {pods.pending + pods.terminating} Otros
              </span>
            </div>
          </div>

          {/* Services Telemetry */}
          <div>
            <div className="card-section-title" style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e0", marginBottom: "4px" }}>
              Services ({services.total})
            </div>
            <div style={{ fontSize: "11px", display: "flex", justifyContent: "space-between", color: "#a0aec0", background: "#1a202c", padding: "4px 8px", borderRadius: "4px" }}>
              <span>ClusterIP: <strong style={{ color: "#e2e8f0" }}>{services.byType.ClusterIP}</strong></span>
              <span>NodePort: <strong style={{ color: "#e2e8f0" }}>{services.byType.NodePort}</strong></span>
              <span>LB: <strong style={{ color: "#e2e8f0" }}>{services.byType.LoadBalancer}</strong></span>
            </div>
            {services.orphanCount > 0 && (
              <div style={{ fontSize: "11px", color: "#f6ad55", marginTop: "4px", fontWeight: 600 }}>
                ⚠️ {services.orphanCount} servicio(s) huérfano(s) (sin endpoints)
              </div>
            )}
          </div>

          {/* Resource Consumption Telemetry (Metrics Server) */}
          {cluster.metrics && cluster.metrics.available && (
            <div>
              <div
                className="card-section-title"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#cbd5e0",
                  marginBottom: "4px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>Consumo en Vivo</span>
                <span style={{ fontSize: "10px", color: "#48bb78", fontWeight: 500 }}>● metrics-server</span>
              </div>

              {/* CPU Usage Bar */}
              <div style={{ marginBottom: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                  <span style={{ color: "#a0aec0" }}>CPU</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                    {cluster.metrics.totalCpuPercent ?? 0}% {cluster.metrics.cpuUsedFormatted ? `(${cluster.metrics.cpuUsedFormatted})` : ""}
                  </span>
                </div>
                <div style={{ height: "6px", borderRadius: "3px", overflow: "hidden", background: "#1a202c" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(0, cluster.metrics.totalCpuPercent ?? 0))}%`,
                      background:
                        (cluster.metrics.totalCpuPercent ?? 0) > 85
                          ? "#f56565"
                          : (cluster.metrics.totalCpuPercent ?? 0) > 65
                          ? "#ecc94b"
                          : "#48bb78",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>

              {/* Memory Usage Bar */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                  <span style={{ color: "#a0aec0" }}>Memoria</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                    {cluster.metrics.totalMemoryPercent ?? 0}% {cluster.metrics.memoryUsedFormatted ? `(${cluster.metrics.memoryUsedFormatted})` : ""}
                  </span>
                </div>
                <div style={{ height: "6px", borderRadius: "3px", overflow: "hidden", background: "#1a202c" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(0, cluster.metrics.totalMemoryPercent ?? 0))}%`,
                      background:
                        (cluster.metrics.totalMemoryPercent ?? 0) > 85
                          ? "#f56565"
                          : (cluster.metrics.totalMemoryPercent ?? 0) > 65
                          ? "#ecc94b"
                          : "#38b2ac",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Nodes Telemetry */}
          <div>
            <div className="card-section-title" style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e0", marginBottom: "4px" }}>
              Nodos ({nodes.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {nodes.slice(0, 3).map((node) => (
                <div
                  key={node.name}
                  className="node-pill"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#1a202c",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                >
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>
                    <strong style={{ color: "#e2e8f0" }}>{node.name}</strong>{" "}
                    <span style={{ color: "#718096" }}>({node.role})</span>
                  </div>
                  <div className="node-pill-tags" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    {node.cpuPercent !== undefined && (
                      <span
                        style={{ fontSize: "10px", color: "#a0aec0", marginRight: "2px" }}
                        title={`CPU: ${node.cpuUsageCores || ''} (${node.cpuPercent}%) | RAM: ${node.memoryUsageBytes || ''} (${node.memoryPercent || 0}%)`}
                      >
                        ⚡{node.cpuPercent}%
                      </span>
                    )}
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: "3px",
                        fontSize: "10px",
                        fontWeight: 600,
                        background: node.ready ? "rgba(72, 187, 120, 0.2)" : "rgba(245, 101, 101, 0.2)",
                        color: node.ready ? "#48bb78" : "#fc8181",
                      }}
                    >
                      {node.ready ? "Ready" : "NotReady"}
                    </span>
                    {node.diskPressure && <span style={{ background: "#742a2a", color: "#feb2b2", padding: "1px 4px", borderRadius: "3px", fontSize: "9px" }}>DiskP</span>}
                    {node.memoryPressure && <span style={{ background: "#742a2a", color: "#feb2b2", padding: "1px 4px", borderRadius: "3px", fontSize: "9px" }}>MemP</span>}
                  </div>
                </div>
              ))}
            </div>
            {nodes.length > 3 && (
              <div style={{ fontSize: "11px", color: "#718096", textAlign: "right", marginTop: "3px" }}>
                +{nodes.length - 3} nodo(s) adicionales
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
