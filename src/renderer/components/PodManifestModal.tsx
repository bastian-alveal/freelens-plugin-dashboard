import React, { useState, useEffect } from "react";

interface Props {
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  onClose: () => void;
  invokeIpc: (channel: string, ...args: any[]) => Promise<any>;
  docked?: boolean;
}

export const PodManifestModal: React.FC<Props> = ({
  clusterId,
  clusterName,
  namespace,
  podName,
  onClose,
  invokeIpc,
  docked = false,
}) => {
  const [manifest, setManifest] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"summary" | "json">("summary");
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const fetchManifest = async () => {
      setIsLoading(true);
      try {
        const res = await invokeIpc("get-pod-manifest", { clusterId, namespace, podName });
        setManifest(res);
      } catch (err) {
        console.error("Error fetching manifest:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchManifest();
  }, [clusterId, namespace, podName]);

  useEffect(() => {
    if (docked) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, docked]);

  const jsonString = React.useMemo(() => {
    if (!manifest) return "";
    try {
      return JSON.stringify(manifest, null, 2);
    } catch {
      return String(manifest);
    }
  }, [manifest]);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const podSpec = manifest?.spec || {};
  const podStatus = manifest?.status || {};
  const containers = podSpec.containers || [];
  const conditions = podStatus.conditions || [];

  const innerContent = (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#161b22",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Header (only when not docked) */}
      {!docked && (
        <div
          style={{
            padding: "12px 18px",
            backgroundColor: "#0d1117",
            borderBottom: "1px solid #30363d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>📋</span>
            <span style={{ fontWeight: 700, color: "#f0f6fc", fontSize: "14px" }}>
              Manifiesto del Pod: <code style={{ color: "#58a6ff" }}>{podName}</code>
            </span>
            <span
              style={{
                backgroundColor: "#1f6feb22",
                color: "#58a6ff",
                border: "1px solid #1f6feb",
                borderRadius: "12px",
                padding: "2px 8px",
                fontSize: "11px",
              }}
            >
              {clusterName}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#8b949e",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>
      )}

        {/* Tab Controls */}
        <div
          style={{
            padding: "8px 16px",
            backgroundColor: "#161b22",
            borderBottom: "1px solid #21262d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => setActiveTab("summary")}
              style={{
                backgroundColor: activeTab === "summary" ? "#3182ce" : "#21262d",
                color: activeTab === "summary" ? "#fff" : "#8b949e",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              🔍 Resumen Estructurado
            </button>
            <button
              onClick={() => setActiveTab("json")}
              style={{
                backgroundColor: activeTab === "json" ? "#3182ce" : "#21262d",
                color: activeTab === "json" ? "#fff" : "#8b949e",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {"{ }"} JSON / Manifiesto Completo
            </button>
          </div>

          <button
            onClick={handleCopy}
            disabled={!jsonString}
            style={{
              backgroundColor: copied ? "#238636" : "#21262d",
              border: "1px solid #30363d",
              color: copied ? "#fff" : "#c9d1d9",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {copied ? "✓ Copiado" : "📋 Copiar JSON"}
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#0d1117" }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#8b949e" }}>
              <span>🔄 Cargando manifiesto...</span>
            </div>
          ) : !manifest ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#f85149" }}>
              <span>No se pudo obtener el manifiesto del pod.</span>
            </div>
          ) : activeTab === "summary" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px", color: "#c9d1d9" }}>
              {/* Metadata card */}
              <div style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "12px" }}>
                <h4 style={{ margin: "0 0 10px 0", color: "#58a6ff", fontSize: "13px" }}>📌 Metadatos</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                  <div>
                    <span style={{ color: "#8b949e" }}>IP del Pod: </span>
                    <strong style={{ color: "#f0f6fc", fontFamily: "monospace" }}>{podStatus.podIP || "N/A"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#8b949e" }}>Nodo Asignado: </span>
                    <strong style={{ color: "#f0f6fc", fontFamily: "monospace" }}>{podSpec.nodeName || "N/A"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#8b949e" }}>QoS Class: </span>
                    <strong style={{ color: "#f0f6fc" }}>{podStatus.qosClass || "N/A"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#8b949e" }}>Restart Policy: </span>
                    <strong style={{ color: "#f0f6fc" }}>{podSpec.restartPolicy || "Always"}</strong>
                  </div>
                </div>
              </div>

              {/* Containers */}
              <div style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "12px" }}>
                <h4 style={{ margin: "0 0 10px 0", color: "#58a6ff", fontSize: "13px" }}>📦 Contenedores ({containers.length})</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {containers.map((c: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "#0d1117",
                        border: "1px solid #21262d",
                        borderRadius: "6px",
                        padding: "10px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, color: "#79c0ff", fontFamily: "monospace" }}>{c.name}</span>
                        <span style={{ color: "#8b949e", fontSize: "11px" }}>
                          Puertos: {(c.ports || []).map((p: any) => `${p.containerPort}/${p.protocol || "TCP"}`).join(", ") || "Ninguno"}
                        </span>
                      </div>
                      <div style={{ color: "#8b949e", fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all" }}>
                        Imagen: <span style={{ color: "#a5d6ff" }}>{c.image}</span>
                      </div>
                      {c.resources && (c.resources.requests || c.resources.limits) && (
                        <div style={{ marginTop: "6px", fontSize: "11px", color: "#8b949e" }}>
                          Recursos: CPU (Req: {c.resources.requests?.cpu || "-"}, Lim: {c.resources.limits?.cpu || "-"}) | Mem (Req: {c.resources.requests?.memory || "-"}, Lim: {c.resources.limits?.memory || "-"})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Conditions */}
              <div style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "12px" }}>
                <h4 style={{ margin: "0 0 10px 0", color: "#58a6ff", fontSize: "13px" }}>🩺 Condiciones del Pod</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {conditions.map((cond: any, idx: number) => {
                    const isTrue = cond.status === "True";
                    return (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: isTrue ? "rgba(35, 134, 54, 0.15)" : "rgba(248, 81, 73, 0.15)",
                          border: `1px solid ${isTrue ? "#238636" : "#f85149"}`,
                          borderRadius: "6px",
                          padding: "4px 8px",
                          fontSize: "11px",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: isTrue ? "#7ee787" : "#ff7b72" }}>
                          {cond.type}: {cond.status}
                        </span>
                        {cond.reason && <span style={{ color: "#8b949e", marginLeft: "4px" }}>({cond.reason})</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "12px",
                color: "#c9d1d9",
                lineHeight: "1.4",
              }}
            >
              {jsonString}
            </pre>
          )}
        </div>
    </div>
  );

  if (docked) {
    return innerContent;
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
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
        zIndex: 9999,
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90vw",
          maxWidth: "950px",
          height: "80vh",
          backgroundColor: "#161b22",
          border: "1px solid #30363d",
          borderRadius: "10px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {innerContent}
      </div>
    </div>
  );
};
