import React from "react";
import { UnhealthyPod } from "../../common/types";

interface Props {
  unhealthyPods: UnhealthyPod[];
}

export const FailingPodsTable: React.FC<Props> = ({ unhealthyPods }) => {
  if (unhealthyPods.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>🎉</div>
        <h3 style={{ margin: "0 0 6px 0", color: "#48bb78" }}>
          ¡Toda la flota está en perfecto estado!
        </h3>
        <p style={{ margin: 0 }}>
          No se encontraron pods caídos, en CrashLoopBackOff u OOMKilled en los clústeres seleccionados.
        </p>
      </div>
    );
  }

  return (
    <div className="failing-table-wrap">
      <table className="failing-table">
        <thead>
          <tr>
            <th>Clúster</th>
            <th>Namespace</th>
            <th>Pod</th>
            <th>Razón / Fallo</th>
            <th>Reinicios</th>
            <th>Mensaje / Diagnóstico</th>
          </tr>
        </thead>
        <tbody>
          {unhealthyPods.map((pod, idx) => (
            <tr key={`${pod.clusterId}-${pod.namespace}-${pod.name}-${idx}`}>
              <td>
                <span style={{ fontWeight: 600, color: "#63b3ed" }}>{pod.clusterName}</span>
              </td>
              <td>{pod.namespace}</td>
              <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{pod.name}</td>
              <td>
                <span
                  style={{
                    backgroundColor: pod.reason === "OOMKilled" ? "#742a2a" : "#744210",
                    color: pod.reason === "OOMKilled" ? "#feb2b2" : "#fbd38d",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: "bold",
                  }}
                >
                  {pod.reason}
                </span>
              </td>
              <td style={{ textAlign: "center", color: pod.restarts > 5 ? "#fc8181" : "#e2e8f0" }}>
                {pod.restarts}
              </td>
              <td style={{ color: "#a0aec0", maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pod.message}>
                {pod.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
