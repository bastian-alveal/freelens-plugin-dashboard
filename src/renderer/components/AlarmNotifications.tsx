import React, { useEffect } from "react";
import { PodRestartAlarm } from "../../common/types";

// Local Synthesized Web Audio Chime (Zero External Files, 100% Offline)
export function playAlarmSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Dual-tone urgent alert chime (E5 -> A5)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";

    osc1.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    osc2.frequency.setValueAtTime(329.63, ctx.currentTime); // E4
    osc2.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12); // A4

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.38);
    osc2.stop(ctx.currentTime + 0.38);
  } catch (err) {
    // Audio autoplay restrictions before user gesture; fail silently
  }
}

// macOS / Electron Desktop Notification
export function triggerDesktopNotification(alarm: PodRestartAlarm) {
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      const title = `🚨 Pod Reiniciado en ${alarm.clusterName}`;
      const body = `📦 Pod: ${alarm.namespace}/${alarm.podName}\n🔄 Reinicios: ${alarm.previousRestarts} ➔ ${alarm.currentRestarts} (+${alarm.restartDelta})\n⚠️ Causa: ${alarm.reason || "Fallo detectado"}`;

      if (Notification.permission === "granted") {
        new Notification(title, { body, silent: false });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            new Notification(title, { body, silent: false });
          }
        });
      }
    }
  } catch (err) {
    console.warn("[AlarmNotifications] Could not trigger desktop notification:", err);
  }
}

interface Props {
  activeToasts: PodRestartAlarm[];
  alarmHistory: PodRestartAlarm[];
  onDismissToast: (id: string) => void;
  onClearHistory: () => void;
  onOpenLogs: (clusterId: string, clusterName: string, namespace: string, podName: string) => void;
  onInspectPod: (clusterId: string, namespace: string, podName: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  isDrawerOpen: boolean;
  onCloseDrawer: () => void;
  onTestAlarm: () => void;
}

export const AlarmNotifications: React.FC<Props> = ({
  activeToasts,
  alarmHistory,
  onDismissToast,
  onClearHistory,
  onOpenLogs,
  onInspectPod,
  soundEnabled,
  onToggleSound,
  isDrawerOpen,
  onCloseDrawer,
  onTestAlarm,
}) => {
  // ESC key closes alarm history drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawerOpen) {
        onCloseDrawer();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, onCloseDrawer]);

  return (
    <>
      {/* 1. Floating In-App Toast Banners (Top Right) */}
      {activeToasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "24px",
            right: "28px",
            zIndex: 99999,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxWidth: "500px",
            width: "calc(100vw - 60px)",
            pointerEvents: "none",
          }}
        >
          {activeToasts.map((toast) => (
            <div
              key={toast.id}
              style={{
                pointerEvents: "auto",
                backgroundColor: "#161b22",
                border: "2px solid #ef4444",
                borderRadius: "10px",
                padding: "16px",
                color: "#f0f6fc",
                boxShadow: "0 14px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(239, 68, 68, 0.35)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                fontFamily: "system-ui, -apple-system, sans-serif",
                animation: "toastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Toast Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
                  paddingBottom: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      backgroundColor: "#ef4444",
                      boxShadow: "0 0 8px #ef4444",
                      animation: "alarmPulse 1.2s infinite ease-in-out",
                    }}
                  />
                  <strong style={{ color: "#f87171", fontSize: "13px", letterSpacing: "0.5px" }}>
                    🚨 ALERTA: REINICIO DE POD DETECTADO
                  </strong>
                </div>
                <button
                  onClick={() => onDismissToast(toast.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#8b949e",
                    cursor: "pointer",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "2px 6px",
                  }}
                  title="Descartar esta alerta"
                >
                  ✕
                </button>
              </div>

              {/* Toast Structured Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr",
                  rowGap: "6px",
                  columnGap: "8px",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: "#8b949e" }}>🏷️ Clúster:</span>
                <strong style={{ color: "#58a6ff" }}>{toast.clusterName}</strong>

                <span style={{ color: "#8b949e" }}>📁 Namespace:</span>
                <span style={{ color: "#e6edf3" }}>{toast.namespace}</span>

                <span style={{ color: "#8b949e" }}>📦 Pod:</span>
                <span
                  style={{
                    fontFamily: "monospace",
                    color: "#79c0ff",
                    wordBreak: "break-all",
                    fontWeight: 600,
                  }}
                >
                  {toast.podName}
                </span>

                <span style={{ color: "#8b949e" }}>🔄 Reinicios:</span>
                <div>
                  <span
                    style={{
                      backgroundColor: "rgba(239, 68, 68, 0.2)",
                      color: "#f87171",
                      border: "1px solid rgba(239, 68, 68, 0.5)",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      fontWeight: 700,
                      fontSize: "11px",
                    }}
                  >
                    {toast.previousRestarts} ➔ {toast.currentRestarts} (+{toast.restartDelta})
                  </span>
                </div>

                <span style={{ color: "#8b949e" }}>⚠️ Causa/Estado:</span>
                <span
                  style={{
                    color: toast.reason.toLowerCase().includes("crash") || toast.reason.toLowerCase().includes("oom")
                      ? "#f87171"
                      : "#facc15",
                    fontWeight: 600,
                  }}
                >
                  {toast.reason || "Error de ejecución"}
                </span>

                <span style={{ color: "#8b949e" }}>⏱️ Hora:</span>
                <span style={{ color: "#8b949e" }}>{toast.timestamp}</span>
              </div>

              {/* Toast Actions */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "6px",
                  paddingTop: "8px",
                  borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <button
                  onClick={() => {
                    onOpenLogs(toast.clusterId, toast.clusterName, toast.namespace, toast.podName);
                    onDismissToast(toast.id);
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: "#1f6feb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "7px 12px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>📄 Ver Logs en Vivo</span>
                </button>

                <button
                  onClick={() => {
                    onInspectPod(toast.clusterId, toast.namespace, toast.podName);
                    onDismissToast(toast.id);
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: "#30363d",
                    color: "#f0f6fc",
                    border: "1px solid #484f58",
                    borderRadius: "6px",
                    padding: "7px 12px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>🔍 Diagnosticar</span>
                </button>

                <button
                  onClick={() => onDismissToast(toast.id)}
                  style={{
                    backgroundColor: "transparent",
                    color: "#8b949e",
                    border: "1px solid #30363d",
                    borderRadius: "6px",
                    padding: "7px 10px",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  title="Descartar"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2. Slide-over Drawer: Alarm History Center */}
      {isDrawerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseDrawer();
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            zIndex: 99998,
            display: "flex",
            justifyContent: "flex-end",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            style={{
              width: "520px",
              maxWidth: "90vw",
              height: "100%",
              backgroundColor: "#161b22",
              borderLeft: "1px solid #30363d",
              display: "flex",
              flexDirection: "column",
              boxShadow: "-10px 0 35px rgba(0, 0, 0, 0.8)",
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid #30363d",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#0d1117",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>🔔</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#f0f6fc", fontWeight: 700 }}>
                    Centro de Alarmas de Flota
                  </h3>
                  <span style={{ fontSize: "12px", color: "#8b949e" }}>
                    Historial de reinicios de pods en esta sesión ({alarmHistory.length})
                  </span>
                </div>
              </div>
              <button
                onClick={onCloseDrawer}
                style={{
                  background: "none",
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

            {/* Drawer Toolbar */}
            <div
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid #21262d",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#161b22",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={onToggleSound}
                  style={{
                    backgroundColor: soundEnabled ? "rgba(56, 189, 248, 0.15)" : "#21262d",
                    color: soundEnabled ? "#38bdf8" : "#8b949e",
                    border: soundEnabled ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid #30363d",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Alternar sonido de alarma para nuevos reinicios"
                >
                  <span>{soundEnabled ? "🔊 Sonido Activo" : "🔇 Sonido Silenciado"}</span>
                </button>

                <button
                  onClick={onTestAlarm}
                  style={{
                    backgroundColor: "#21262d",
                    color: "#facc15",
                    border: "1px solid rgba(250, 204, 21, 0.4)",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Disparar una alarma de prueba simulada para verificar sonido y formato visual"
                >
                  <span>🧪 Probar Alarma</span>
                </button>
              </div>

              {alarmHistory.length > 0 && (
                <button
                  onClick={onClearHistory}
                  style={{
                    backgroundColor: "transparent",
                    color: "#f87171",
                    border: "1px solid rgba(248, 113, 113, 0.3)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  title="Vaciar historial de alarmas"
                >
                  Limpiar historial
                </button>
              )}
            </div>

            {/* Drawer Body: Alarms List */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {alarmHistory.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "260px",
                    color: "#8b949e",
                    textAlign: "center",
                    gap: "10px",
                  }}
                >
                  <span style={{ fontSize: "36px" }}>🟢</span>
                  <strong style={{ color: "#f0f6fc", fontSize: "14px" }}>
                    Flota Estable: Cero Reinicios Detectados
                  </strong>
                  <p style={{ margin: 0, fontSize: "12px", maxWidth: "320px", lineHeight: 1.5 }}>
                    El monitor de alertas está activo en segundo plano. Cuando cualquier pod de tus
                    clústeres se reinicie o caiga, la alarma saltará automáticamente aquí y en pantalla.
                  </p>
                </div>
              ) : (
                alarmHistory.map((alarm) => (
                  <div
                    key={alarm.id}
                    style={{
                      backgroundColor: "#0d1117",
                      border: "1px solid #30363d",
                      borderLeft: "4px solid #ef4444",
                      borderRadius: "8px",
                      padding: "14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          color: "#58a6ff",
                          fontWeight: 700,
                          fontSize: "13px",
                        }}
                      >
                        {alarm.clusterName}
                      </span>
                      <span style={{ color: "#8b949e", fontSize: "11px" }}>
                        {alarm.timestamp}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "#e6edf3" }}>
                      <span style={{ color: "#8b949e" }}>Namespace: </span>
                      <strong>{alarm.namespace}</strong>
                    </div>

                    <div
                      style={{
                        fontFamily: "monospace",
                        color: "#79c0ff",
                        fontSize: "12px",
                        wordBreak: "break-all",
                        backgroundColor: "#161b22",
                        padding: "6px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      {alarm.podName}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px" }}>
                      <span
                        style={{
                          backgroundColor: "rgba(239, 68, 68, 0.2)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          borderRadius: "4px",
                          padding: "2px 8px",
                          fontWeight: 700,
                          fontSize: "11px",
                        }}
                      >
                        {alarm.previousRestarts} ➔ {alarm.currentRestarts} (+{alarm.restartDelta})
                      </span>
                      <span style={{ color: "#facc15", fontWeight: 600 }}>
                        {alarm.reason}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        marginTop: "4px",
                      }}
                    >
                      <button
                        onClick={() => {
                          onOpenLogs(alarm.clusterId, alarm.clusterName, alarm.namespace, alarm.podName);
                          onCloseDrawer();
                        }}
                        style={{
                          backgroundColor: "#1f6feb",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "4px",
                          padding: "5px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        📄 Ver Logs
                      </button>

                      <button
                        onClick={() => {
                          onInspectPod(alarm.clusterId, alarm.namespace, alarm.podName);
                          onCloseDrawer();
                        }}
                        style={{
                          backgroundColor: "#21262d",
                          color: "#c9d1d9",
                          border: "1px solid #30363d",
                          borderRadius: "4px",
                          padding: "5px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        🔍 Diagnosticar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
