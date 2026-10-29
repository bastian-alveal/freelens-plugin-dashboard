import fs from "fs";
import path from "path";
import os from "os";

export interface StoredCluster {
  id: string;
  name: string;
  alias?: string;
  path?: string;
  enabled?: boolean;
}

export interface FleetStorageData {
  activeProfile: string;
  profiles: Record<string, StoredCluster[]>;
}

export class FleetStore {
  private static instance: FleetStore;
  private baseDir: string;
  private kubeconfigsDir: string;
  private dataFile: string;

  private constructor() {
    this.baseDir = path.join(os.homedir(), ".freelens", "fleet-storage");
    this.kubeconfigsDir = path.join(this.baseDir, "kubeconfigs");
    this.dataFile = path.join(this.baseDir, "profiles.json");

    this.ensureDirs();
  }

  public static getInstance(): FleetStore {
    if (!FleetStore.instance) {
      FleetStore.instance = new FleetStore();
    }
    return FleetStore.instance;
  }

  private ensureDirs() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      if (!fs.existsSync(this.kubeconfigsDir)) {
        fs.mkdirSync(this.kubeconfigsDir, { recursive: true });
      }
    } catch (err) {
      console.error("[FleetStore] Error creating storage directories:", err);
    }
  }

  public getStorage(): FleetStorageData {
    this.ensureDirs();
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.profiles === "object") {
          return {
            activeProfile: parsed.activeProfile || "Principal",
            profiles: parsed.profiles,
          };
        }
      }
    } catch (err) {
      console.error("[FleetStore] Error reading storage data:", err);
    }

    // Default structure
    return {
      activeProfile: "Principal",
      profiles: {
        Principal: [],
      },
    };
  }

  public saveStorage(data: FleetStorageData): boolean {
    this.ensureDirs();
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch (err) {
      console.error("[FleetStore] Error saving storage data:", err);
      return false;
    }
  }

  /**
   * Persists an uploaded raw YAML kubeconfig to physical disk so it never gets lost
   */
  public saveUploadedKubeconfig(clusterId: string, yamlContent: string): string {
    this.ensureDirs();
    try {
      const sanitizedId = clusterId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const targetPath = path.join(this.kubeconfigsDir, `${sanitizedId}.yaml`);
      fs.writeFileSync(targetPath, yamlContent, "utf8");
      return targetPath;
    } catch (err) {
      console.error("[FleetStore] Error saving uploaded kubeconfig:", err);
      return "";
    }
  }
}
