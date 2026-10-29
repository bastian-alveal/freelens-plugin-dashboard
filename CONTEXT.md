# 🧠 CONTEXTO HISTÓRICO, DECISIONES Y GUÍA PARA MODELOS DE IA

Este documento preserva todo el historial operativo, las lecciones aprendidas, los bugs críticos resueltos y las reglas fundamentales del proyecto para que cualquier modelo de IA o ingeniero pueda continuar el desarrollo sin cometer errores pasados.

---

## 1. Perfil del Entorno y Usuario

* **Usuario / Operador:** Bastian Alveal Lampe (Senior DevOps / SRE).
* **Sistema Operativo:** macOS (Darwin arm64).
* **Herramienta Host:** **FreeLens** `v1.10.3` (fork de código abierto de Lens / OpenLens).
* **Directorio Base del Proyecto:** `/Users/bastianalveallampe/Desktop/Padsystem/kubeconfigs/K8S-IC/freelens-fleet-dashboard`
* **Directorio de Extensiones de FreeLens:** `~/.freelens/extensions/freelens-fleet-dashboard/`
* **Directorio de Almacenamiento Persistente en Disco:** `~/.freelens/fleet-storage/`
* **Clústeres Activos Habituales del Operador:**
  * `config-parques-prod` (`Aks-Prod-App`): Azure Kubernetes Service (AKS v1.27.7, 11 nodos, ~338 pods).
  * `config-parques-prod-core` (`Aks-Prod-Core`): Azure Kubernetes Service (AKS v1.27.7, 3 nodos, ~78 pods).
  * `balveal-dataops-config` (`DataOps`): MicroK8s v1.29.13 (6 nodos, ~84 pods).
  * `balveal-monitoring-kubeconfig` (`Monitoring`): MicroK8s v1.29.13 (4 nodos, ~51 pods).

---

## 2. Historial de Retos Técnicos y Soluciones Aplicadas

### Reto 1: Fallo de Módulo en Proceso Main (`Cannot find module '@freelensapp/extensions'`)
* **Síntoma:** Al arrancar FreeLens, la extensión no iniciaba en el backend de Electron arrojando error de módulo no encontrado.
* **Causa:** En Webpack, la configuración del proceso Main tenía `@freelensapp/extensions` como dependencia externa común de Node.js (`commonjs`), pero en FreeLens las APIs de extensión residen en la variable global `global.LensExtensions`.
* **Solución:** En `webpack.config.js`, se configuró `externals: { "@freelensapp/extensions": "global LensExtensions" }`.

---

### Reto 2: Categoría de Catálogo Propia (No anidada dentro de "General")
* **Síntoma:** La opción de menú aparecía escondida dentro de la categoría genérica "General".
* **Causa:** Se estaba registrando solo como una página estándar sin instanciar una `CatalogCategory` de primer orden.
* **Solución:** Se creó la clase `FleetCategory extends Common.Catalog.CatalogCategory` con `group: "entity.freelens.app"` y `kind: "FleetDashboard"`, registrándola en `Main.Catalog.catalogCategories.add(...)` y en `Renderer.Catalog.catalogCategories.add(...)`.

---

### Reto 3: El Bug de Colisión de IDs (`L1VzZXJzL2Jh`)
* **Síntoma:** Al agregar `config-parques-prod` y `config-parques-prod-core`, desmarcar uno desmarcaba ambos, y en la pantalla se sobreescribían tomándose como un solo clúster.
* **Causa:** Para el ID interno se usaba `Buffer.from(filePath).toString("base64").substring(0, 12)`. Dado que ambos archivos están en `/Users/bastianalveallampe/...`, los primeros 12 caracteres en base64 de **cualquier archivo de la máquina** eran literalmente idénticos: `L1VzZXJzL2Jh` (correspondiente al prefijo `/Users/bastia`).
* **Solución:** Se reemplazó por la función `generateClusterId(filePath, name)` que calcula un hash entero de 32 bits junto al slug del nombre del archivo (ej. `config-parques-prod-lkx4vz` vs `config-parques-prod-core-y6vegb`). Además, se agregó una rutina de auto-migración que sanea clústeres antiguos con el ID colisionado al cargar el dashboard.

---

### Reto 4: Reseteo de Configuración al Reiniciar FreeLens
* **Síntoma:** Al reiniciar FreeLens, los clústeres agregados y los archivos YAML subidos desaparecían del dashboard.
* **Causa:** La configuración se guardaba únicamente en el `localStorage` del iframe de Electron, el cual se limpiaba periódicamente por los ciclos de recarga de la aplicación.
* **Solución:** Se implementó `FleetStore` (`src/main/fleet-store.ts`), una capa de almacenamiento que persiste la estructura de perfiles en el disco físico del Mac en `~/.freelens/fleet-storage/profiles.json`, y guarda los archivos YAML subidos en `~/.freelens/fleet-storage/kubeconfigs/<id>.yaml`.

---

### Reto 5: Bloqueo de Scroll Vertical y Ancho Rígido de Tarjetas
* **Síntoma:** Al agregar más de 3 clústeres, la 4ta tarjeta saltaba a la fila de abajo pero el usuario no podía bajar con el ratón. Además, los botones de acción (`⚡ Activo`, `⚖️ Comparar`, `✕`) se salían de la tarjeta.
* **Causa:** `.fleet-container` no tenía `overflow-y: auto`, y la cuadrícula exigía un ancho mínimo de `360px` por tarjeta. En la cabecera, todos los botones compartían una única fila horizontal rígida.
* **Solución:**
  1. Se añadió `overflow-y: auto !important; height: 100vh;` al contenedor.
  2. Se ajustó el ancho mínimo a `290px` para que quepan 4 tarjetas por fila en pantallas estándar.
  3. Se añadió un selector de columnas manual: `Columnas: [ Auto ] [ 2 ] [ 3 ] [ 4 ]`.
  4. Se rediseñó `ClusterCard.tsx` trasladando los botones a una barra de herramientas interna propia que nunca desborda los límites de la tarjeta.

---

### Reto 6: Peticiones Colgadas ("Sincronizando..." permanente durante 5 minutos)
* **Síntoma:** Al intentar actualizar la flota, el botón quedaba en `🔄 Sincronizando...` indefinidamente.
* **Causa:** `@kubernetes/client-node` no tiene timeouts en peticiones HTTP/TCP. Si un archivo kubeconfig tenía 0 contextos (como `balveal-app-config` en `.kube`), o un clúster de Azure requería renovación de tokens o VPN apagada, `Promise.all` en el proceso Main quedaba congelado esperando indefinidamente.
* **Solución:** Se diseñó una arquitectura de timeouts en 3 capas:
  * Helper `withTimeout(promise, 5000, fallback)` por cada API call.
  * `Promise.allSettled` con límite estricto de `6500ms` en el handler IPC de Electron.
  * Guardia máxima de `8500ms` en la interfaz gráfica para garantizar el desbloqueo del spinner.

---

### Reto 7: Tabla Residual Vacía del Catálogo de FreeLens
* **Síntoma:** Al final de la vista aparecía un bloque con el texto: `Fleet Dashboard / 0 items / Item list is empty`.
* **Causa:** FreeLens por defecto inserta su componente nativo `ItemListLayout` debajo de cualquier vista de categoría de catálogo.
* **Solución:** Se inyectaron reglas CSS en `styles.css` dirigidas a `#catalog-items-FleetDashboard` y `[data-testid*="catalog-list-for-Fleet Dashboard"]` con `display: none !important`.

---

### Reto 8: Colisión de IDs de Rutas en el Contenedor DI de FreeLens (`globalPages` vs `clusterPages`)
* **Síntoma:** Al hacer clic en el acceso directo del Dock (Hotbar) o intentar navegar directamente a la URL de la extensión, FreeLens redirigía de inmediato al Catálogo (`welcomeUrl`), o la vista no respondía.
* **Causa:** FreeLens utiliza InversifyJS como contenedor de Inyección de Dependencias para el enrutamiento. Inicialmente se declaró `id: "fleet-dashboard"` tanto en `globalPages` como en `clusterPages`. El binding del cluster (`clusterFrame: true`) sobreescribía al binding global (`clusterFrame: false`). Al dispararse la navegación desde el Dock (fuera del contexto de un clúster), FreeLens no encontraba ninguna ruta global activa para ese ID y ejecutaba su fallback automático redirigiendo al Catálogo.
* **Solución:** Se desambiguaron completamente los identificadores de ruta:
  * `globalPages` usa `id: "fleet"` (accesible en `/extension/freelens-fleet-dashboard/fleet`).
  * `clusterPages` usa `id: "cluster-fleet"` (accesible en `/extension/freelens-fleet-dashboard/cluster-fleet`).

---

### Reto 9: Conflicto de Capas Visuales de `#lens-views` (`z-index: 1`)
* **Síntoma:** Al pulsar el icono anclado en el Dock, la consola indicaba carga exitosa y se escuchaban las peticiones de red, pero la pantalla permanecía completamente negra/vacía, mostrando únicamente los círculos de reconexión de clústeres.
* **Causa:** FreeLens monta las extensiones globales dentro de `<main className="ClusterManager">`. Su CSS interno contiene `#lens-views { position: absolute; inset: 0; z-index: 1; background-color: var(--mainBackground); }`. Al no contar `.fleet-container` con un contexto de apilamiento propio (`z-index` y `position: relative`), `#lens-views` se dibujaba directamente encima de la interfaz de la extensión, tapándola con una capa opaca.
* **Solución:** Se blindó `styles.css`:
  * Se forzó `.fleet-container` con `position: relative !important; z-index: 10 !important; width: 100% !important; height: 100vh !important;`.
  * Se inyectó la regla reactiva `.ClusterManager:has(.fleet-container) #lens-views { display: none !important; }`.

---

### Reto 10: Invariante del Slot 0 en `lens-hotbar-store.json`
* **Síntoma:** Al intentar anclar la extensión al Dock, el icono nativo del Catálogo de FreeLens dejaba de funcionar o desaparecía.
* **Causa:** FreeLens asume de manera rígida que `items[0]` de la Hotbar activa contiene `{ uid: "catalog-entity", name: "Catalog", source: "app" }`. Cuando la primera versión del servicio de anclaje escribió en el primer slot nulo o reordenó la lista sin proteger el índice 0, corrompió la referencia del Catálogo nativo.
* **Solución:** `HotbarService` (`src/main/hotbar-service.ts`) protege estrictamente el índice 0:
  * El escaneo de slots disponibles se ejecuta siempre a partir del índice 1 (`for (let i = 1; i < items.length; i++)`).
  * La desanclación nunca toca el índice 0; únicamente sustituye el slot de la extensión por `null` preservando exactamente 12 elementos en la lista.

---

### Reto 11: Despacho Dual de Parámetros en IPC (`(payload)` vs `(event, payload)`)
* **Síntoma:** Al invocar acciones de reinicio de pod o lectura de logs desde el renderer, el backend recibía `undefined` o arrojaba errores de desestructuración.
* **Causa:** En FreeLens, `extIpc.handle` de la extensión pasa el payload directamente en el primer argumento `(payload)`, mientras que `ipcMain.handle` nativo de Electron pasa `(event, payload)`. Al esperar `(_event, payload)`, el objeto de datos quedaba capturado erróneamente en `_event`.
* **Solución:** Se diseñó el helper `resolvePayload(a, b)` que inspecciona si `b` está definido o si `a` es un `IpcMainInvokeEvent` de Electron para extraer limpiamente el payload en ambos escenarios.

---

### Reto 12: Cambio de Firma a `ObjectParamAPI` en `@kubernetes/client-node` v1.x
* **Síntoma:** Al leer logs, la pantalla permanecía vacía o indicaba "El contenedor no ha generado logs aún", y al intentar reiniciar un pod saltaba el error: `Required parameter name was null or undefined when calling CoreV1Api.deleteNamespacedPod`.
* **Causa:** `@kubernetes/client-node` v1.x migró sus métodos de `CoreV1Api` a `ObjectParamAPI`. En lugar de aceptar argumentos posicionales (`deleteNamespacedPod(podName, namespace, ...)`), exige un objeto estructurado (`deleteNamespacedPod({ name, namespace, gracePeriodSeconds })`). Al pasar un string, `param.name` resultaba `undefined`, arrojando una excepción inmediata que `withTimeout` capturaba como fallback vacío.
* **Solución:** Se actualizaron todas las llamadas del colector (`readNamespacedPodLog`, `deleteNamespacedPod`, `readNamespacedPod`, `listNamespacedSecret`, `readNamespacedSecret`, etc.) para estructurar los argumentos mediante objetos.

---

### Reto 13: Tecla "ESC" y Backdrop Click para Cierre de Modales
* **Síntoma:** El usuario no podía cerrar el visor de logs, el manifiesto ni el modal de reinicio pulsando la tecla Escape o haciendo clic fuera de la ventana modal.
* **Causa:** Los componentes modales no registraban un listener de eventos de teclado en `window` ni detectaban clics en el backdrop contenedor.
* **Solución:** Se añadieron listeners reactivos con `useEffect` escuchando `keydown` (`e.key === "Escape"`) con cleanup automático y comprobación de `e.target === e.currentTarget` en el contenedor oscuro.

---

### Reto 14: Ordenamiento Multicriterio de Pods
* **Síntoma:** La tabla de pods no permitía clasificar por edad, errores o reinicios a voluntad del operador.
* **Causa:** Los pods se renderizaban en el orden de llegada secuencial del API Server.
* **Solución:** Se implementó en `PodsInspector.tsx` un sistema de ordenamiento dual: cabeceras interactivas `<th>` con alternancia de sentido (`▲`/`▼`) y un selector rápido en la toolbar con preajustes para Edad (más recientes/antiguos), Estado (errores primero), Reinicios (más inestables primero) y Nombre/Namespace/Clúster.

---

### Reto 15: Streaming Reactivo de Logs (`tail -f`) sin Parpadeo
* **Síntoma:** Al consultar logs de pods en tiempo real, recargar toda la consulta provocaba parpadeo en la pantalla y reiniciaba el scroll superior.
* **Causa:** El visor original requería pulsaciones manuales del botón de recarga y el modal ejecutaba un spinner de carga bloqueante en cada invocación.
* **Solución:** Se implementó un polling silencioso con intervalo de 2.2s en `PodLogsModal.tsx`, conmutable mediante el botón `[ ▶ En Vivo (tail -f) ]` / `[ ⏸ Pausar Stream ]`, con indicador pulsante verde 🟢, auto-scroll inteligente anclado al final y sin spinner en actualizaciones de fondo.

---

### Reto 16: Terminal Interactiva (`Pod Shell / Exec`) con Presets y Buffer Histórico
* **Síntoma:** Ejecutar comandos de diagnóstico en un pod requería abrir una terminal externa o cambiar al contexto nativo de FreeLens perdiendo la visión de flota.
* **Causa:** Falta de un canal IPC dedicado de ejecución remota de comandos sobre Kubernetes.
* **Solución:** Se implementó el canal `exec-pod-command` en backend mediante `k8s.Exec` y streams `PassThrough` en `k8s-collector.ts`, conectado a una terminal oscura `PodShellModal.tsx` en el frontend que provee presets instantáneos (`uname -a`, `df -h`, `env`, `ps aux`, `cat /etc/resolv.conf`, etc.), historial de comandos con flechas `↑`/`↓` y copia directa de resultados.

---

### Reto 17: Telemetría de Consumo de CPU y Memoria RAM vía `metrics.k8s.io`
* **Síntoma:** No existía visibilidad inmediata de si un clúster o sus nodos estaban saturados en recursos.
* **Causa:** La API estándar de `CoreV1Api` solo expone la capacidad asignable (`allocatable`), no el uso en tiempo de ejecución de pods y nodos.
* **Solución:** Se integró `CustomObjectsApi.listClusterCustomObject` consultando el grupo `metrics.k8s.io/v1beta1/nodes` con timeout estricto de 3.5s en `k8s-collector.ts`. Se desarrollaron parsers de unidades nano-cores (`n`), milli-cores (`m`), KiB, MiB y GiB. En `ClusterCard.tsx` se renderizan barras de progreso reactivas (verde <65%, amarillo 65-85%, rojo >85%) tanto agregadas para el clúster como desglosadas por nodo (`⚡42%`). Si `metrics-server` no está instalado en un clúster, el dashboard se degrada suavemente a `available: false` sin retrasos ni fallos.

---

### Reto 18: Saturación Visual por Botones Sueltos en Tabla de Pods
* **Síntoma:** En la tabla del inspector, tener 4 botones sueltos de colores (`Logs`, `Shell`, `Reiniciar`, `Manifiesto`) en cada fila generaba desorden visual y reducía el espacio horizontal para los mensajes de diagnóstico de Kubernetes.
* **Causa:** Diseño inicial con acciones fijas inline por cada fila.
* **Solución:** Se reemplazaron los 4 botones por un único botón limpio `⚡ Acciones ▾` y selección de fila con clic. Al pincharlo, se despliega un menú popover flotante anclado directamente sobre el pod que contiene todas las opciones organizadas jerárquicamente, con descarte automático al hacer clic fuera o pulsar la tecla `ESC`.

---

### Reto 19: Modales Bloqueantes vs Flujo Operativo Multitarea
* **Síntoma:** Abrir un modal de pantalla completa para consultar logs o ejecutar comandos en terminal impedía ver la tabla de pods o los gráficos de clústeres, y no permitía tener múltiples sesiones de diagnóstico abiertas simultáneamente.
* **Causa:** Uso exclusivo de modales fijos centrados en pantalla completa.
* **Solución:** Se creó `BottomConsolePanel.tsx`, una consola inferior multipestaña acoplada (tipo VS Code / IDE). Permite abrir tantas pestañas simultáneas como se requiera (logs, terminales shell, manifiestos) para diferentes pods y clústeres. Al cambiar de pestaña, el estado de las sesiones se mantiene intacto (`display: isTabActive ? "flex" : "none"`), y cuenta con controles para minimizar, maximizar a pantalla completa o cerrar pestañas.

---

### Reto 20: Logs en Vivo sin Parseo y Dificultad de Búsqueda
* **Síntoma:** El visor de logs requería activar el streaming manualmente, mostraba texto crudo en un bloque monótono donde era difícil distinguir errores de advertencias, y no destacaba los resultados de búsqueda.
* **Causa:** El visor inicial mostraba un `<pre>` plano con streaming desactivado por defecto.
* **Solución:** Se inicializó `isStreaming = true` por defecto (inicio inmediato en streaming `tail -f`). Se desarrolló un parser sintáctico que separa marcas de tiempo RFC3339/ISO en una columna fija azul cian (`#38bdf8`), detecta niveles de severidad (`ERROR`, `WARN`, `INFO`, `DEBUG`) con insignias cromáticas, parsea payloads JSON formateando sus propiedades y agrega resaltado visual con contador de coincidencias en la búsqueda.

---

### Reto 21: Solapamiento sobre el Dock de FreeLens y Pérdida de Sesiones al Cambiar de Clúster
* **Síntoma:** La consola inferior se dibujaba con `position: fixed; left: 0`, tapando los accesos directos de clústeres del Dock lateral de FreeLens. Además, al hacer clic en cualquier clúster anclado (`AAP`, `ACP`, etc.) y regresar al Fleet Dashboard, todas las sesiones de logs y terminal shell abiertas se destruían por el desmontaje del componente React.
* **Causa:** Estilos fijos al viewport global en lugar de estar contenidos en el flujo del plugin, y almacenamiento de pestañas en `useState` volátil local de `FleetDashboard`.
* **Solución:**
  1. Se rediseñó `.fleet-container` como un contenedor flex vertical (`display: flex; flex-direction: column; overflow: hidden;`), aislando el contenido en `.fleet-scrollable-content` y montando `BottomConsolePanel` como un hijo flex inferior (`position: relative; width: 100%`). Esto garantiza que la consola nunca solape ni tape el Dock lateral de FreeLens.
  2. Se agregó redimensionamiento por arrastre (`drag-to-resize`) en el borde superior de la consola.
  3. Se creó el singleton reactivo `ConsoleStore` (`src/renderer/stores/console-store.ts`) respaldado por `localStorage`. Preserva la lista de pestañas, el historial de comandos ejecutados de terminal y las trazas en streaming de logs, de modo que al navegar entre clústeres en FreeLens y volver, el usuario encuentra sus sesiones intactas.

---

### Reto 22: Rechazo Estricto de TLS en Node.js para MicroK8s / Certificados Autofirmados y Colisión de Kubeconfigs Multi-Perfil
* **Síntoma:** El clúster `Prod-BancoEstado` (MicroK8s en `https://192.168.14.12:16443`) conectaba en el dashboard con indicador verde de latencia (~80ms), pero mostraba 0 pods, 0 nodos y 0 servicios, mientras que `kubectl` por terminal devolvía 24 pods, 1 nodo y 26 servicios con normalidad.
* **Causa Raíz 1 (Validación TLS en Node.js vs Go/kubectl):** MicroK8s genera CAs internas y certificados autofirmados. `kubectl` (compilado en Go) tolera estas conexiones reconociendo la CA del contexto sin problemas. En cambio, `@kubernetes/client-node` corre sobre el stack TLS nativo de Node.js, el cual rechaza estrictamente certificados no reconocidos por la lista CA del sistema con el error `Error: unable to verify the first certificate`. Al envolver las llamadas en `Promise.allSettled`, todas las consultas a la API (`listNode`, `listPodForAllNamespaces`, `listServiceForAllNamespaces`) fallaban silenciosamente por rechazo de certificado, extrayendo arreglos vacíos (`[]`).
* **Causa Raíz 2 (Colisión de IDs y Sobreescritura en Storage Físico):** Al agregar el archivo `bastian.alveal-kubeconfig.yaml` tanto al perfil *Preprod* como a *Prod*, la función `generateClusterId` generaba el mismo hash de ID (`bastian-alveal-kubeconfi-2y67q`). Al guardarse en disco, el archivo de Preproducción (`https://192.168.14.10:16443`, inalcanzable desde la red actual) sobreescribió al archivo de Producción (`192.168.14.12`). Además, `getKubeConfigForCluster` leía primero `found.path` en lugar de priorizar `found.yamlContent`.
* **Solución:**
  1. **Motor Automático `applyTlsFallback(kc)` & Auto-Recovery (`k8s-collector.ts`):** Detecta automáticamente clústeres en rangos privados (`192.168.*`, `10.*`, `172.16-31.*`, `127.*`, `localhost` o puertos MicroK8s `:16443` y `:6443`) y activa de forma transparente `skipTLSVerify = true`. Además, ante cualquier rechazo de certificado en tiempo de ejecución (`CERT_`, `unable to verify`, etc.), activa dinámicamente el bypass y reintenta la consulta sin botar el dashboard.
  2. **Hash Único por Contenido YAML (`FleetDashboard.tsx`):** Se modificó `generateClusterId(filePath, name, yamlContent)` para incorporar los primeros 150 caracteres del contenido YAML en la semilla del hash, impidiendo colisiones entre ambientes distintos que compartan el mismo nombre de archivo.
  3. **Prioridad Absoluta a `yamlContent` y Búsqueda por Perfil Activo (`k8s-collector.ts`):** `getKubeConfigForCluster` busca primero en el perfil activo y prioriza `kc.loadFromString(found.yamlContent)` antes de recurrir a rutas de archivos en disco.
  4. **Separación de Almacenamiento en `profiles.json`:** Se aislaron explícitamente los kubeconfigs de Producción (`prod-bancoestado-192-168-14-12`) y Preproducción (`preprod-bancoestado-192-168-14-10`).

---

### Reto 23: Depuración Arquitectónica (Eliminación de Secrets & Configs y Topología)
* **Motivación:** Las vistas de *Secrets & Configs* e inspección de *Topología/Blast Radius* no aportaban valor al flujo operativo del usuario y añadían más de 1,200 líneas de código y 7 canales IPC innecesarios.
* **Solución:**
  1. Se eliminaron los componentes `SecretsInspector.tsx` y `TopologyGraphView.tsx`.
  2. Se depuraron 7 canales IPC en `src/main/index.ts` (`list-secrets`, `get-secret-detail`, `list-configmaps`, `get-configmap-detail`, `get-topology-graph`, `save-topology-link`, `delete-topology-link`).
  3. Se aligeró `src/main/k8s-collector.ts` removiendo consultas pesadas a secrets y configmaps.
  4. Se limpiaron tipos en `src/common/types.ts` y animaciones CSS no utilizadas en `src/renderer/styles.css`.
  5. El bundle final del renderer se redujo a 141 KiB.

---

### Reto 24: Sistema de Alarmas y Alertas en Tiempo Real por Reinicio de Pods
* **Síntoma / Requerimiento:** Necesidad de ser notificado de inmediato cuando un pod se reinicia o muere en la flota, sin tener que revisar manualmente las tablas.
* **Causa:** El dashboard actualizaba la telemetría periódicamente pero no comparaba los contadores históricos de reinicios ni emitía señales activas de advertencia.
* **Solución:**
  1. **Motor de Detección en Segundo Plano (`FleetDashboard.tsx`):** Se implementó una referencia reactiva `previousPodsRef` que mapea cada pod (`${clusterId}:${namespace}:${podName}`) guardando su `restarts`, `phase` y `reason`.
  2. **Supresión de Falsos Positivos Iniciales:** Durante la primera carga (`isInitialTelemetryRef`), el sistema memoriza el estado base sin disparar alarmas por reinicios antiguos de días pasados.
  3. **Toast Flotante Estructurado (`AlarmNotifications.tsx`):** Al detectar `restarts > restartsPrevios`, despliega un toast interactivo en la esquina superior derecha con borde rojo pulsante, mostrando clúster, namespace, pod, delta (`2 ➔ 3 (+1)`), causa y hora, con enlaces directos a logs en vivo y diagnóstico.
  4. **Chime de Audio Local y Notificaciones de Escritorio:**
     * Síntesis sonora inmediata mediante la Web Audio API nativa (`AudioContext`, onda seno/triángulo dual-tone E5->A5), sin dependencias ni archivos de audio externos.
     * Integración con la API nativa `Notification` de Electron/macOS para emitir alertas al Centro de Notificaciones incluso con la app minimizada.
  5. **Centro de Alarmas en Cabecera (`🔔 Alarmas`):** Botón con badge animado en la cabecera superior y barra de pestañas, con panel lateral desplegable para revisar el historial completo de la sesión, silenciar/activar el sonido y simular alertas de prueba (`[ 🧪 Probar Alarma ]`).

---

## 3. Reglas de Oro para Futuros Modelos de IA

Si estás editando o expandiendo esta extensión, **DEBES respetar estrictamente las siguientes directrices**:

1. **NUNCA elimines los Timeouts de Red:**
   * Cualquier llamada hacia `@kubernetes/client-node` DEBE tener un límite máximo de tiempo (`Promise.race` / `withTimeout`). De lo contrario, un clúster caído congelará toda la flota del usuario.
2. **Preserva la Doble Invocación IPC:**
   * Tanto el registro como la invocación de IPC deben soportar `extIpc` (vía `@freelensapp/extensions`) y el fallback nativo de `electron.ipcRenderer`.
3. **Mantén la Persistencia en Disco:**
   * No regreses a almacenar datos exclusivamente en `localStorage`. Las altas, bajas y modificaciones de clústeres deben sincronizarse con `~/.freelens/fleet-storage/profiles.json`.
4. **Respeta los Externals de Webpack:**
   * No cambies `externals` en `webpack.config.js` a módulos comunes (`commonjs`) para `@freelensapp/extensions`, o la extensión crasheará al iniciar FreeLens.
5. **Normalización de Nombres de Pods:**
   * Al comparar réplicas en `DriftInspector`, utiliza siempre la función `getWorkloadName` para evitar que los hashes efímeros de Kubernetes rompan la correspondencia entre clústeres.
6. **Invariante del Slot 0 en la Hotbar:**
   * NUNCA sobreescribas ni elimines `items[0]` en `lens-hotbar-store.json`. Ese índice está reservado para `catalog-entity`. Cualquier anclaje de extensión debe realizarse entre los índices 1 y 11.
7. **IDs de Rutas Únicos (`globalPages` vs `clusterPages`):**
   * NUNCA utilices el mismo `id` para una página global y una de clúster. La colisión de claves en el contenedor DI de FreeLens romperá la navegación fuera de un clúster.
8. **Blindaje de Capas CSS en Vistas Standalone (`#lens-views`):**
   * Cualquier página global que viva fuera de un iframe de clúster debe neutralizar `#lens-views` (con `display: none !important`) y aplicar `z-index: 10` y `position: relative` a su contenedor raíz para no quedar oculta tras el fondo del gestor de clústeres.
9. **Detección de Reinicios de Pods sin Falsos Positivos:**
   * Al recopilar telemetría, SIEMPRE utiliza `isInitialTelemetryRef` para registrar la línea base de la flota. Solo dispara alarmas (`PodRestartAlarm`) cuando el `restartCount` supere estrictamente el valor previo registrado durante la sesión viva.
10. **Audio y Notificaciones 100% Locales (Zero External Assets):**
    * Las alertas sonoras deben sintetizarse exclusivamente mediante `AudioContext` de la Web Audio API nativa. NUNCA introduzcas dependencias de archivos `.mp3` / `.wav` locales o remotos que puedan fallar en entornos sandbox o sin internet.
11. **Auto-Detección y Fallback TLS para Clústeres Locales / MicroK8s:**
    * En clústeres locales, on-premise o MicroK8s (`192.168.*`, `10.*`, `172.16-31.*`, `:16443`, `:6443`), Node.js rechaza CAs autofirmadas por defecto. SIEMPRE aplica `applyTlsFallback(kc)` y auto-recuperación ante errores de verificación de certificados antes de invocar APIs de Kubernetes para evitar que el dashboard muestre 0 pods silenciosamente.

---

## 4. Flujo de Trabajo para Compilar y Desplegar Cambios

Cada vez que realices cambios en el código TypeScript o CSS:

```bash
# 1. Posicionarse en el directorio
cd /Users/bastianalveallampe/Desktop/Padsystem/kubeconfigs/K8S-IC/freelens-fleet-dashboard

# 2. Compilar
npm run build

# 3. Copiar al directorio activo de FreeLens
cp -r out package.json ~/.freelens/extensions/freelens-fleet-dashboard/

# 4. Empaquetar tarball
npm run pack

# 5. Reiniciar FreeLens para cargar el nuevo bundle
osascript -e 'quit app "Freelens"' && sleep 1.5 && open -a Freelens
```
