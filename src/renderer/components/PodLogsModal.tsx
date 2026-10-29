import React, { useState, useEffect, useRef, useMemo } from "react";
import { PodLogResponse } from "../../common/types";
import { consoleStore } from "../stores/console-store";

interface Props {
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  initialContainer?: string;
  onClose: () => void;
  invokeIpc: (channel: string, ...args: any[]) => Promise<any>;
  docked?: boolean;
}

interface ParsedLogLine {
  id: number;
  raw: string;
  timestamp?: string;
  level?: "ERROR" | "WARN" | "INFO" | "DEBUG";
  isJson?: boolean;
  jsonObj?: any;
  message: string;
}

function parseLogLine(raw: string, index: number): ParsedLogLine {
  let line = raw;
  let timestamp: string | undefined;
  let level: "ERROR" | "WARN" | "INFO" | "DEBUG" | undefined;
  let isJson = false;
  let jsonObj: any = null;

  // RFC3339 / ISO timestamp at start
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*(.*)$/);
  if (tsMatch) {
    timestamp = tsMatch[1];
    line = tsMatch[2];
  }

  // JSON detection
  const trimmed = line.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      jsonObj = JSON.parse(trimmed);
      isJson = true;
      if (jsonObj.time || jsonObj.timestamp) {
        if (!timestamp) timestamp = String(jsonObj.time || jsonObj.timestamp);
      }
      const rawLevel = String(jsonObj.level || jsonObj.severity || jsonObj.log_level || "").toUpperCase();
      if (rawLevel.includes("ERR") || rawLevel.includes("FATAL") || rawLevel.includes("CRIT")) level = "ERROR";
      else if (rawLevel.includes("WARN")) level = "WARN";
      else if (rawLevel.includes("INFO")) level = "INFO";
      else if (rawLevel.includes("DEBUG") || rawLevel.includes("TRACE")) level = "DEBUG";

      const msg = jsonObj.message || jsonObj.msg || jsonObj.log || "";
      if (msg) {
        line = typeof msg === "object" ? JSON.stringify(msg) : String(msg);
      }
    } catch {
      isJson = false;
    }
  }

  // Keyword level detection
  if (!level) {
    if (/\b(FATAL|CRITICAL|ERROR|ERR|EXCEPTION|FAILED|FAILURE)\b/i.test(line)) {
      level = "ERROR";
    } else if (/\b(WARN|WARNING)\b/i.test(line)) {
      level = "WARN";
    } else if (/\b(INFO|NOTICE)\b/i.test(line)) {
      level = "INFO";
    } else if (/\b(DEBUG|TRACE)\b/i.test(line)) {
      level = "DEBUG";
    }
  }

  return {
    id: index,
    raw,
    timestamp,
    level,
    isJson,
    jsonObj,
    message: line,
  };
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        style={{
          backgroundColor: "#ca8a04",
          color: "#000000",
          padding: "0 2px",
          borderRadius: "2px",
          fontWeight: 700,
        }}
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export const PodLogsModal: React.FC<Props> = ({
  clusterId,
  clusterName,
  namespace,
  podName,
  initialContainer,
  onClose,
  invokeIpc,
  docked = false,
}) => {
  const tabKey = `logs:${clusterId}:${namespace}:${podName}`;
  const cached = consoleStore.getLogCache(tabKey);

  const [containers, setContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>(initialContainer || "");
  const [tailLines, setTailLines] = useState<number>(cached?.tailLines || 100);
  const [previous, setPrevious] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>(cached?.lines ? cached.lines.join("\n") : "");
  const [isLoading, setIsLoading] = useState<boolean>(!cached?.lines || cached.lines.length === 0);
  const [searchFilter, setSearchFilter] = useState<string>(cached?.filterText || "");
  const [copied, setCopied] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  // Default to LIVE STREAMING (tail -f) as requested!
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<"structured" | "raw">(cached?.viewMode || "structured");

  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async (containerToUse?: string, isSilent = false) => {
    if (!isSilent && (!logs || logs.trim().length === 0)) setIsLoading(true);
    try {
      const res: PodLogResponse = await invokeIpc("get-pod-logs", {
        clusterId,
        namespace,
        podName,
        container: containerToUse !== undefined ? containerToUse : selectedContainer,
        tailLines,
        previous,
      });

      if (res) {
        const rawLogs = res.logs || "";
        setLogs(rawLogs);
        consoleStore.setLogCache(tabKey, {
          lines: rawLogs.split("\n"),
          filterText: searchFilter,
          viewMode,
          tailLines,
        });

        if (res.containers && res.containers.length > 0) {
          setContainers(res.containers);
          if (!selectedContainer) {
            setSelectedContainer(res.selectedContainer || res.containers[0]);
          }
        }
      }
    } catch (err: any) {
      if (!isSilent) setLogs(`Error al cargar logs: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedContainer, tailLines, previous]);

  // Live Streaming poller (every 2.2s when isStreaming is active)
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      fetchLogs(undefined, true);
    }, 2200);
    return () => clearInterval(interval);
  }, [isStreaming, selectedContainer, tailLines, previous]);

  // Close on ESC (for standalone modal)
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

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse lines with structured layout
  const parsedLines = useMemo<ParsedLogLine[]>(() => {
    if (!logs) return [];
    const rawLines = logs.split("\n");
    return rawLines.map((line, idx) => parseLogLine(line, idx));
  }, [logs]);

  // Filter lines by search term
  const displayParsedLines = useMemo(() => {
    if (!searchFilter.trim()) return parsedLines;
    const q = searchFilter.toLowerCase();
    return parsedLines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [parsedLines, searchFilter]);

  // Content UI
  const content = (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0d1117",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Modal Header (Only shown when not docked inside bottom panel) */}
      {!docked && (
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "#080c10",
            borderBottom: "1px solid #30363d",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>📄</span>
            <span style={{ fontWeight: 700, color: "#f0f6fc", fontSize: "13px" }}>
              Logs: <code style={{ color: "#58a6ff" }}>{podName}</code>
            </span>
            <span
              style={{
                backgroundColor: "#1f6feb22",
                color: "#58a6ff",
                border: "1px solid #1f6feb",
                borderRadius: "10px",
                padding: "1px 6px",
                fontSize: "10px",
                fontWeight: 600,
              }}
            >
              {clusterName}
            </span>
            <span style={{ color: "#8b949e", fontSize: "11px" }}>ns: {namespace}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#8b949e",
              fontSize: "16px",
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: "#161b22",
          borderBottom: "1px solid #21262d",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          {/* Container Selector */}
          {containers.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "#8b949e", fontSize: "11px" }}>Contenedor:</span>
              <select
                value={selectedContainer}
                onChange={(e) => setSelectedContainer(e.target.value)}
                style={{
                  backgroundColor: "#21262d",
                  border: "1px solid #30363d",
                  color: "#c9d1d9",
                  borderRadius: "4px",
                  padding: "3px 6px",
                  fontSize: "11px",
                  outline: "none",
                }}
              >
                {containers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Lines selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ color: "#8b949e", fontSize: "11px" }}>Líneas:</span>
            <select
              value={tailLines}
              onChange={(e) => setTailLines(Number(e.target.value))}
              style={{
                backgroundColor: "#21262d",
                border: "1px solid #30363d",
                color: "#c9d1d9",
                borderRadius: "4px",
                padding: "3px 6px",
                fontSize: "11px",
                outline: "none",
              }}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>

          {/* Previous container checkbox */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              color: "#c9d1d9",
              cursor: "pointer",
              userSelect: "none",
              fontSize: "11px",
            }}
            title="Muestra logs del contenedor previo antes de reiniciarse (CrashLoopBackOff / OOMKilled)"
          >
            <input
              type="checkbox"
              checked={previous}
              onChange={(e) => setPrevious(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>--previous</span>
          </label>

          {/* Auto scroll */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              color: "#8b949e",
              cursor: "pointer",
              userSelect: "none",
              fontSize: "11px",
            }}
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>Auto-scroll</span>
          </label>

          {/* Structured vs Raw Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: "#21262d",
              borderRadius: "4px",
              border: "1px solid #30363d",
              padding: "1px",
            }}
          >
            <button
              onClick={() => setViewMode("structured")}
              style={{
                backgroundColor: viewMode === "structured" ? "#38bdf8" : "transparent",
                color: viewMode === "structured" ? "#000000" : "#8b949e",
                border: "none",
                borderRadius: "3px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: viewMode === "structured" ? 700 : 400,
                cursor: "pointer",
              }}
              title="Vista analizada con formato estructurado, timestamps y niveles"
            >
              🗂️ Estructurado
            </button>
            <button
              onClick={() => setViewMode("raw")}
              style={{
                backgroundColor: viewMode === "raw" ? "#38bdf8" : "transparent",
                color: viewMode === "raw" ? "#000000" : "#8b949e",
                border: "none",
                borderRadius: "3px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: viewMode === "raw" ? 700 : 400,
                cursor: "pointer",
              }}
              title="Vista de texto sin formato (consola plana)"
            >
              📄 Plano
            </button>
          </div>
        </div>

        {/* Right side toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Search Filter with counter */}
          <div style={{ position: "relative", width: "190px" }}>
            <input
              type="text"
              placeholder="🔍 Buscar en logs..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                backgroundColor: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "4px",
                padding: "3px 22px 3px 8px",
                color: "#f0f6fc",
                fontSize: "11px",
                outline: "none",
              }}
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter("")}
                style={{
                  position: "absolute",
                  right: "4px",
                  top: "3px",
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  cursor: "pointer",
                  fontSize: "11px",
                }}
              >
                ✕
              </button>
            )}
          </div>

          {searchFilter && (
            <span style={{ fontSize: "10px", color: "#38bdf8", fontWeight: 600 }}>
              {displayParsedLines.length} coincidencias
            </span>
          )}

          {/* Live Streaming Toggle Button */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            style={{
              backgroundColor: isStreaming ? "rgba(35, 134, 54, 0.2)" : "#21262d",
              border: isStreaming ? "1px solid #3fb950" : "1px solid #30363d",
              color: isStreaming ? "#3fb950" : "#c9d1d9",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
            title={isStreaming ? "Pausar streaming automático" : "Activar streaming en vivo (tail -f)"}
          >
            {isStreaming && (
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#3fb950",
                  boxShadow: "0 0 6px #3fb950",
                }}
              />
            )}
            <span>{isStreaming ? "En Vivo (tail -f)" : "▶ Iniciar Stream"}</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => fetchLogs()}
            disabled={isLoading}
            style={{
              backgroundColor: "#21262d",
              border: "1px solid #30363d",
              color: "#c9d1d9",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
            title="Refrescar logs ahora"
          >
            {isLoading && !isStreaming ? "⏳" : "🔄"}
          </button>

          {/* Copy */}
          <button
            onClick={handleCopyLogs}
            style={{
              backgroundColor: copied ? "#238636" : "#21262d",
              border: "1px solid #30363d",
              color: copied ? "#fff" : "#c9d1d9",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: 600,
            }}
            title="Copiar contenido de logs al portapapeles"
          >
            {copied ? "✓ Copiado" : "📋 Copiar"}
          </button>
        </div>
      </div>

      {/* Main Terminal Logs Area */}
      <div
        style={{
          flex: 1,
          backgroundColor: "#0a0e14",
          padding: "8px 12px",
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "11px",
          lineHeight: "1.6",
          color: "#c9d1d9",
        }}
      >
        {isLoading && !logs ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#8b949e" }}>
            <span>🔄 Conectando y leyendo logs del pod...</span>
          </div>
        ) : displayParsedLines.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#8b949e" }}>
            {searchFilter ? "No hay resultados para la búsqueda actual." : "El pod no ha generado logs aún."}
          </div>
        ) : viewMode === "structured" ? (
          /* Structured Parsed View */
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {displayParsedLines.map((item) => {
              const isError = item.level === "ERROR";
              const isWarn = item.level === "WARN";
              const isInfo = item.level === "INFO";
              const isDebug = item.level === "DEBUG";

              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    backgroundColor: isError
                      ? "rgba(239, 68, 68, 0.08)"
                      : isWarn
                      ? "rgba(234, 179, 8, 0.06)"
                      : "transparent",
                    borderRadius: "3px",
                    padding: "2px 4px",
                    borderLeft: isError
                      ? "2px solid #ef4444"
                      : isWarn
                      ? "2px solid #eab308"
                      : isInfo
                      ? "2px solid #22c55e"
                      : "2px solid transparent",
                  }}
                >
                  {/* Line Number */}
                  <span
                    style={{
                      color: "#475569",
                      minWidth: "32px",
                      textAlign: "right",
                      userSelect: "none",
                      fontSize: "10px",
                    }}
                  >
                    {item.id + 1}
                  </span>

                  {/* Timestamp Column */}
                  {item.timestamp && (
                    <span
                      style={{
                        color: "#38bdf8",
                        fontSize: "10px",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                      }}
                    >
                      {item.timestamp.replace(/^[0-9]{4}-/, "")}
                    </span>
                  )}

                  {/* Level Badge */}
                  {item.level && (
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        padding: "0 4px",
                        borderRadius: "3px",
                        textTransform: "uppercase",
                        backgroundColor: isError
                          ? "rgba(239, 68, 68, 0.25)"
                          : isWarn
                          ? "rgba(234, 179, 8, 0.25)"
                          : isInfo
                          ? "rgba(34, 197, 94, 0.25)"
                          : "rgba(168, 85, 247, 0.25)",
                        color: isError
                          ? "#fca5a5"
                          : isWarn
                          ? "#fde047"
                          : isInfo
                          ? "#86efac"
                          : "#d8b4fe",
                        border: isError
                          ? "1px solid #ef4444"
                          : isWarn
                          ? "1px solid #eab308"
                          : isInfo
                          ? "1px solid #22c55e"
                          : "1px solid #a855f7",
                      }}
                    >
                      {item.level}
                    </span>
                  )}

                  {/* Message Body */}
                  <div
                    style={{
                      flex: 1,
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      color: isError ? "#fca5a5" : isWarn ? "#fef08a" : "#e2e8f0",
                    }}
                  >
                    {highlightMatch(item.message, searchFilter)}

                    {/* Additional JSON keys badges if present */}
                    {item.isJson && item.jsonObj && (
                      <div
                        style={{
                          display: "inline-flex",
                          flexWrap: "wrap",
                          gap: "4px",
                          marginLeft: "6px",
                          fontSize: "10px",
                        }}
                      >
                        {Object.entries(item.jsonObj)
                          .filter(([k]) => !["time", "timestamp", "level", "message", "msg", "log"].includes(k))
                          .slice(0, 4)
                          .map(([k, v]) => (
                            <span
                              key={k}
                              style={{
                                backgroundColor: "#1e293b",
                                border: "1px solid #334155",
                                color: "#94a3b8",
                                borderRadius: "3px",
                                padding: "0 4px",
                              }}
                            >
                              <strong style={{ color: "#cbd5e1" }}>{k}</strong>: {String(v)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        ) : (
          /* Raw Monospace View */
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {displayParsedLines.map((item) => (
              <div key={item.id} style={{ display: "flex", gap: "10px" }}>
                <span style={{ color: "#475569", minWidth: "32px", textAlign: "right", userSelect: "none" }}>
                  {item.id + 1}
                </span>
                <span style={{ flex: 1 }}>{highlightMatch(item.raw, searchFilter)}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div
        style={{
          padding: "4px 12px",
          backgroundColor: "#080c10",
          borderTop: "1px solid #21262d",
          fontSize: "10px",
          color: "#8b949e",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>
          Líneas cargadas: {displayParsedLines.length} {searchFilter && `(filtradas de ${parsedLines.length})`}
        </span>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span>Modo: {viewMode === "structured" ? "Estructurado" : "Plano"}</span>
          <span>{isStreaming ? "🟢 En vivo" : "⏸ Pausado"}</span>
        </div>
      </div>
    </div>
  );

  // If docked, return directly without modal wrapper
  if (docked) {
    return content;
  }

  // Standalone modal mode
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
          width: "95vw",
          maxWidth: "1100px",
          height: "85vh",
          backgroundColor: "#161b22",
          border: "1px solid #30363d",
          borderRadius: "10px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {content}
      </div>
    </div>
  );
};
