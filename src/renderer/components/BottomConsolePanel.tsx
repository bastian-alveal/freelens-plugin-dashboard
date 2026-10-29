import React, { useState, useEffect } from "react";
import { ConsoleTab, consoleStore } from "../stores/console-store";
import { PodLogsModal } from "./PodLogsModal";
import { PodShellModal } from "./PodShellModal";
import { PodManifestModal } from "./PodManifestModal";

export { ConsoleTab };

interface Props {
  tabs: ConsoleTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseAll: () => void;
  invokeIpc: (channel: string, ...args: any[]) => Promise<any>;
}

export const BottomConsolePanel: React.FC<Props> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAll,
  invokeIpc,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => consoleStore.getIsCollapsed());
  const [isMaximized, setIsMaximized] = useState<boolean>(() => consoleStore.getIsMaximized());
  const [customHeight, setCustomHeight] = useState<number>(() => consoleStore.getCustomHeight());

  useEffect(() => {
    return consoleStore.subscribe(() => {
      setIsCollapsed(consoleStore.getIsCollapsed());
      setIsMaximized(consoleStore.getIsMaximized());
      setCustomHeight(consoleStore.getCustomHeight());
    });
  }, []);

  if (tabs.length === 0) return null;

  const panelHeight = isCollapsed ? 38 : isMaximized ? "75vh" : customHeight;

  // Drag resizer
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = typeof panelHeight === "number" ? panelHeight : 360;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(160, Math.min(startHeight + delta, window.innerHeight * 0.85));
      consoleStore.setCustomHeight(newHeight);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      className="bottom-console-panel"
      style={{
        width: "100%",
        height: panelHeight,
        maxHeight: "85vh",
        backgroundColor: "#0d1117",
        borderTop: "2px solid #38bdf8",
        boxShadow: "0 -8px 25px rgba(0, 0, 0, 0.65)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
        zIndex: 50,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Drag Resizer Bar */}
      {!isCollapsed && !isMaximized && (
        <div
          onMouseDown={handleMouseDownResize}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            cursor: "row-resize",
            zIndex: 100,
            backgroundColor: "transparent",
          }}
          title="Arrastra verticalmente para redimensionar la consola"
        />
      )}

      {/* Header Bar */}
      <div
        style={{
          height: "38px",
          minHeight: "38px",
          backgroundColor: "#080c10",
          borderBottom: isCollapsed ? "none" : "1px solid #21262d",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          userSelect: "none",
          gap: "8px",
        }}
      >
        {/* Left: Branding & Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              paddingRight: "8px",
              borderRight: "1px solid #30363d",
              fontSize: "12px",
              fontWeight: 700,
              color: "#38bdf8",
              whiteSpace: "nowrap",
            }}
          >
            <span>💻</span>
            <span>Consola</span>
            <span
              style={{
                backgroundColor: "#1e293b",
                color: "#94a3b8",
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "10px",
                fontWeight: 600,
              }}
            >
              {tabs.length}
            </span>
          </div>

          {/* Scrollable Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              overflowX: "auto",
              scrollbarWidth: "none",
              flex: 1,
            }}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isLogs = tab.type === "logs";
              const isShell = tab.type === "shell";

              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    onSelectTab(tab.id);
                    if (isCollapsed) consoleStore.setIsCollapsed(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 10px",
                    height: "28px",
                    borderRadius: "4px 4px 0 0",
                    backgroundColor: isActive ? "#161b22" : "transparent",
                    borderTop: isActive ? "2px solid #38bdf8" : "2px solid transparent",
                    borderLeft: isActive ? "1px solid #30363d" : "1px solid transparent",
                    borderRight: isActive ? "1px solid #30363d" : "1px solid transparent",
                    color: isActive ? "#f0f6fc" : "#8b949e",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: "nowrap",
                    maxWidth: "280px",
                    transition: "all 0.15s ease",
                  }}
                  title={`${tab.podName} (${tab.type.toUpperCase()}) • ${tab.clusterName} / ns: ${tab.namespace}`}
                >
                  <span style={{ fontSize: "12px" }}>
                    {isLogs ? "📄" : isShell ? ">_" : "📋"}
                  </span>

                  {isLogs && (
                    <span
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: "#3fb950",
                        boxShadow: "0 0 5px #3fb950",
                      }}
                      title="Streaming continuo activo"
                    />
                  )}

                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {tab.podName}
                  </span>

                  <span
                    style={{
                      fontSize: "9px",
                      color: "#63b3ed",
                      backgroundColor: "rgba(99, 179, 237, 0.12)",
                      padding: "1px 5px",
                      borderRadius: "3px",
                      border: "1px solid rgba(99, 179, 237, 0.25)",
                    }}
                  >
                    {tab.clusterName}
                  </span>

                  <span
                    style={{
                      fontSize: "9px",
                      textTransform: "uppercase",
                      color: isLogs ? "#58a6ff" : isShell ? "#c084fc" : "#e2e8f0",
                      backgroundColor: "rgba(255,255,255,0.06)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                    }}
                  >
                    {tab.type}
                  </span>

                  {/* Close Tab Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#6e7681",
                      cursor: "pointer",
                      fontSize: "12px",
                      padding: "0 3px",
                      borderRadius: "2px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginLeft: "2px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#f85149")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#6e7681")}
                    title="Cerrar esta pestaña"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Window Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "10px" }}>
          {/* Collapse / Expand Toggle */}
          <button
            onClick={() => consoleStore.setIsCollapsed(!isCollapsed)}
            style={{
              backgroundColor: "#21262d",
              border: "1px solid #30363d",
              color: "#c9d1d9",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            title={isCollapsed ? "Expandir consola inferior" : "Minimizar consola"}
          >
            <span>{isCollapsed ? "▲ Expandir" : "▼ Minimizar"}</span>
          </button>

          {/* Maximize / Restore Toggle */}
          {!isCollapsed && (
            <button
              onClick={() => consoleStore.setIsMaximized(!isMaximized)}
              style={{
                backgroundColor: "#21262d",
                border: "1px solid #30363d",
                color: "#c9d1d9",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "11px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              title={isMaximized ? "Restaurar tamaño original" : "Agrandar a pantalla completa"}
            >
              <span>{isMaximized ? "🗗 Reducir" : "🗖 Agrandar"}</span>
            </button>
          )}

          {/* Close All */}
          <button
            onClick={onCloseAll}
            style={{
              backgroundColor: "rgba(248, 81, 73, 0.15)",
              border: "1px solid rgba(248, 81, 73, 0.4)",
              color: "#ff7b72",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 600,
            }}
            title="Cerrar todas las pestañas de la consola"
          >
            <span>✕ Cerrar todo</span>
          </button>
        </div>
      </div>

      {/* Body: Render Tab Content (display: flex/none keeps state alive!) */}
      {!isCollapsed && (
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                style={{
                  display: isTabActive ? "flex" : "none",
                  flex: 1,
                  height: "100%",
                  width: "100%",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {tab.type === "logs" && (
                  <PodLogsModal
                    docked={true}
                    clusterId={tab.clusterId}
                    clusterName={tab.clusterName}
                    namespace={tab.namespace}
                    podName={tab.podName}
                    initialContainer={tab.container}
                    onClose={() => onCloseTab(tab.id)}
                    invokeIpc={invokeIpc}
                  />
                )}

                {tab.type === "shell" && (
                  <PodShellModal
                    docked={true}
                    clusterId={tab.clusterId}
                    clusterName={tab.clusterName}
                    namespace={tab.namespace}
                    podName={tab.podName}
                    initialContainer={tab.container}
                    onClose={() => onCloseTab(tab.id)}
                    invokeIpc={invokeIpc}
                  />
                )}

                {tab.type === "manifest" && (
                  <PodManifestModal
                    docked={true}
                    clusterId={tab.clusterId}
                    clusterName={tab.clusterName}
                    namespace={tab.namespace}
                    podName={tab.podName}
                    onClose={() => onCloseTab(tab.id)}
                    invokeIpc={invokeIpc}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
