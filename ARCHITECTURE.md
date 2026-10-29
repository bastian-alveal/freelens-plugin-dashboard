# 🏛️ ARQUITECTURA TÉCNICA Y ESPECIFICACIÓN DEL SISTEMA

Este documento detalla la arquitectura de software, los patrones de diseño, los protocolos de comunicación IPC y las soluciones de ingeniería implementadas en la extensión **FreeLens Fleet Dashboard**. Está diseñado para que cualquier desarrollador senior o modelo de IA pueda comprender con exactitud cómo opera el sistema internamente.

---

## 1. Diagrama de Arquitectura de Alto Nivel

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FREELENS HOST (ELECTRON RUNTIME)                                 │
├─────────────────────────────────────────┬────────────────────────────────────────────────────────┤
│           PROCESO RENDERER              │                  PROCESO MAIN                          │
│         (React / UI / DOM)              │                (Node.js Backend)                       │
│                                         │                                                        │
│  ┌───────────────────────────────────┐  │  ┌──────────────────────────────────────────────────┐  │
│  │   FleetDashboardRenderer (index)  │  │  │            FleetDashboardMain (index)            │  │
│  │  - Category: "Fleet Dashboard"    │  │  │  - Ciclo de vida: onActivate / onDeactivate      │  │
│  │  - customCategoryViews            │  │  │  - Dual IPC Handlers (Extension IPC + ipcMain)   │  │
│  │  - globalPages & clusterPages     │  │  └──────────────────────────┬───────────────────────┘  │
│  │  - statusBarItems (Quick Access)  │  │                             │                          │
│  └─────────────────┬─────────────────┘  │  ┌──────────────────────────▼───────────────────────┐  │
│                    │                    │  │          FleetStore (fleet-store.ts)             │  │
│  ┌─────────────────▼─────────────────┐  │  │  - Directorio: ~/.freelens/fleet-storage/        │  │
│  │     FleetDashboard.tsx (Root)     │  │  │  - Perfiles: profiles.json                       │  │
│  │  - Perfiles: Principal, etc.      │  │  │  - Kubeconfigs YAMLs: kubeconfigs/<id>.yaml      │  │
│  │  - Live Poller (15s, 30s, etc.)   │  │  └──────────────────────────────────────────────────┘  │
│  │  - Col Layouts (Auto, 2, 3, 4)    │  │                             │                          │
│  └───────┬─────────┬──────────┬──────┘  │  ┌──────────────────────────▼───────────────────────┐  │
│          │         │          │         │  │         K8sCollector (k8s-collector.ts)          │  │
│  ┌───────▼──┐ ┌────▼─────┐ ┌──▼───────┐ │  │  - Invocaciones paralelas (Promise.allSettled)   │  │
│  │ClusterCard│ │PodsInspec│ │DriftInspec│ │  │  - Timeouts estrictos por clúster (5s - 6.5s)     │  │
│  │- Toolbar │ │- DeepLink│ │- Workload│ │  │  - Extractor de Workload por Regex              │  │
│  │- Status  │ │- Live Srch│ │  Parity  │ │  │  - Detección de servicios huérfanos             │  │
│  └──────────┘ └──────────┘ └──────────┘ │  └──────────────────────────┬───────────────────────┘  │
└────────────────────┼────────────────────┴─────────────────────────────┼──────────────────────────┘
                     │                                                  │
                     ▼                                                  ▼
         Canales IPC Bidireccionales                    API Servers de Kubernetes (HTTPS)
   (discover, telemetry, storage, drift)          (Azure AKS, MicroK8s, AWS EKS, On-Prem)
```

---

## 2. Proceso Main vs Proceso Renderer & Protocolo IPC

### 2.1. El Reto de Aislamiento en FreeLens
En FreeLens (y Lens), el renderer puede ejecutarse en sub-marcos (`iframes`) o contextos con `contextIsolation: true`. Esto significa que el objeto nativo de Node.js `process` o `require('electron')` puede no estar directamente en el `window`.

Para solucionar esto, la extensión implementa un **Mecanismo de Doble Registro IPC**:
1. **Extension IPC (Recomendado por FreeLens):**
   * En `Main`: `const extIpc = Main.Ipc.createInstance(this); extIpc.handle(channel, handler);`
   * En `Renderer`: `const extIpc = Renderer.Ipc.createInstance(this); extIpc.invoke(channel, ...args);`
2. **Electron IPC Fallback (Resiliencia):**
   * En `Main`: `ipcMain.handle("fleet:" + channel, handler);`
   * En `Renderer`: Invoca `window.require("electron").ipcRenderer.invoke("fleet:" + channel)` si el IPC de la extensión se ve interrumpido por el router de Lens.

### 2.2. Canales IPC Expuestos (19 Canales)

| Canal IPC | Parámetros | Retorno | Propósito |
|---|---|---|---|
| `discover-clusters` | *(ninguno)* | `Array<{name, path}>` | Descubre archivos kubeconfig válidos en `~/.kube/` y directorios padre. |
| `fetch-telemetry` | `targets: AssociatedCluster[]` | `ClusterSummary[]` | Consulta en paralelo la API de K8s de los clústeres activos con métricas de consumo en tiempo real y timeouts estrictos. |
| `calculate-drift` | `{ clusterA, clusterB }` | `ClusterDrift` | Diferenciador estructural entre dos clústeres. |
| `get-storage` | *(ninguno)* | `FleetStorageData` | Lee el archivo persistente `~/.freelens/fleet-storage/profiles.json`. |
| `save-storage` | `data: FleetStorageData` | `boolean` | Escribe de forma atómica los perfiles y clústeres en el disco local. |
| `save-uploaded-kubeconfig` | `{ clusterId, yamlContent }` | `{ success, savedPath }` | Guarda permanentemente un YAML subido por drag-and-drop en `~/.freelens/fleet-storage/kubeconfigs/<id>.yaml`. |
| `get-hotbar-status` | *(ninguno)* | `{ isPinned: boolean }` | Lee `lens-hotbar-store.json` y verifica si el Fleet Dashboard está anclado en el Dock. |
| `toggle-hotbar-pin` | *(ninguno)* | `{ isPinned: boolean }` | Agrega o remueve el acceso directo en `lens-hotbar-store.json` preservando la integridad del Slot 0. |
| `get-pod-logs` | `PodLogRequest` | `PodLogResponse` | Consulta logs en vivo con timestamps, contenedor específico o `--previous`. |
| `restart-pod` | `{ clusterId, namespace, podName }` | `PodActionResponse` | Elimina el pod controlado para regeneración inmediata por K8s. |
| `get-pod-manifest` | `{ clusterId, namespace, podName }` | `any` (V1Pod JSON) | Obtiene el manifiesto completo y especificación del pod. |
| `exec-pod-command` | `PodExecRequest` | `PodExecResponse` | Ejecuta comandos interactivos dentro de un pod vía `k8s.Exec` y WebSocket. |

### 2.3. Patrón Universal `resolvePayload` en IPC
Lens Extension IPC invoca los handlers con la firma directa `handler(payload)`, mientras que `ipcMain.handle` de Electron lo hace con `handler(event, payload)`. Para garantizar compatibilidad universal sin importar la ruta de despacho, los handlers en `src/main/index.ts` emplean:
```typescript
const resolvePayload = (a: any, b: any) => {
  if (b !== undefined) return b;
  if (a && typeof a === "object" && ("sender" in a || "senderFrame" in a || "processId" in a)) {
    return undefined;
  }
  return a;
};
```

### 2.4. Adopción Estricta de `ObjectParamAPI` en `@kubernetes/client-node` v1.x
A partir de `@kubernetes/client-node` v1.x, las funciones de `CoreV1Api` (`readNamespacedPodLog`, `deleteNamespacedPod`, `readNamespacedPod`, `readNamespacedSecret`, etc.) son generadas bajo OpenAPI TypeScript en modo objeto:
```typescript
// Correcto (v1.x ObjectParamAPI):
await coreApi.deleteNamespacedPod({ name: podName, namespace: namespace, gracePeriodSeconds: 0 });
await coreApi.readNamespacedPodLog({ name: podName, namespace: namespace, tailLines: 100, timestamps: true });

// Incorrecto (provoca RequiredError: Required parameter name was null or undefined):
await coreApi.deleteNamespacedPod(podName, namespace, undefined, undefined, 0);
```

## 3. Webpack Dual y Externals Críticos

En `webpack.config.js`:
* **Main Config (`electron-main`):**
  * Entrypoint: `src/main/index.ts` -> `out/main/index.js`
  * Externals: `@freelensapp/extensions: "global LensExtensions"`. **Nota Crítica:** Si se externaliza como `"commonjs @freelensapp/extensions"`, la extensión falla en tiempo de arranque con `Cannot find module '@freelensapp/extensions'`.
* **Renderer Config (`web`):**
  * Entrypoint: `src/renderer/index.tsx` -> `out/renderer/index.js`
  * Externals: `react: "React"`, `@freelensapp/extensions: "LensExtensions"`.

### Categoría de Catálogo de Primer Nivel
Para que "Fleet Dashboard" aparezca en la barra lateral del catálogo al mismo nivel que *Clusters*, *Web Links* y *General*, se extiende de `Common.Catalog.CatalogCategory`:
```typescript
class FleetCategory extends Common.Catalog.CatalogCategory {
  apiVersion = "catalog.k8slens.dev/v1alpha1";
  kind = "CatalogCategory";
  metadata = { name: "Fleet Dashboard", icon: "dashboard" };
  spec = { group: "entity.freelens.app", versions: [], names: { kind: "FleetDashboard" } };
}
```
*Tanto en `Main` como en `Renderer` se registra con `catalogCategories.add(fleetCategory)`.*

---

## 4. Pipeline de Resiliencia de Red y Timeouts (Anti-Freezing)

Las llamadas de red de Node.js a clústeres de Kubernetes remotos (como Azure AKS o VPNs caídas) no tienen timeout por defecto y pueden congelar el hilo durante minutos. El sistema implementa una **estrategia de defensa en 3 capas**:

```
[Petición K8s] ──► [Capa 1: withTimeout 5s] ──► [Capa 2: IPC Promise.race 6.5s] ──► [Capa 3: UI Safety 8.5s]
```

### 4.1 Estrategia Anti-Freezing en 3 Capas
1. **Capa 1 (API Client):** En `k8s-collector.ts`, cada llamada a `coreApi.listNode()`, `coreApi.listPodForAllNamespaces()`, etc., está envuelta en un helper `withTimeout(promise, 5000, fallback)`. Si el clúster no contesta en 5 segundos, la llamada se aborta y retorna un valor seguro.
2. **Capa 2 (Controlador IPC):** En `main/index.ts`, la recolección de cada clúster corre bajo `Promise.allSettled` con un límite estricto de `6500ms`. Si un clúster no responde, se genera automáticamente un `ClusterSummary` con estado `unreachable` y el mensaje `"Tiempo de espera agotado (>6s). Clúster o VPN no responde."`. Los clústeres saludables contiguos jamás esperan por el clúster caído.
3. **Capa 3 (Frontend UI):** En `FleetDashboard.tsx`, el `invokeIpc("fetch-telemetry")` corre dentro de un `Promise.race` con un timeout de `8500ms`. Se garantiza que el spinner `🔄 Sincronizando...` se desbloquee siempre.

### 4.2 Motor de Detección y Fallback TLS para MicroK8s / Certificados Autofirmados
En clústeres locales o perimetrales (ej. MicroK8s en `https://192.168.14.12:16443`), la autoridad certificadora suele ser autofirmada. Node.js rechaza estas conexiones por defecto (`unable to verify the first certificate`), provocando que las llamadas a la API fallen silenciosamente a pesar de existir conectividad IP.

El sistema implementa dos mecanismos complementarios:
1. **Inspección Previa (`applyTlsFallback`):** Antes de crear los clientes API (`CoreV1Api`, `VersionApi`, `CustomObjectsApi`), se inspecciona la URL del servidor del clúster. Si la IP pertenece a redes privadas RFC 1918 (`192.168.*`, `10.*`, `172.16-31.*`, `127.*`, `localhost`) o utiliza puertos estándar de MicroK8s/K8s local (`:16443`, `:6443`), se asigna automáticamente `skipTLSVerify = true` sobre la configuración del clúster.
2. **Auto-Recuperación Reactiva:** Si durante la llamada a `versionApi.getCode()` o en el wrapper `withTimeout` se captura un error relacionado con certificados (`certificate`, `CERT_`, `unable to verify`, `self signed`), el sistema conmuta dinámicamente `kc.clusters.forEach(c => c.skipTLSVerify = true)` y reintenta la consulta sin degradar la experiencia de usuario.

---

## 5. Algoritmo de Identificadores Únicos y Aislamiento Multi-Perfil

### El Bug Anterior
Anteriormente se utilizaba `Buffer.from(filePath).toString("base64").substring(0, 12)`. Dado que todos los kubeconfigs del usuario residían en `/Users/bastianalveallampe/...`, los primeros 12 caracteres en base64 de **cualquier archivo** eran idénticos (`L1VzZXJzL2Jh`). Asimismo, cuando dos perfiles distintos (ej. *Principal* y *Preprod*) subían un archivo con el mismo nombre (ej. `bastian.alveal-kubeconfig.yaml`), ambos recibían el mismo ID y sobreescribían el archivo `.yaml` físico en disco.

### La Solución Implementada
Se diseñó un generador determinista que incluye el contenido del YAML en la semilla del hash para garantizar unicidad global tanto intra-perfil como cross-perfil:
```typescript
function generateClusterId(filePath?: string, name?: string, yamlContent?: string): string {
  const seed = yamlContent
    ? `${name || "cluster"}-${yamlContent.substring(0, 150)}-${Date.now()}`
    : filePath || name || `cluster-${Date.now()}-${Math.random()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  const cleanSlug = (name || (filePath ? filePath.split("/").pop() : "cluster") || "cluster")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .substring(0, 24);
  return `${cleanSlug}-${Math.abs(hash).toString(36)}`;
}
```
*Produce identificadores únicos como `prod-bancoestado-192-168-14-12` y `preprod-bancoestado-192-168-14-10`, evitando cualquier sobreescritura accidental.*

---

## 6. Matriz de Paridad de Cargas (Workload Parity Matrix)

El Comparador de Deriva (`DriftInspector.tsx`) implementa un algoritmo para comparar microservicios entre clústeres independientemente del nombre aleatorio generado por Kubernetes:

### Normalización de Nombres de Pods
```typescript
function getWorkloadName(podName: string): string {
  // 1. Deployment / ReplicaSet: <name>-<hash8-10>-<id5> (ej: pdr-ms-admin-c58f7985c-bnlbv -> pdr-ms-admin)
  if (/-[a-z0-9]{8,10}-[a-z0-9]{5}$/i.test(podName)) {
    return podName.replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/i, "");
  }
  // 2. StatefulSet: <name>-<ordinal> (ej: kafka-0 -> kafka)
  if (/-[0-9]+$/.test(podName)) {
    return podName.replace(/-[0-9]+$/, "");
  }
  // 3. DaemonSet / Job: <name>-<id5> (ej: db-migrator-k928a -> db-migrator)
  if (/-[a-z0-9]{5}$/i.test(podName)) {
    return podName.replace(/-[a-z0-9]{5}$/i, "");
  }
  return podName;
}
```

### Clasificación de Deriva
Para cada microservicio en un namespace determinado:
* `replicasA === replicasB` ➡️ `✓ Matched (Paridad Exacta)`
* `replicasA > 0 && replicasB > 0 && replicasA !== replicasB` ➡️ `⚠️ Unbalanced (Desbalance de Réplicas)`
* `replicasA > 0 && replicasB === 0` ➡️ `🔴 Only in A (Falta en Clúster B)`
* `replicasB > 0 && replicasA === 0` ➡️ `🔴 Only in B (Falta en Clúster A)`

---

## 7. Persistencia en Disco Físico (`~/.freelens/fleet-storage/`)

Gestionado por `FleetStore` (`src/main/fleet-store.ts`):
* **Archivo de configuración:** `~/.freelens/fleet-storage/profiles.json`
```json
{
  "activeProfile": "Principal",
  "profiles": {
    "Principal": [
      {
        "id": "config-parques-prod-lkx4vz",
        "name": "config-parques-prod",
        "alias": "Aks-Prod-App",
        "path": "/Users/bastianalveallampe/.kube/config-parques-prod",
        "enabled": true
      }
    ],
    "Staging": []
  }
}
```
* **Almacenamiento de YAMLs:** Cuando el usuario arrastra un archivo sin ruta física, el contenido se persiste en:
  `~/.freelens/fleet-storage/kubeconfigs/<id>.yaml`
  De este modo, los clústeres subidos sobreviven a reinicios del sistema operativo y de FreeLens.

---

## 8. Supresión del Catálogo Nativo Redundante

En FreeLens, cuando se registra una categoría personalizada, el marco host siempre inserta por defecto una tabla vacía de entidades (`ItemListLayout`) con el texto:
```
Fleet Dashboard
0 items
Item list is empty
```
Para eliminar esta tabla redundante y dejar el dashboard 100% limpio, se inyectaron reglas CSS globales en `styles.css`:
```css
[data-testid="catalog-list-for-Fleet Dashboard"],
[data-testid="catalog-list-for-fleet-dashboard"],
#catalog-items-FleetDashboard,
div[class*="Catalog"][data-testid*="Fleet Dashboard"] {
  display: none !important;
}
```
Y para el contenedor principal de la extensión:
```css
.fleet-container {
  height: 100vh;
  overflow-y: auto !important;
  overflow-x: hidden;
  box-sizing: border-box;
}
```
Permitiendo un scroll vertical infinito y fluido en todas las vistas.

---

## 9. Arquitectura de Anclaje en el Dock (Hotbar) y Enrutamiento Global Independiente

### 9.1 La Hotbar de FreeLens y el Invariante del Slot 0
FreeLens implementa su barra de accesos directos vertical lateral (Dock / Hotbar) mediante un almacén JSON administrado en disco:
* **macOS:** `~/Library/Application Support/Freelens/lens-hotbar-store.json`
* **Linux:** `~/.config/Freelens/lens-hotbar-store.json`
* **Windows:** `%APPDATA%/Freelens/lens-hotbar-store.json`

Estructura canónica del archivo:
```json
{
	"hotbars": [
		{
			"id": "default-hotbar",
			"name": "Default",
			"items": [
				{
					"entity": {
						"uid": "catalog-entity",
						"name": "Catalog",
						"source": "app"
					}
				},
				{
					"entity": {
						"uid": "fleet-dashboard-entity",
						"name": "Fleet Dashboard",
						"source": "extension",
						"shortName": "FD"
					}
				},
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null
			]
		}
	]
}
```

#### ⚠️ El Invariante Absoluto del Slot 0 (`catalog-entity`)
* FreeLens reserva contractualmente el índice `items[0]` para el icono nativo del **Catálogo**.
* Si una extensión altera, sobreescribe o elimina el índice 0, el botón del Catálogo se destruye en la interfaz gráfica, rompiendo la navegación esencial del usuario en FreeLens.
* **Regla:** El anclaje de extensiones debe buscar slots vacíos exclusivamente a partir del índice 1 (`items[1]` hasta `items[11]`). Si se remueve el anclaje, el slot correspondiente se resetea a `null` preservando los 12 elementos exactos.

---

### 9.2 HotbarService (`src/main/hotbar-service.ts`)
Implementado bajo el patrón Singleton en el proceso Main de Electron:
1. **Detección Automática de Rutas:** Consulta `app.getPath("userData")` con fallbacks para macOS, Linux y Windows.
2. **`isPinned()`:** Lee el store de forma atómica y comprueba si algún elemento contiene `item?.entity?.uid === "fleet-dashboard-entity"`.
3. **`togglePin()`:**
   * Si la entidad ya existe en la Hotbar, la remueve asignando `items[existingIndex] = null` y persiste el JSON con indentación estándar tabulada (`\t`).
   * Si no existe, genera el descriptor:
     ```json
     {
       "entity": {
         "uid": "fleet-dashboard-entity",
         "name": "Fleet Dashboard",
         "source": "extension",
         "shortName": "FD"
       }
     }
     ```
     Inserta el descriptor en el primer slot nulo disponible (a partir del índice 1) y escribe el archivo atómicamente.
4. **Exposición IPC:** Expone los canales `fleet:get-hotbar-status` y `fleet:toggle-hotbar-pin` a través de `ipcMainHandle` y `ipcMain.handle`.

---

### 9.3 Enrutamiento Global Desacoplado (`globalPages` vs `clusterPages`) y Resolución de Colisiones DI
FreeLens utiliza un contenedor de Inyección de Dependencias (DI basado en Inversify) para registrar las rutas expuestas por extensiones.

#### El Bug de Colisión de Identificadores:
Si se define el mismo `id` (por ejemplo `"fleet-dashboard"`) tanto en `clusterPages` como en `globalPages`:
* FreeLens registra la clave DI: `route-fleet-dashboard-for-extension-freelens-fleet-dashboard`.
* La definición de `clusterPages` (`clusterFrame: true`) sobreescribe la de `globalPages` (`clusterFrame: false`).
* Al hacer clic en el Dock (o en un link fuera de un clúster), FreeLens no encuentra ninguna ruta global válida para ese ID y activa su manejador de contingencia, redirigiendo a `welcomeUrl` (el Catálogo).
* **Solución Arquitectónica:**
  * **Ruta Global Dedicada (Dock / Standalone):** `id: "fleet"` ➡️ URL `/extension/freelens-fleet-dashboard/fleet`
  * **Ruta de Clúster (Menú lateral de Clúster):** `id: "cluster-fleet"` ➡️ URL `/extension/freelens-fleet-dashboard/cluster-fleet`

---

### 9.4 Conflicto de Capas Visuales (`#lens-views` vs `.fleet-container`)
En FreeLens, las vistas de extensiones a nivel global son inyectadas como hijos directos del componente `<main className="ClusterManager">`.

#### El Problema del Overlay Opaco:
La hoja de estilos nativa de FreeLens define:
```css
.ClusterManager #lens-views {
  position: absolute;
  inset: 0;
  z-index: 1;
  background-color: var(--mainBackground);
}
```
Si el contenedor de la extensión `.fleet-container` se renderiza con posicionamiento estático y sin un contexto de apilamiento explícito:
* `#lens-views` se posiciona de forma absoluta por encima del dashboard, cubriendo completamente la pantalla con el fondo opaco.
* El usuario experimenta una pantalla "en blanco" o ve únicamente los indicadores de conexión de clústeres mientras el componente React está montado debajo.

#### Solución CSS en `src/renderer/styles.css`:
```css
.ClusterManager:has(.fleet-container) #lens-views {
  display: none !important;
}

.fleet-container {
  position: relative !important;
  z-index: 10 !important;
  width: 100% !important;
  height: 100vh !important;
  overflow-y: auto !important;
  overflow-x: hidden;
  box-sizing: border-box;
}
```
Esto anula el renderizado de `#lens-views` en presencia del dashboard y asegura que `.fleet-container` domine el contexto de apilamiento en el DOM.

---

## 10. Consola Inferior Multipestaña Acoplada (`BottomConsolePanel.tsx`)

### 10.1. El Problema de los Modales de Pantalla Completa
En flotas de producción, abrir un modal bloqueante que ocupe toda la pantalla para inspeccionar logs o ejecutar un comando en terminal aísla al operador de la visión global:
* No se puede cotejar un log con la tabla de pods fallidos o con las barras de consumo del clúster.
* Cerrar el modal destruía la conexión de streaming y limpiaba el historial de comandos ejecutados.
* Abrir dos terminales o dos visores de logs simultáneos para correlacionar pods relacionados era imposible.

### 10.2. Arquitectura de Pestañas Acopladas con Persistencia en DOM y Store Global
`BottomConsolePanel` implementa un modelo de consola inferior acoplada (workbench dock):
1. **Layout Flex Puro (Cero Solapamiento sobre el Dock de FreeLens):**
   * `.fleet-container` opera como contenedor flex vertical (`display: flex; flex-direction: column; height: 100vh; overflow: hidden;`).
   * El contenido del dashboard se aloja en `.fleet-scrollable-content` (`flex: 1 1 auto; overflow-y: auto;`).
   * `BottomConsolePanel` se renderiza como hijo flex inferior (`flex-shrink: 0; position: relative; width: 100%;`).
   * De este modo, la consola vive estrictamente dentro del marco del plugin y **nunca invade ni solapa la barra lateral (Hotbar) de FreeLens**.
2. **Redimensionamiento Reactivo por Arrastre (Drag-to-Resize):**
   * Una barra invisible en el borde superior (`height: 4px; cursor: row-resize`) escucha eventos de arrastre del ratón, permitiendo ajustar la altura de la consola entre 160px y 800px.
3. **Persistencia Total de Sesiones ante Cambio de Clúster (`ConsoleStore`):**
   * Cuando el usuario hace clic en un clúster anclado en el Dock de FreeLens (`AAP`, `ACP`, etc.), el componente `FleetDashboard` se desmonta de la vista.
   * `ConsoleStore` (`src/renderer/stores/console-store.ts`) actúa como un singleton persistente en el hilo del renderer y sincroniza su estado con `localStorage`.
   * Al regresar al Fleet Dashboard, todas las pestañas abiertas, el historial de comandos ejecutados en la terminal shell (`CommandOutput[]`) y las trazas acumuladas en streaming de logs se restauran de inmediato sin perder la sesión.
4. **Conservación de Estado en Background (`display: isTabActive ? "flex" : "none"`):**
   * Al alternar entre pestañas de logs y terminales shell dentro de la consola, los componentes no se desmontan, preservando sus sockets y buffers vivos en el DOM.
5. **Controles de Ventana del Workbench:**
   * **Minimizar / Expandir (`isCollapsed`):** Permite esconder el contenido reduciendo la barra a una franja de pestañas compacta de 38px.
   * **Agrandar / Reducir (`isMaximized`):** Expande la consola hasta un 75vh de la pantalla.
   * **Botón de Acceso Rápido `[ 💻 Consola Activa (N) ]`:** Presente en la barra de navegación superior del dashboard.
   * **Pulsadores de Cierre:** Cierre quirúrgico por pestaña `✕` o vaciado completo mediante `✕ Cerrar todo`.

---

## 11. Menú Popover Contextual Flotante de Acciones (`PodsInspector.tsx`)

### 11.1. Supresión del Ruido Visual en Filas de Pods
Tener 4 botones individuales de colores por cada fila (`Logs`, `Shell`, `Reiniciar`, `Manifiesto`) en tablas con 100+ pods saturaba la interfaz de ruido visual y reducía el espacio horizontal útil para los mensajes de error de Kubernetes.

### 11.2. Patrón de Disparo Contextual y Posicionamiento Seguro
* Cada fila cuenta con un disparador unificado `⚡ Acciones ▾` y selección directa al hacer clic en cualquier celda de la fila.
* Se calcula dinámicamente la posición del popover:
  ```typescript
  top: Math.min(actionMenuPos.y + 6, window.innerHeight - 260)
  left: Math.min(actionMenuPos.x - 170, window.innerWidth - 240)
  ```
  Esto garantiza que el menú nunca se desborde fuera del viewport de la ventana de FreeLens ni quede oculto tras bordes inferiores o laterales.
* **Manejador Global de Descarte:**
  * Escucha clics en `window` (`pointerdown` o `click`) descartando el menú si el usuario interactúa fuera del popover.
  * Escucha el evento `keydown` de la tecla `Escape` (`ESC`) para cerrar instantáneamente el menú flotante.

---

## 12. Motor de Logs Parseados y Estructurados (`PodLogsModal.tsx`)

### 12.1. Streaming Continuo por Defecto (`tail -f`)
Al abrir cualquier pod, `isStreaming` se inicializa en `true`. El temporizador reactivo (`2.2s`) solicita líneas acumuladas sin refrescar la página, ofreciendo una experiencia similar a `kubectl logs -f` de terminal nativa.

### 12.2. Algoritmo de Parseo Sintáctico (`parseLogLine`)
El visor procesa cada línea de log mediante expresiones regulares sin sobrecargar el hilo de renderizado:
1. **Marcas de Tiempo:** Reconoce timestamps en formato RFC3339 / ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) y las extrae a una columna fija en azul cian monospace (`#38bdf8`).
2. **Nivel de Severidad:** Identifica palabras clave `ERROR|FATAL|PANIC|CRITICAL`, `WARN|WARNING`, `INFO|NOTICE`, `DEBUG|TRACE` y las convierte en insignias cromáticas de alto contraste.
3. **Payloads JSON Estructurados:** Si el contenido restante es un objeto JSON válido (ej. logs de Bunyan, Zap o Winston), parsea automáticamente las claves principales (como `msg`, `status`, `caller`) y las resalta visualmente.
4. **Buscador con Resaltado y Contador de Coincidencias:** Filtra reactivamente las líneas por término de búsqueda y resalta las ocurrencias exactas con fondo amarillo/naranja y contador explícito `(N coincidencias)`.

---

## 13. Arquitectura del Sistema de Alarmas en Tiempo Real (`AlarmNotifications.tsx`)

### 13.1. Detección Algorítmica de Reinicios sin Falsos Positivos
El proceso de supervisión opera de forma desacoplada dentro de `fetchTelemetry` en `FleetDashboard.tsx`:
1. **Inicialización y Línea Base:** Durante la primera carga de telemetría (`isInitialTelemetryRef.current = true`), el sistema almacena en la referencia `previousPodsRef` un mapa en memoria con el `restartCount`, `phase` y `reason` de cada pod detectado (`key = ${clusterId}:${namespace}:${podName}`). No se dispara ninguna alerta sobre reinicios ocurridos en el pasado.
2. **Cálculo de Deltas en Tiempo Real:** En cada ciclo sucesivo de auto-refresco (15s, 30s o sincronización manual):
   * Compara `pod.restarts` con `prev.restarts`.
   * Si `pod.restarts > prev.restarts`, se calcula el incremento exacto (`restartDelta = pod.restarts - prev.restarts`) y se emite una instancia de `PodRestartAlarm`.
   * Se actualiza inmediatamente la referencia en memoria con el nuevo estado.

### 13.2. Toasts Flotantes Estructurados con Acción Directa
Las alertas se proyectan en un contenedor fijo superior (`z-index: 99999`) con animación `@keyframes toastSlideIn`:
* **Datos Estructurados:** Muestra Clúster (con alias), Namespace, Pod en monospace (`#79c0ff`), insignia cromática del delta (`prev ➔ curr (+N)`), causa (`CrashLoopBackOff`, `OOMKilled`) y hora del incidente.
* **Profundización en 1 Clic (Deep Links):**
  * `[ 📄 Ver Logs en Vivo ]`: Despacha `handleOpenLogsTab(...)` abriendo la sesión de logs en streaming en el workbench inferior.
  * `[ 🔍 Diagnosticar ]`: Desplaza la navegación a `PodsInspector` prefiltrando el clúster afectado.
* **Auto-Descarte Seguro:** Los toasts se cierran automáticamente a los 18 segundos, pero permanecen archivados en el historial de sesión.

### 13.3. Síntesis de Audio 100% Offline (Web Audio API)
La función `playAlarmSound()` instancia dinámicamente un `AudioContext` nativo del navegador, combinando dos osciladores (`sine` en 659.25 Hz - E5 y `triangle` en 329.63 Hz - E4) con modulación de rampa exponencial hacia 880 Hz (A5) y decaimiento en 380ms.
* **Ventajas:** Cero dependencias de archivos de audio locales o remotos, cero latencia de red y compatibilidad nativa con las políticas de reproducción de Electron.
* **Control de Usuario:** Conmutador persistente `🔊 Sonido Activo / 🔇 Silenciado` en `localStorage` (`freelens_fleet_alarm_sound`).

### 13.4. Notificaciones Nativas de Sistema Operativo (macOS / Electron)
La rutina `triggerDesktopNotification` valida los permisos mediante la API estándar `Notification`:
* Si el operador tiene FreeLens minimizado o enfocado en otra ventana (terminal, editor), el Centro de Notificaciones de macOS presenta el banner con el nombre del clúster, namespace, pod y causa del fallo.

### 13.5. Centro de Alarmas e Historial (`isAlarmDrawerOpen`)
* **Acceso Dual:** Botón `🔔 Alarmas` integrado en la barra de navegación superior y en la barra de pestañas, con un badge numérico animado (`@keyframes alarmPulse`).
* **Drawer Desplegable:** Panel lateral que lista en orden cronológico inverso los últimos 50 incidentes detectados en la sesión, permitiendo reproducir alarmas de prueba (`[ 🧪 Probar Alarma ]`) o limpiar el histórico.



