import React, { useState, useEffect, useRef } from "react";
import { PodExecResponse } from "../../common/types";
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

interface CommandHistoryItem {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timestamp: string;
}

const PRESET_COMMANDS = [
  { label: "uname -a", cmd: "uname -a" },
  { label: "env", cmd: "env" },
  { label: "df -h", cmd: "df -h" },
  { label: "ps aux", cmd: "ps aux" },
  { label: "DNS (resolv.conf)", cmd: "cat /etc/resolv.conf" },
  { label: "Puertos (netstat)", cmd: "netstat -tuln || ss -tuln" },
  { label: "Memoria (/proc/meminfo)", cmd: "cat /proc/meminfo | head -n 10" },
];

export const PodShellModal: React.FC<Props> = ({
  clusterId,
  clusterName,
  namespace,
  podName,
  initialContainer,
  onClose,
  invokeIpc,
  docked = false,
}) => {
  const tabKey = `shell:${clusterId}:${namespace}:${podName}`;
  const cached = consoleStore.getShellCache(tabKey);

  const [containers, setContainers] = useState<string[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>(initialContainer || "");
  const [inputCommand, setInputCommand] = useState<string>("");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [history, setHistory] = useState<CommandHistoryItem[]>(() => {
    if (cached?.history && Array.isArray(cached.history)) {
      return cached.history.map((h, i) => ({
        id: `cached-${i}`,
        command: h.command,
        stdout: h.output,
        stderr: "",
        exitCode: h.exitCode,
        timestamp: "",
      }));
    }
    return [];
  });
  const [commandBuffer, setCommandBuffer] = useState<string[]>(() => {
    if (cached?.history && Array.isArray(cached.history)) {
      return Array.from(new Set(cached.history.map((h) => h.command)));
    }
    return [];
  });
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [copied, setCopied] = useState<boolean>(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on ESC (only in standalone modal)
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

  // Discover containers from pod manifest
  useEffect(() => {
    const loadContainers = async () => {
      try {
        const manifest = await invokeIpc("get-pod-manifest", { clusterId, namespace, podName });
        const appContainers = (manifest?.spec?.containers || []).map((c: any) => c.name);
        const initContainers = (manifest?.spec?.initContainers || []).map((c: any) => c.name);
        const all = [...appContainers, ...initContainers];
        if (all.length > 0) {
          setContainers(all);
          if (!selectedContainer) {
            setSelectedContainer(all[0]);
          }
        }
      } catch {}
    };
    loadContainers();
  }, [clusterId, namespace, podName]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history, isRunning]);

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync shell history to consoleStore
  useEffect(() => {
    consoleStore.setShellCache(tabKey, {
      history: history.map((item) => ({
        command: item.command,
        output: item.stdout || item.stderr,
        exitCode: item.exitCode,
      })),
    });
  }, [history]);

  const executeCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun !== undefined ? cmdToRun : inputCommand).trim();
    if (!cmd || isRunning) return;

    setIsRunning(true);
    setInputCommand("");
    setHistoryIndex(-1);

    // Track command in buffer for arrow up/down
    setCommandBuffer((prev) => [cmd, ...prev.filter((c) => c !== cmd)]);

    const timestamp = new Date().toLocaleTimeString();
    const itemId = `${Date.now()}-${Math.random()}`;

    try {
      const res: PodExecResponse = await invokeIpc("exec-pod-command", {
        clusterId,
        namespace,
        podName,
        container: selectedContainer || undefined,
        command: cmd,
      });

      const newItem: CommandHistoryItem = {
        id: itemId,
        command: cmd,
        stdout: res?.stdout || "",
        stderr: res?.stderr || "",
        exitCode: typeof res?.exitCode === "number" ? res.exitCode : 0,
        timestamp,
      };

      setHistory((prev) => [...prev, newItem]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          id: itemId,
          command: cmd,
          stdout: "",
          stderr: `Error al ejecutar: ${err?.message || err}`,
          exitCode: 1,
          timestamp,
        },
      ]);
    } finally {
      setIsRunning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      executeCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandBuffer.length === 0) return;
      const nextIdx = Math.min(historyIndex + 1, commandBuffer.length - 1);
      setHistoryIndex(nextIdx);
      setInputCommand(commandBuffer[nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInputCommand("");
      } else {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputCommand(commandBuffer[nextIdx] || "");
      }
    }
  };

  const handleCopyOutput = () => {
    const text = history
      .map((h) => `$ ${h.command}\n${h.stdout ? h.stdout + "\n" : ""}${h.stderr ? "[STDERR] " + h.stderr + "\n" : ""}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setHistory([]);
    inputRef.current?.focus();
  };

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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
            <span style={{ fontSize: "18px" }}>💻</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: "#f0f6fc", fontSize: "14px" }}>
                  Pod Shell / Exec: <code style={{ color: "#a78bfa" }}>{podName}</code>
                </span>
                <span
                  style={{
                    backgroundColor: "rgba(128, 90, 213, 0.2)",
                    color: "#d6bcfa",
                    border: "1px solid #805ad5",
                    borderRadius: "12px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  {clusterName}
                </span>
                <span
                  style={{
                    backgroundColor: "#30363d",
                    color: "#8b949e",
                    borderRadius: "12px",
                    padding: "2px 8px",
                    fontSize: "11px",
                  }}
                >
                  ns: {namespace}
                </span>
              </div>
            </div>
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
              borderRadius: "4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

        {/* Toolbar with Container Selector and Preset Commands */}
        <div
          style={{
            padding: "8px 16px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {/* Container Selector */}
            {containers.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#8b949e" }}>Contenedor:</span>
                <select
                  value={selectedContainer}
                  onChange={(e) => setSelectedContainer(e.target.value)}
                  style={{
                    backgroundColor: "#21262d",
                    border: "1px solid #30363d",
                    color: "#c9d1d9",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "12px",
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

            {/* Diagnostic Presets */}
            <span style={{ color: "#8b949e", fontSize: "11px" }}>Presets:</span>
            {PRESET_COMMANDS.map((p) => (
              <button
                key={p.cmd}
                onClick={() => executeCommand(p.cmd)}
                disabled={isRunning}
                style={{
                  backgroundColor: "#21262d",
                  border: "1px solid #30363d",
                  color: "#a78bfa",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  cursor: isRunning ? "not-allowed" : "pointer",
                  fontFamily: "monospace",
                }}
                title={`Ejecutar: ${p.cmd}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleClear}
              style={{
                backgroundColor: "#21262d",
                border: "1px solid #30363d",
                color: "#8b949e",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "11px",
                cursor: "pointer",
              }}
              title="Limpiar la consola"
            >
              🧹 Limpiar
            </button>
            <button
              onClick={handleCopyOutput}
              disabled={history.length === 0}
              style={{
                backgroundColor: copied ? "#238636" : "#21262d",
                border: "1px solid #30363d",
                color: copied ? "#fff" : "#c9d1d9",
                borderRadius: "4px",
                padding: "3px 10px",
                fontSize: "11px",
                cursor: history.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              {copied ? "✓ Copiado" : "📋 Copiar Salida"}
            </button>
          </div>
        </div>

        {/* Terminal Output Area */}
        <div
          style={{
            flex: 1,
            backgroundColor: "#0d1117",
            padding: "12px 16px",
            overflowY: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "12px",
            lineHeight: "1.5",
            color: "#c9d1d9",
          }}
        >
          {history.length === 0 && !isRunning && (
            <div style={{ color: "#484f58", padding: "20px 0", textAlign: "center" }}>
              <p style={{ margin: "0 0 6px 0", color: "#8b949e" }}>
                Terminal interactiva lista para <strong style={{ color: "#a78bfa" }}>{podName}</strong>
              </p>
              <p style={{ margin: 0, fontSize: "11px" }}>
                Escribe un comando abajo y presiona Enter, o haz clic en uno de los presets rápidos arriba.
              </p>
            </div>
          )}

          {history.map((item) => (
            <div key={item.id} style={{ marginBottom: "14px" }}>
              {/* Command prompt line */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#58a6ff" }}>
                <span style={{ color: "#7ee787", fontWeight: 700 }}>$</span>
                <span style={{ fontWeight: 600 }}>{item.command}</span>
                <span style={{ color: "#484f58", fontSize: "10px", marginLeft: "auto" }}>{item.timestamp}</span>
                <span
                  style={{
                    fontSize: "10px",
                    padding: "1px 5px",
                    borderRadius: "3px",
                    backgroundColor: item.exitCode === 0 ? "rgba(35, 134, 54, 0.2)" : "rgba(218, 54, 51, 0.2)",
                    color: item.exitCode === 0 ? "#7ee787" : "#ff7b72",
                    border: `1px solid ${item.exitCode === 0 ? "#238636" : "#da3633"}`,
                  }}
                >
                  exit {item.exitCode}
                </span>
              </div>

              {/* Stdout */}
              {item.stdout && (
                <pre
                  style={{
                    margin: "4px 0 0 0",
                    color: "#e6edf3",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: "12px",
                  }}
                >
                  {item.stdout}
                </pre>
              )}

              {/* Stderr */}
              {item.stderr && (
                <pre
                  style={{
                    margin: "4px 0 0 0",
                    color: "#ff7b72",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: "12px",
                  }}
                >
                  {item.stderr}
                </pre>
              )}
            </div>
          ))}

          {isRunning && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#58a6ff", marginTop: "8px" }}>
              <span style={{ color: "#7ee787", fontWeight: 700 }}>$</span>
              <span>Ejecutando en el pod...</span>
              <span style={{ color: "#8b949e" }}>⏳</span>
            </div>
          )}

          <div ref={terminalEndRef} />
        </div>

        {/* Input Command Line */}
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "#161b22",
            borderTop: "1px solid #21262d",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ color: "#7ee787", fontFamily: "monospace", fontWeight: 700, fontSize: "14px" }}>
            $
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder={isRunning ? "Ejecutando..." : "Escribe un comando (ej: ls -la, curl localhost, env)..."}
            value={inputCommand}
            disabled={isRunning}
            onChange={(e) => setInputCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              backgroundColor: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "6px 12px",
              color: "#f0f6fc",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: "13px",
              outline: "none",
            }}
          />
          <button
            onClick={() => executeCommand()}
            disabled={isRunning || !inputCommand.trim()}
            style={{
              backgroundColor: isRunning || !inputCommand.trim() ? "#21262d" : "#805ad5",
              color: isRunning || !inputCommand.trim() ? "#484f58" : "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isRunning || !inputCommand.trim() ? "not-allowed" : "pointer",
            }}
          >
            {isRunning ? "..." : "Ejecutar"}
          </button>
        </div>

        {/* Footer help */}
        <div
          style={{
            padding: "4px 16px",
            backgroundColor: "#0d1117",
            borderTop: "1px solid #21262d",
            fontSize: "11px",
            color: "#484f58",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Usa ↑ y ↓ para navegar el historial de comandos</span>
          <span>{docked ? "Consola acoplada activa" : "Presiona ✕ o Esc para cerrar"}</span>
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
          width: "95vw",
          maxWidth: "1050px",
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
        {innerContent}
      </div>
    </div>
  );
};
