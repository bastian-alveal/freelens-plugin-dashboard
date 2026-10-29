import React, { useState, useEffect, useRef } from "react";
import { Renderer } from "@freelensapp/extensions";
import { ClusterSummary, UnhealthyPod, PodRestartAlarm } from "../../common/types";
import { ClusterCard } from "./ClusterCard";
import { PodsInspector } from "./PodsInspector";
import { DriftInspector } from "./DriftInspector";
import { PodLogsModal } from "./PodLogsModal";
import { PodManifestModal } from "./PodManifestModal";
import { PodShellModal } from "./PodShellModal";
import { BottomConsolePanel, ConsoleTab } from "./BottomConsolePanel";
import { AlarmNotifications, playAlarmSound, triggerDesktopNotification } from "./AlarmNotifications";
import { consoleStore } from "../stores/console-store";

interface AssociatedCluster {
  id: string;
  name: string;
  alias?: string;
  path?: string;
  yamlContent?: string;
  enabled?: boolean;
}

interface Props {
  extension?: Renderer.LensExtension;
}

const STORAGE_KEY = "freelens_fleet_associated_clusters_v2";

function generateClusterId(filePath?: string, name?: string, yamlContent?: string): string {
  const seed = yamlContent
    ? `${name || "cluster"}-${yamlContent.substring(0, 150)}-${Date.now()}`
    : filePath || name || `cluster-${Date.now()}-${Math.random()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const cleanSlug = (name || (filePath ? filePath.split("/").pop() : "cluster") || "cluster")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .substring(0, 24);
  return `${cleanSlug}-${Math.abs(hash).toString(36)}`;
}

export const FleetDashboard: React.FC<Props> = ({ extension }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile Management State (Persisted directly to physical disk ~/.freelens/fleet-storage/)
  const [activeProfile, setActiveProfile] = useState<string>("Principal");
  const [profiles, setProfiles] = useState<Record<string, AssociatedCluster[]>>(() => {
    // Initial bootstrap from localStorage if available
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: AssociatedCluster[] = JSON.parse(stored);
        const seenIds = new Set<string>();
        const sanitized = parsed.map((c) => {
          let id = c.id;
          if (!id || id === "L1VzZXJzL2Jh" || seenIds.has(id)) {
            id = generateClusterId(c.path, c.name, c.yamlContent);
          }
          seenIds.add(id);
          return { ...c, id };
        });
        return { Principal: sanitized };
      }
    } catch {}
    return { Principal: [] };
  });

  // Current profile's clusters
  const associatedClusters = profiles[activeProfile] || [];

  // Selected cluster IDs for active aggregate calculation / scanning
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Telemetry results
  const [clustersTelemetry, setClustersTelemetry] = useState<ClusterSummary[]>([]);
  // Kubeconfigs found on machine
  const [discoveredConfigs, setDiscoveredConfigs] = useState<Array<{ name: string; path: string }>>([]);

  const [activeTab, setActiveTabState] = useState<"fleet" | "failing" | "drift">(
    () => {
      const saved = consoleStore.getSavedNavTab();
      if (saved === "fleet" || saved === "failing" || saved === "drift") {
        return saved;
      }
      return "fleet";
    }
  );
  const setActiveTab = (tab: "fleet" | "failing" | "drift") => {
    setActiveTabState(tab);
    consoleStore.setSavedNavTab(tab);
  };
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [customPathInput, setCustomPathInput] = useState<string>("");
  const [showAddDrawer, setShowAddDrawer] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showNewProfilePrompt, setShowNewProfilePrompt] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>("");
  const [gridCols, setGridCols] = useState<"auto" | "2" | "3" | "4">("auto");
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30);

  // For Drift Navigation Shortcut
  const [driftPreselectedA, setDriftPreselectedA] = useState<string>("");
  const [driftPreselectedB, setDriftPreselectedB] = useState<string>("");

  // For Pods Inspector Deep Linking
  const [inspectClusterId, setInspectClusterId] = useState<string>("all");
  const [inspectStatusCategory, setInspectStatusCategory] = useState<"all" | "healthy" | "failing" | "pending">("all");

  // Multi-tab Bottom Console Workbench State (synced with persistent consoleStore)
  const [bottomTabs, setBottomTabs] = useState<ConsoleTab[]>(() => consoleStore.getTabs());
  const [activeBottomTabId, setActiveBottomTabId] = useState<string | null>(() => consoleStore.getActiveTabId());

  // Fleet Alarm System State
  const [activeToasts, setActiveToasts] = useState<PodRestartAlarm[]>([]);
  const [alarmHistory, setAlarmHistory] = useState<PodRestartAlarm[]>(() => {
    try {
      const saved = localStorage.getItem("freelens_fleet_alarm_history");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [isAlarmDrawerOpen, setIsAlarmDrawerOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("freelens_fleet_alarm_sound") !== "false";
    } catch {
      return true;
    }
  });

  // Ref to track previous pod restart counts: key = `${clusterId}:${namespace}:${podName}`
  const previousPodsRef = useRef<Map<string, { restarts: number; phase: string; reason: string }>>(new Map());
  const isInitialTelemetryRef = useRef<boolean>(true);

  const updateAlarmHistory = (newHistory: PodRestartAlarm[]) => {
    setAlarmHistory(newHistory);
    try {
      localStorage.setItem("freelens_fleet_alarm_history", JSON.stringify(newHistory.slice(0, 50)));
    } catch {}
  };

  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("freelens_fleet_alarm_sound", String(next));
      } catch {}
      return next;
    });
  };

  const handleDismissToast = (id: string) => {
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClearAlarmHistory = () => {
    updateAlarmHistory([]);
    setActiveToasts([]);
  };

  const handleTestAlarm = () => {
    const sampleCluster = displayedClusters[0]?.alias || displayedClusters[0]?.name || "Aks-Prod-Core";
    const sampleClusterId = displayedClusters[0]?.id || "test-cluster";
    const testAlarm: PodRestartAlarm = {
      id: `test-alarm-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      clusterId: sampleClusterId,
      clusterName: sampleCluster,
      namespace: "prod-services",
      podName: "pdr-ms-common-6c84f5bc7d-x9k2p",
      previousRestarts: 3,
      currentRestarts: 4,
      restartDelta: 1,
      reason: "CrashLoopBackOff (Exit Code 137 / OOMKilled)",
      message: "Contenedor finalizado inesperadamente por memoria",
      read: false,
    };

    setActiveToasts((prev) => [testAlarm, ...prev].slice(0, 5));
    updateAlarmHistory([testAlarm, ...alarmHistory]);

    if (soundEnabled) {
      playAlarmSound();
    }
    triggerDesktopNotification(testAlarm);

    setTimeout(() => {
      setActiveToasts((prev) => prev.filter((t) => t.id !== testAlarm.id));
    }, 18000);
  };

  useEffect(() => {
    return consoleStore.subscribe(() => {
      setBottomTabs([...consoleStore.getTabs()]);
      setActiveBottomTabId(consoleStore.getActiveTabId());
    });
  }, []);

  const handleOpenLogsTab = (clusterId: string, clusterName: string, namespace: string, podName: string, container?: string) => {
    const tabId = `logs:${clusterId}:${namespace}:${podName}`;
    consoleStore.openTab({
      id: tabId,
      type: "logs",
      clusterId,
      clusterName,
      namespace,
      podName,
      container,
      title: `📄 ${podName}`,
    });
  };

  const handleOpenShellTab = (clusterId: string, clusterName: string, namespace: string, podName: string, container?: string) => {
    const tabId = `shell:${clusterId}:${namespace}:${podName}`;
    consoleStore.openTab({
      id: tabId,
      type: "shell",
      clusterId,
      clusterName,
      namespace,
      podName,
      container,
      title: `>_ ${podName}`,
    });
  };

  const handleOpenManifestTab = (clusterId: string, clusterName: string, namespace: string, podName: string) => {
    const tabId = `manifest:${clusterId}:${namespace}:${podName}`;
    consoleStore.openTab({
      id: tabId,
      type: "manifest",
      clusterId,
      clusterName,
      namespace,
      podName,
      title: `📋 ${podName}`,
    });
  };

  const handleSelectBottomTab = (tabId: string) => {
    consoleStore.selectTab(tabId);
  };

  const handleCloseBottomTab = (tabId: string) => {
    consoleStore.closeTab(tabId);
  };

  const handleCloseAllBottomTabs = () => {
    consoleStore.closeAllTabs();
  };

  // Hotbar Pinning State
  const [isHotbarPinned, setIsHotbarPinned] = useState<boolean>(false);

  const handleInspectPods = (clusterId: string, statusCategory: "all" | "healthy" | "failing" | "pending") => {
    setInspectClusterId(clusterId);
    setInspectStatusCategory(statusCategory);
    setActiveTab("failing");
  };

  const handleToggleHotbarPin = async () => {
    try {
      const res = await invokeIpc("toggle-hotbar-pin");
      if (res && typeof res.isPinned === "boolean") {
        setIsHotbarPinned(res.isPinned);
      }
    } catch (err) {
      console.error("[FleetDashboard] Error toggling hotbar pin:", err);
    }
  };

  // Helper to invoke IPC via FreeLens Extension API or fallback
  const invokeIpc = async (channel: string, ...args: any[]): Promise<any> => {
    if (extension) {
      try {
        const extIpc = (Renderer.Ipc as any).createInstance(extension);
        const res = await extIpc.invoke(channel, ...args);
        if (res !== undefined) return res;
      } catch (err) {
        console.warn(`[FleetDashboard] Extension IPC error on ${channel}:`, err);
      }
    }
    try {
      const electron = (window as any).require ? (window as any).require("electron") : undefined;
      if (electron?.ipcRenderer) {
        return await electron.ipcRenderer.invoke(`fleet:${channel}`, ...args);
      }
    } catch (err) {
      console.warn(`[FleetDashboard] Electron fallback IPC error on ${channel}:`, err);
    }
    return null;
  };

  // 1. Initial Load from Persistent Disk (~/.freelens/fleet-storage/profiles.json)
  useEffect(() => {
    const loadFromDisk = async () => {
      try {
        const diskData = await invokeIpc("get-storage");
        if (diskData && diskData.profiles && Object.keys(diskData.profiles).length > 0) {
          // If disk data has profiles, load them!
          const actProf = diskData.activeProfile || Object.keys(diskData.profiles)[0] || "Principal";
          setProfiles(diskData.profiles);
          setActiveProfile(actProf);
          const currentClusters = diskData.profiles[actProf] || [];
          setSelectedIds(currentClusters.map((c: any) => c.id));
          if (currentClusters.length > 0) {
            fetchTelemetry(currentClusters);
          }
          return;
        }
      } catch (e) {
        console.warn("[FleetDashboard] Could not load from disk, using state/localStorage:", e);
      }

      // Fallback if disk was empty but localStorage had data: save to disk immediately
      const initialClusters = profiles[activeProfile] || [];
      setSelectedIds(initialClusters.map((c) => c.id));
      if (initialClusters.length > 0) {
        invokeIpc("save-storage", { activeProfile, profiles });
        fetchTelemetry(initialClusters);
      }
    };

    loadFromDisk();

    invokeIpc("get-hotbar-status")
      .then((res) => {
        if (res && typeof res.isPinned === "boolean") {
          setIsHotbarPinned(res.isPinned);
        }
      })
      .catch(() => {});
  }, []);

  // 2. Discover local kubeconfigs once on mount
  useEffect(() => {
    const discover = async () => {
      try {
        const configs = await invokeIpc("discover-clusters");
        if (Array.isArray(configs)) {
          setDiscoveredConfigs(configs);
        }
      } catch (err) {
        console.error("[FleetDashboard] Error discovering configs:", err);
      }
    };
    discover();
  }, [extension]);

  // Save changes to disk & localStorage whenever profiles or activeProfile change
  const persistProfiles = (updatedProfiles: Record<string, AssociatedCluster[]>, newActiveProfile?: string) => {
    const profName = newActiveProfile || activeProfile;
    setProfiles(updatedProfiles);
    if (newActiveProfile) {
      setActiveProfile(newActiveProfile);
    }

    // Save to permanent disk file
    invokeIpc("save-storage", {
      activeProfile: profName,
      profiles: updatedProfiles,
    });

    // Also backup to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProfiles[profName] || []));
    } catch {}
  };

  // Helper to update current profile's clusters
  const updateCurrentClusters = (
    updater: (prev: AssociatedCluster[]) => AssociatedCluster[]
  ) => {
    const current = profiles[activeProfile] || [];
    const updated = updater(current);
    const newProfiles = {
      ...profiles,
      [activeProfile]: updated,
    };
    persistProfiles(newProfiles);
  };

  // Switch profile
  const handleSwitchProfile = (targetProfile: string) => {
    setActiveProfile(targetProfile);
    const targetClusters = profiles[targetProfile] || [];
    setSelectedIds(targetClusters.map((c) => c.id));
    setClustersTelemetry([]);
    if (targetClusters.length > 0) {
      fetchTelemetry(targetClusters);
    }
    invokeIpc("save-storage", { activeProfile: targetProfile, profiles });
  };

  // Create new profile
  const handleCreateProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    if (profiles[trimmed]) {
      alert(`El perfil "${trimmed}" ya existe.`);
      return;
    }
    const updated = {
      ...profiles,
      [trimmed]: [],
    };
    persistProfiles(updated, trimmed);
    setSelectedIds([]);
    setClustersTelemetry([]);
    setNewProfileName("");
    setShowNewProfilePrompt(false);
  };

  // Delete current profile
  const handleDeleteProfile = (profileToDelete: string) => {
    const keys = Object.keys(profiles);
    if (keys.length <= 1) {
      alert("No puedes eliminar el único perfil restante.");
      return;
    }
    if (!confirm(`¿Estás seguro de eliminar el perfil "${profileToDelete}"?`)) {
      return;
    }
    const nextProfiles = { ...profiles };
    delete nextProfiles[profileToDelete];
    const nextActive = Object.keys(nextProfiles)[0];
    persistProfiles(nextProfiles, nextActive);
    setSelectedIds((nextProfiles[nextActive] || []).map((c) => c.id));
    fetchTelemetry(nextProfiles[nextActive] || []);
  };

  // Auto-refresh poller (every 15s, 30s, 60s, etc.)
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    const intervalId = setInterval(() => {
      if (associatedClusters.length > 0 && !isLoading) {
        fetchTelemetry(undefined, true);
      }
    }, autoRefreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [autoRefreshInterval, associatedClusters, selectedIds, isLoading]);

  // Telemetry fetcher: Only queries active/selected clusters for ultra-fast response
  const fetchTelemetry = async (targetsToFetch?: AssociatedCluster[], isSilent = false) => {
    let targets = targetsToFetch;
    if (!targets) {
      targets = associatedClusters.filter(
        (c) => selectedIds.includes(c.id)
      );
      if (targets.length === 0) targets = associatedClusters;
    }

    if (targets.length === 0) {
      return;
    }

    if (!isSilent) {
      setIsLoading(true);
    }
    try {
      const results = await Promise.race([
        invokeIpc("fetch-telemetry", targets),
        new Promise((resolve) => setTimeout(() => resolve([]), 8500)),
      ]);
      if (Array.isArray(results)) {
        // Detect pod restarts across the fleet
        const newAlarms: PodRestartAlarm[] = [];

        for (const r of results as ClusterSummary[]) {
          const assoc = associatedClusters.find((a) => a.id === r.id);
          const clusterName = assoc?.alias || r.alias || r.name;
          const allPods = r.allPods || [];

          for (const pod of allPods) {
            const key = `${r.id}:${pod.namespace}:${pod.name}`;
            const prev = previousPodsRef.current.get(key);

            if (!isInitialTelemetryRef.current && prev) {
              if (pod.restarts > prev.restarts) {
                const delta = pod.restarts - prev.restarts;
                const alarm: PodRestartAlarm = {
                  id: `${key}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  timestamp: new Date().toLocaleTimeString(),
                  clusterId: r.id,
                  clusterName,
                  namespace: pod.namespace,
                  podName: pod.name,
                  previousRestarts: prev.restarts,
                  currentRestarts: pod.restarts,
                  restartDelta: delta,
                  reason: pod.reason || (pod.statusCategory === "failing" ? "CrashLoopBackOff" : "Reiniciado"),
                  message: pod.message || `Pod reiniciado (${prev.restarts} ➔ ${pod.restarts})`,
                  read: false,
                };
                newAlarms.push(alarm);
              }
            }

            // Always update current pod state in tracker
            previousPodsRef.current.set(key, {
              restarts: pod.restarts,
              phase: pod.phase,
              reason: pod.reason,
            });
          }
        }

        if (isInitialTelemetryRef.current) {
          isInitialTelemetryRef.current = false;
        } else if (newAlarms.length > 0) {
          // Trigger In-App Toasts & Sound
          setActiveToasts((prev) => [...newAlarms, ...prev].slice(0, 5));
          updateAlarmHistory([...newAlarms, ...alarmHistory]);

          if (soundEnabled) {
            playAlarmSound();
          }

          // Desktop notification for each new alarm
          newAlarms.forEach((al) => triggerDesktopNotification(al));

          // Auto-dismiss toasts after 18s
          const alarmIds = newAlarms.map((a) => a.id);
          setTimeout(() => {
            setActiveToasts((prev) => prev.filter((t) => !alarmIds.includes(t.id)));
          }, 18000);
        }

        setClustersTelemetry((prev) => {
          const map = new Map(prev.map((c) => [c.id, c]));
          results.forEach((r: ClusterSummary) => {
            const assoc = associatedClusters.find((a) => a.id === r.id);
            if (assoc?.alias) r.alias = assoc.alias;
            map.set(r.id, r);
          });
          return Array.from(map.values());
        });
      }
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("[FleetDashboard] Error fetching telemetry:", err);
    } finally {
      if (!isSilent) {
        setIsLoading(false);
      }
    }
  };

  // Associate a kubeconfig (with permanent disk save for uploaded YAMLs)
  const handleAssociate = async (name: string, filePath?: string, yamlContent?: string) => {
    const cleanName = name || (filePath ? filePath.split("/").pop() : "Cluster") || "Cluster";
    const id = generateClusterId(filePath, cleanName, yamlContent);

    // Avoid duplicates
    if (associatedClusters.some((c) => c.id === id || (filePath && c.path === filePath))) {
      alert(`El entorno "${cleanName}" ya está asociado en este perfil.`);
      return;
    }

    let persistentPath = filePath;

    // If this was an uploaded YAML file without a direct path, persist it permanently to disk!
    if (yamlContent && !persistentPath) {
      try {
        const saveRes = await invokeIpc("save-uploaded-kubeconfig", {
          clusterId: id,
          yamlContent,
        });
        if (saveRes?.success && saveRes?.savedPath) {
          persistentPath = saveRes.savedPath;
        }
      } catch (e) {
        console.warn("[FleetDashboard] Could not persist uploaded YAML to disk:", e);
      }
    }

    const newCluster: AssociatedCluster = {
      id,
      name: cleanName,
      path: persistentPath,
      yamlContent,
      enabled: true,
    };

    updateCurrentClusters((prev) => [...prev, newCluster]);
    setSelectedIds((prev) => [...prev, id]);
    setShowAddDrawer(false);
    setCustomPathInput("");
    fetchTelemetry([newCluster]);
  };

  // Rename a cluster (Friendly Alias)
  const handleRename = (clusterId: string, newAlias: string) => {
    updateCurrentClusters((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, alias: newAlias } : c))
    );
    setClustersTelemetry((prev) =>
      prev.map((c) => (c.id === clusterId ? { ...c, alias: newAlias } : c))
    );
  };

  // HTML5 Native File Picker handler
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const text = await file.text();
        const filePath = (file as any).path || "";
        await handleAssociate(file.name, filePath, text);
      } catch (err) {
        console.error("[FleetDashboard] Error reading selected file:", err);
      }
    }
    e.target.value = "";
  };

  // Drag and Drop handler
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      for (const file of files) {
        try {
          const text = await file.text();
          const filePath = (file as any).path || "";
          await handleAssociate(file.name, filePath, text);
        } catch (err) {
          console.error("[FleetDashboard] Error reading dropped file:", err);
        }
      }
    }
  };

  // Disassociate a kubeconfig
  const handleDisassociate = (clusterId: string) => {
    updateCurrentClusters((prev) => prev.filter((c) => c.id !== clusterId));
    setSelectedIds((prev) => prev.filter((id) => id !== clusterId));
    setClustersTelemetry((prev) => prev.filter((c) => c.id !== clusterId));
  };

  // Toggle selection (fast pause/resume scan)
  const toggleSelection = (clusterId: string) => {
    setSelectedIds((prev) => {
      const updated = prev.includes(clusterId)
        ? prev.filter((id) => id !== clusterId)
        : [...prev, clusterId];
      return updated;
    });
  };

  // Compare shortcut from ClusterCard
  const handleCompareWith = (clusterId: string) => {
    setDriftPreselectedA(clusterId);
    const other = associatedClusters.find((c) => c.id !== clusterId);
    if (other) {
      setDriftPreselectedB(other.id);
    }
    setActiveTab("drift");
  };

  // Filter telemetry to only currently active/selected clusters for calculation
  const displayedClusters = clustersTelemetry.filter((c) =>
    selectedIds.includes(c.id)
  );

  // Unassociated discovered configs (available to add)
  const unassociatedDiscovered = discoveredConfigs.filter(
    (d) => !associatedClusters.some((a) => a.path === d.path)
  );

  // Aggregate Metrics (only based on active/displayed clusters)
  const totalPodsHealthy = displayedClusters.reduce((sum, c) => sum + c.pods.healthy, 0);
  const totalPodsFailing = displayedClusters.reduce((sum, c) => sum + c.pods.failing, 0);
  const totalPodsOther = displayedClusters.reduce((sum, c) => sum + (c.pods.pending + c.pods.terminating), 0);
  const totalServices = displayedClusters.reduce((sum, c) => sum + c.services.total, 0);
  const totalOrphanServices = displayedClusters.reduce((sum, c) => sum + c.services.orphanCount, 0);
  const totalNodes = displayedClusters.reduce((sum, c) => sum + c.nodes.length, 0);

  const allUnhealthyPods: UnhealthyPod[] = displayedClusters.flatMap((c) =>
    c.unhealthyPods.map((pod) => ({
      ...pod,
      clusterName: c.alias || c.name,
    }))
  );

  const profileNames = Object.keys(profiles);

  return (
    <div
      className="fleet-container"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={handleDrop}
    >
      <div className="fleet-scrollable-content">
      {/* Hidden File Input for Native macOS Picker */}
      <input
        type="file"
        ref={fileInputRef}
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      {/* Header with Title and Profile Selector */}
      <div className="fleet-header">
        <div className="fleet-title-area">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <h1>⚡ FreeLens Fleet Dashboard</h1>

            {/* Profile Selector Dropdown */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#1a202c", padding: "4px 8px", borderRadius: "6px", border: "1px solid #4a5568" }}>
              <span style={{ fontSize: "12px", color: "#a0aec0", fontWeight: 600 }}>📁 Perfil:</span>
              <select
                value={activeProfile}
                onChange={(e) => handleSwitchProfile(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#63b3ed",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {profileNames.map((name) => (
                  <option key={name} value={name} style={{ background: "#2d3748", color: "#fff" }}>
                    {name} ({profiles[name]?.length || 0})
                  </option>
                ))}
              </select>

              <button
                onClick={() => setShowNewProfilePrompt(!showNewProfilePrompt)}
                style={{
                  background: "#2b6cb0",
                  border: "none",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                title="Crear un nuevo perfil de flota"
              >
                + Nuevo
              </button>

              {profileNames.length > 1 && (
                <button
                  onClick={() => handleDeleteProfile(activeProfile)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#e53e3e",
                    padding: "2px 4px",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                  title="Eliminar este perfil"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>

          <p className="fleet-subtitle">
            Supervisión centralizada multiclúster y control de deriva • Perfil <strong>{activeProfile}</strong>: {associatedClusters.length} clúster(es)
            {selectedIds.length < associatedClusters.length && (
              <span style={{ color: "#ecc94b", marginLeft: "6px" }}>
                ({selectedIds.length} activos en escaneo)
              </span>
            )}
            {lastUpdated && ` • Actualizado: ${lastUpdated}`}
          </p>
        </div>

        <div className="fleet-header-actions">
          <button
            className="btn-primary"
            onClick={() => fileInputRef.current?.click()}
            style={{ background: "#2b6cb0", display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            📂 Explorar Kubeconfig...
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowAddDrawer(!showAddDrawer)}
            style={{ background: "#4a5568" }}
          >
            {showAddDrawer ? "Cerrar Gestor" : "⚙️ Administrar Flota"}
          </button>
          {associatedClusters.length > 0 && (
            <>
              {/* Auto-Refresh Dropdown */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "#1a202c",
                  border: "1px solid #4a5568",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: autoRefreshInterval > 0 ? "#48bb78" : "#a0aec0", fontSize: "11px", fontWeight: 600 }}>
                  {autoRefreshInterval > 0 ? "🟢 En vivo:" : "⏸️ Auto:"}
                </span>
                <select
                  value={autoRefreshInterval}
                  onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#63b3ed",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    outline: "none",
                  }}
                  title="Intervalo de actualización automática en tiempo real"
                >
                  <option value={0} style={{ background: "#2d3748", color: "#fff" }}>Pausado</option>
                  <option value={15} style={{ background: "#2d3748", color: "#fff" }}>Cada 15s</option>
                  <option value={30} style={{ background: "#2d3748", color: "#fff" }}>Cada 30s</option>
                  <option value={60} style={{ background: "#2d3748", color: "#fff" }}>Cada 1 min</option>
                  <option value={120} style={{ background: "#2d3748", color: "#fff" }}>Cada 2 min</option>
                </select>
              </div>

              <button
                className="btn-primary"
                onClick={() => fetchTelemetry()}
                disabled={isLoading}
                title="Escanea inmediatamente los clústeres activos de este perfil"
              >
                {isLoading ? "🔄 Sincronizando..." : "🔄 Actualizar Flota"}
              </button>

              <button
                onClick={handleToggleHotbarPin}
                style={{
                  background: isHotbarPinned ? "rgba(56, 178, 172, 0.2)" : "#2d3748",
                  border: isHotbarPinned ? "1px solid #38b2ac" : "1px solid #4a5568",
                  color: isHotbarPinned ? "#81e6d9" : "#cbd5e0",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
                title={
                  isHotbarPinned
                    ? "El Fleet Dashboard está anclado a tus accesos directos (Hotbar en la barra izquierda). Haz clic para desanclar."
                    : "Anclar el Fleet Dashboard a los accesos directos (Hotbar en la barra izquierda) como las conexiones de clústeres."
                }
              >
                <span>{isHotbarPinned ? "📌 Anclado en Dock" : "📌 Anclar al Dock"}</span>
              </button>

              {/* Alarm Center Button in Top Header */}
              <button
                onClick={() => setIsAlarmDrawerOpen(true)}
                style={{
                  background: activeToasts.length > 0 ? "rgba(239, 68, 68, 0.25)" : "#2d3748",
                  border: activeToasts.length > 0 ? "1px solid #ef4444" : "1px solid #4a5568",
                  color: activeToasts.length > 0 ? "#f87171" : "#cbd5e0",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
                title="Centro de Alarmas de Flota e Historial de Reinicios"
              >
                <span>🔔 Alarmas</span>
                {alarmHistory.length > 0 && (
                  <span
                    style={{
                      backgroundColor: activeToasts.length > 0 ? "#ef4444" : "#484f58",
                      color: "#ffffff",
                      borderRadius: "10px",
                      padding: "1px 6px",
                      fontSize: "10px",
                      fontWeight: 700,
                      animation: activeToasts.length > 0 ? "alarmPulse 1.2s infinite ease-in-out" : "none",
                    }}
                  >
                    {alarmHistory.length}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* New Profile Creation Bar */}
      {showNewProfilePrompt && (
        <div style={{ background: "#2d3748", border: "1px solid #63b3ed", padding: "10px 14px", borderRadius: "8px", margin: "10px 0", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Nombre del nuevo perfil:</span>
          <input
            type="text"
            placeholder="Ej: Producción, Staging, DevOps..."
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProfile()}
            style={{
              background: "#1a202c",
              border: "1px solid #4a5568",
              color: "#fff",
              padding: "5px 10px",
              borderRadius: "6px",
              fontSize: "13px",
              flex: "0 0 250px",
            }}
          />
          <button
            onClick={handleCreateProfile}
            style={{
              background: "#3182ce",
              border: "none",
              color: "#fff",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Crear Perfil
          </button>
          <button
            onClick={() => setShowNewProfilePrompt(false)}
            style={{
              background: "transparent",
              border: "none",
              color: "#a0aec0",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Drawer for Managing / Associating Kubeconfigs */}
      {showAddDrawer && (
        <div className="association-panel">
          <h3 style={{ margin: "0 0 6px 0", fontSize: "16px" }}>📂 Asociar Archivos Kubeconfig al Perfil "{activeProfile}"</h3>
          <p style={{ margin: "0 0 16px 0", color: "#a0aec0", fontSize: "13px" }}>
            Los archivos que agregues aquí quedarán guardados permanentemente en tu disco local (~/.freelens/fleet-storage/) y nunca se perderán al reiniciar.
          </p>

          <div
            className={`dropzone-container ${isDragging ? "active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">📥</div>
            <div className="dropzone-text">Arrastra y suelta aquí tus archivos de Kubeconfig</div>
            <div className="dropzone-subtext">o haz clic aquí para seleccionar desde el Finder</div>
          </div>

          {unassociatedDiscovered.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#cbd5e0", marginBottom: "8px" }}>
                Kubeconfigs encontrados en tu máquina ({unassociatedDiscovered.length}):
              </div>
              <div className="discovered-list">
                {unassociatedDiscovered.map((item) => (
                  <div key={item.path} className="discovered-item">
                    <div className="discovered-info">
                      <strong>{item.name}</strong>
                      <span>{item.path}</span>
                    </div>
                    <button
                      className="btn-associate"
                      onClick={() => handleAssociate(item.name, item.path)}
                    >
                      ➕ Asociar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#cbd5e0", marginBottom: "6px" }}>
              O especifica la ruta manualmente:
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Ruta completa al kubeconfig..."
                value={customPathInput}
                onChange={(e) => setCustomPathInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAssociate("", customPathInput)}
                style={{
                  flex: 1,
                  background: "#1a202c",
                  border: "1px solid #4a5568",
                  color: "#fff",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <button
                className="btn-associate"
                onClick={() => handleAssociate("", customPathInput)}
              >
                ➕ Asociar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* If no clusters are associated yet in current profile, show Clean Onboarding */}
      {associatedClusters.length === 0 ? (
        <div className="empty-state" style={{ padding: "40px 20px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>⚡</div>
          <h2 style={{ margin: "0 0 8px 0", color: "#63b3ed" }}>Perfil "{activeProfile}" vacío</h2>
          <p style={{ maxWidth: "550px", margin: "0 auto 20px auto", color: "#a0aec0", fontSize: "14px" }}>
            No tienes ningún kubeconfig asociado en este perfil.
            Arrastra tu archivo directamente o búscalo con el explorador:
          </p>

          <div
            className={`dropzone-container ${isDragging ? "active" : ""}`}
            style={{ maxWidth: "560px", margin: "0 auto 24px auto" }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="dropzone-icon">📥</div>
            <div className="dropzone-text">Arrastra y suelta aquí tu kubeconfig</div>
            <div className="dropzone-subtext">o haz clic para explorar tu disco</div>
          </div>

          {discoveredConfigs.length > 0 && (
            <div style={{ maxWidth: "600px", margin: "0 auto", textAlign: "left" }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#cbd5e0" }}>
                Kubeconfigs detectados localmente:
              </h4>
              <div className="discovered-list">
                {discoveredConfigs.map((item) => (
                  <div key={item.path} className="discovered-item">
                    <div className="discovered-info">
                      <strong>{item.name}</strong>
                      <span>{item.path}</span>
                    </div>
                    <button
                      className="btn-associate"
                      onClick={() => handleAssociate(item.name, item.path)}
                    >
                      ➕ Asociar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Associated Chips Bar */}
          <div className="fleet-cluster-chips" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", margin: "14px 0" }}>
            <span className="chips-label" style={{ fontWeight: 600, color: "#a0aec0", fontSize: "13px" }}>
              Flota ({activeProfile}):
            </span>
            {associatedClusters.map((cluster) => {
              const isSelected = selectedIds.includes(cluster.id);
              const displayName = cluster.alias || cluster.name;
              return (
                <div
                  key={cluster.id}
                  className={`cluster-chip ${isSelected ? "active" : ""}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "5px 10px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    cursor: "pointer",
                    background: isSelected ? "#2b6cb0" : "#2d3748",
                    color: isSelected ? "#ffffff" : "#a0aec0",
                    border: isSelected ? "1px solid #63b3ed" : "1px solid #4a5568",
                    transition: "all 0.15s ease",
                  }}
                  title={`Estado: ${isSelected ? "⚡ Activo en escaneo" : "⏸️ Pausado"}\nHaz clic para activar/pausar`}
                >
                  <span
                    onClick={() => toggleSelection(cluster.id)}
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <span>{isSelected ? "⚡" : "⏸️"}</span>
                    <strong>{displayName}</strong>
                  </span>
                  <button
                    className="disassociate-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDisassociate(cluster.id);
                    }}
                    title="Desasociar este clúster"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: isSelected ? "#e2e8f0" : "#718096",
                      cursor: "pointer",
                      fontSize: "12px",
                      padding: "0 2px",
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: "#2b6cb0",
                border: "none",
                color: "#ffffff",
                padding: "5px 12px",
                borderRadius: "16px",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: 600,
                marginLeft: "6px",
              }}
            >
              📂 Explorar y Asociar...
            </button>
            <button
              onClick={() => setShowAddDrawer(!showAddDrawer)}
              style={{
                background: "#2d3748",
                border: "1px dashed #718096",
                color: "#63b3ed",
                padding: "4px 10px",
                borderRadius: "16px",
                fontSize: "12px",
                cursor: "pointer",
                marginLeft: "4px",
              }}
            >
              ⚙️ Gestor
            </button>
          </div>

          {/* Metric Banners */}
          <div className="fleet-metric-banner">
            <div className="banner-card">
              <div className="banner-card-title">Clústeres Activos</div>
              <div className="banner-card-value blue">
                {displayedClusters.length}
                {associatedClusters.length > displayedClusters.length && (
                  <span style={{ fontSize: "12px", color: "#a0aec0", marginLeft: "4px" }}>
                    / {associatedClusters.length}
                  </span>
                )}
              </div>
            </div>
            <div
              className="banner-card"
              style={{ cursor: "pointer" }}
              onClick={() => handleInspectPods("all", "healthy")}
              title="Hacer clic para inspeccionar todos los pods vivos"
            >
              <div className="banner-card-title">Pods Vivos (Healthy)</div>
              <div className="banner-card-value green">{totalPodsHealthy}</div>
            </div>
            <div
              className="banner-card"
              style={{ cursor: "pointer" }}
              onClick={() => handleInspectPods("all", "failing")}
              title="Hacer clic para diagnosticar pods caídos o con fallos"
            >
              <div className="banner-card-title">Pods Muertos / Fallo</div>
              <div className="banner-card-value red">{totalPodsFailing}</div>
            </div>
            <div
              className="banner-card"
              style={{ cursor: "pointer" }}
              onClick={() => handleInspectPods("all", "pending")}
              title="Hacer clic para ver pods pendientes o en transición"
            >
              <div className="banner-card-title">Pods en Transición</div>
              <div className="banner-card-value yellow">{totalPodsOther}</div>
            </div>
            <div className="banner-card">
              <div className="banner-card-title">Servicios / Huérfanos</div>
              <div className="banner-card-value purple">
                {totalServices} {totalOrphanServices > 0 && `(${totalOrphanServices} ⚠️)`}
              </div>
            </div>
            <div className="banner-card">
              <div className="banner-card-title">Total Nodos</div>
              <div className="banner-card-value cyan">{totalNodes}</div>
            </div>
          </div>

          {/* Nav Tabs */}
          <div className="fleet-nav-tabs" style={{ display: "flex", alignItems: "center" }}>
            <button
              className={`nav-tab ${activeTab === "fleet" ? "active" : ""}`}
              onClick={() => setActiveTab("fleet")}
            >
              Vista de Flota ({clustersTelemetry.length})
            </button>
            <button
              className={`nav-tab ${activeTab === "failing" ? "active" : ""}`}
              onClick={() => {
                setInspectClusterId("all");
                setInspectStatusCategory("all");
                setActiveTab("failing");
              }}
            >
              🔍 Inspector de Pods {totalPodsFailing > 0 ? `(${totalPodsFailing} 🔴)` : `(${totalPodsHealthy} 🟢)`}
            </button>
            <button
              className={`nav-tab ${activeTab === "drift" ? "active" : ""}`}
              onClick={() => setActiveTab("drift")}
            >
              Comparador de Deriva (Drift)
            </button>

            {/* Active Console Shortcut Tab */}
            {bottomTabs.length > 0 && (
              <button
                onClick={() => {
                  consoleStore.setIsCollapsed(false);
                }}
                style={{
                  marginLeft: "12px",
                  backgroundColor: "rgba(56, 189, 248, 0.12)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
                title="Hacer clic para expandir y enfocar la consola inferior de sesiones"
              >
                <span>💻 Consola Activa</span>
                <span
                  style={{
                    backgroundColor: "#38bdf8",
                    color: "#000000",
                    borderRadius: "10px",
                    padding: "1px 6px",
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  {bottomTabs.length}
                </span>
              </button>
            )}

            {/* Alarm Center Shortcut Button */}
            <button
              onClick={() => setIsAlarmDrawerOpen(true)}
              style={{
                marginLeft: "10px",
                backgroundColor: activeToasts.length > 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.05)",
                color: activeToasts.length > 0 ? "#f87171" : "#e6edf3",
                border: activeToasts.length > 0 ? "1px solid rgba(239, 68, 68, 0.6)" : "1px solid #30363d",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s ease",
              }}
              title="Abrir Centro de Alarmas de Flota e Historial de Reinicios"
            >
              <span>🔔 Alarmas</span>
              {alarmHistory.length > 0 && (
                <span
                  style={{
                    backgroundColor: activeToasts.length > 0 ? "#ef4444" : "#484f58",
                    color: "#ffffff",
                    borderRadius: "10px",
                    padding: "1px 6px",
                    fontSize: "10px",
                    fontWeight: 700,
                    animation: activeToasts.length > 0 ? "alarmPulse 1.2s infinite ease-in-out" : "none",
                  }}
                >
                  {alarmHistory.length}
                </span>
              )}
            </button>

            {/* Column Layout Controls */}
            {activeTab === "fleet" && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ fontSize: "11px", color: "#a0aec0" }}>Columnas:</span>
                {(["auto", "2", "3", "4"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setGridCols(c)}
                    style={{
                      background: gridCols === c ? "#3182ce" : "#2d3748",
                      color: gridCols === c ? "#ffffff" : "#a0aec0",
                      border: "none",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      cursor: "pointer",
                      fontWeight: gridCols === c ? "bold" : "normal",
                    }}
                    title={c === "auto" ? "Ajuste automático según el ancho" : `Forzar ${c} columnas`}
                  >
                    {c === "auto" ? "Auto" : `${c}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === "fleet" && (
            <div className={`clusters-grid ${gridCols !== "auto" ? `cols-${gridCols}` : ""}`}>
              {clustersTelemetry.map((cluster) => {
                const isActive = selectedIds.includes(cluster.id);
                return (
                  <ClusterCard
                    key={cluster.id}
                    cluster={cluster}
                    isActive={isActive}
                    onDisassociate={() => handleDisassociate(cluster.id)}
                    onRename={(id, newAlias) => handleRename(id, newAlias)}
                    onToggleScan={(id) => toggleSelection(id)}
                    onCompare={(id) => handleCompareWith(id)}
                    onInspectPods={(id, status) => handleInspectPods(id, status)}
                  />
                );
              })}
            </div>
          )}

          {activeTab === "failing" && (
            <PodsInspector
              clusters={displayedClusters}
              initialClusterId={inspectClusterId}
              initialStatusCategory={inspectStatusCategory}
              onOpenLogs={handleOpenLogsTab}
              onOpenShell={handleOpenShellTab}
              onOpenManifest={handleOpenManifestTab}
              invokeIpc={invokeIpc}
              onRefreshTelemetry={() => {
                const currentClusters = profiles[activeProfile] || [];
                fetchTelemetry(currentClusters);
              }}
            />
          )}

          {activeTab === "drift" && (
            <DriftInspector
              clusters={clustersTelemetry}
              preselectedAId={driftPreselectedA}
              preselectedBId={driftPreselectedB}
            />
          )}
        </>
      )}
      </div>

      {/* Docked Multi-Tab Bottom Console Workbench (Flex child inside .fleet-container) */}
      <BottomConsolePanel
        tabs={bottomTabs}
        activeTabId={activeBottomTabId}
        onSelectTab={handleSelectBottomTab}
        onCloseTab={handleCloseBottomTab}
        onCloseAll={handleCloseAllBottomTabs}
        invokeIpc={invokeIpc}
      />

      {/* Fleet Alarm Notification System (Toasts + Drawer) */}
      <AlarmNotifications
        activeToasts={activeToasts}
        alarmHistory={alarmHistory}
        onDismissToast={handleDismissToast}
        onClearHistory={handleClearAlarmHistory}
        onOpenLogs={handleOpenLogsTab}
        onInspectPod={(cId, _ns, _pName) => {
          setInspectClusterId(cId);
          setInspectStatusCategory("all");
          setActiveTab("failing");
        }}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        isDrawerOpen={isAlarmDrawerOpen}
        onCloseDrawer={() => setIsAlarmDrawerOpen(false)}
        onTestAlarm={handleTestAlarm}
      />
    </div>
  );
};
