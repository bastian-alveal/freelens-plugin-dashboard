import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export class HotbarService {
  private static instance: HotbarService;

  private constructor() {}

  public static getInstance(): HotbarService {
    if (!HotbarService.instance) {
      HotbarService.instance = new HotbarService();
    }
    return HotbarService.instance;
  }

  public getHotbarStorePath(): string {
    try {
      if (app && typeof app.getPath === "function") {
        return path.join(app.getPath("userData"), "lens-hotbar-store.json");
      }
    } catch (e) {
      // fallback
    }
    const home = process.env.HOME || process.env.USERPROFILE || "";
    // macOS default
    const macPath = path.join(home, "Library/Application Support/Freelens/lens-hotbar-store.json");
    if (fs.existsSync(macPath)) return macPath;
    // Linux default
    const linuxPath = path.join(home, ".config/Freelens/lens-hotbar-store.json");
    if (fs.existsSync(linuxPath)) return linuxPath;
    // Windows default
    const winPath = path.join(process.env.APPDATA || "", "Freelens/lens-hotbar-store.json");
    if (fs.existsSync(winPath)) return winPath;

    return macPath;
  }

  public isPinned(): boolean {
    try {
      const filePath = this.getHotbarStorePath();
      if (!fs.existsSync(filePath)) return false;
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const hotbars = content.hotbars || [];
      for (const hb of hotbars) {
        const items = hb.items || [];
        if (items.some((item: any) => item?.entity?.uid === "fleet-dashboard-entity")) {
          return true;
        }
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  public togglePin(): boolean {
    try {
      const filePath = this.getHotbarStorePath();
      if (!fs.existsSync(filePath)) return false;
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const hotbars = content.hotbars || [];
      if (!hotbars.length) return false;

      const hb = hotbars.find((h: any) => h.id === content.activeHotbarId) || hotbars[0];
      const items = hb.items || [];
      const existingIndex = items.findIndex(
        (item: any, idx: number) => idx > 0 && item?.entity?.uid === "fleet-dashboard-entity"
      );

      if (existingIndex > 0) {
        // Remove pin (replace with null to maintain 12 slots, protecting index 0)
        items[existingIndex] = null;
        fs.writeFileSync(filePath, JSON.stringify(content, null, "\t"), "utf-8");
        return false;
      } else {
        // Pin to hotbar
        const newItem = {
          entity: {
            uid: "fleet-dashboard-entity",
            name: "Fleet Dashboard",
            source: "local",
            shortName: "FD",
          },
        };
        // Strict guard: only search for empty slot starting from index 1 (Slot 0 is Catalog)
        let emptyIdx = -1;
        for (let i = 1; i < items.length; i++) {
          if (items[i] === null) {
            emptyIdx = i;
            break;
          }
        }

        if (emptyIdx >= 1) {
          items[emptyIdx] = newItem;
        } else if (items.length < 12) {
          items.push(newItem);
        } else {
          items[items.length - 1] = newItem;
        }
        fs.writeFileSync(filePath, JSON.stringify(content, null, "\t"), "utf-8");
        return true;
      }
    } catch (err) {
      console.error("[FleetDashboard] Failed to toggle hotbar pin:", err);
      return false;
    }
  }

  public ensurePinned(): boolean {
    if (this.isPinned()) return true;
    return this.togglePin();
  }
}
