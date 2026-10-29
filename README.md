# ⚡ FreeLens Fleet Dashboard & Multi-Cluster Drift Inspector

> **Extensión oficial de observabilidad multiclúster y control de deriva para FreeLens** (el fork de código abierto e independiente de OpenLens).

[![FreeLens Version](https://img.shields.io/badge/FreeLens-1.10.x+-blue.svg)](https://github.com/freelensapp/freelens)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.24%20--%201.30+-326ce5.svg)](https://kubernetes.io/)
[![Zero-AI](https://img.shields.io/badge/Algorítmico-100%25%20Local%20%26%20Privado-success.svg)]()
[![License](https://img.shields.io/badge/License-MIT-green.svg)]()

---

## 🎯 Propósito del Proyecto

Por diseño nativo, **FreeLens** aísla cada clúster de Kubernetes en una pestaña o ventana independiente. En operaciones reales de DevOps y SRE con múltiples entornos (ej. *Producción*, *Staging*, *Infraestructura Core*, *MicroK8s*, *AKS*, *EKS*), responder preguntas operativas básicas solía requerir saltar entre pestañas y memorizar estados:
* *¿Hay algún pod caído o en `CrashLoopBackOff` en cualquiera de los clústeres de producción?*
* *¿Qué microservicio está desplegado en Staging pero olvidaron desplegar en Producción?*
* *¿Hay servicios huérfanos sin endpoints en algún ambiente?*
* *¿Existe disparidad de versiones de Kubernetes o desbalance de réplicas entre clústeres?*

**FreeLens Fleet Dashboard** resuelve esto agregando una **Categoría de Catálogo de Primer Nivel** y un panel centralizado que unifica la telemetría viva de todos tus entornos en una única pantalla de alta velocidad, con persistencia total en disco y detección profunda de deriva (drift).

---

## 🚀 Funcionalidades Principales

### 1. ⚡ Supervisión Centralizada de Flota (Single Pane of Glass)
* **Visualización en Cuadrícula Adaptable:** Selector de diseño con `Auto`, `2`, `3` o `4` columnas en paralelo, con scroll vertical fluido e infinito optimizado para macOS y monitores ultra-wide.
* **Telemetría Viva por Clúster:**
  * **Pods:** Desglose en vivo de pods 🟢 **Vivos**, 🔴 **Muertos / Fallo** y 🟡 **En Transición**.
  * **Servicios de Red:** Balance de `ClusterIP`, `NodePort` y `LoadBalancer`, con alerta automática de **Servicios Huérfanos** (servicios sin endpoints activos).
  * **Nodos y Capacidades:** Estado del Kubelet (`Ready`, `DiskPressure`, `MemoryPressure`), roles (`control-plane` vs `worker`) y cores de CPU asignados.
  * **Control Plane:** Versión exacta de Kubernetes y latencia de red al API Server en milisegundos (`45ms`, `700ms`).

### 2. 📁 Sistema de Perfiles y Persistencia en Disco Físico
* **Persistencia Real:** Se elimina la dependencia del `localStorage` volátil de Electron. Toda la flota se guarda en `~/.freelens/fleet-storage/profiles.json`.
* **Guardado Automático de YAMLs:** Si arrastras o subes archivos Kubeconfig temporales, el backend los guarda permanentemente en `~/.freelens/fleet-storage/kubeconfigs/<id>.yaml`.
* **Perfiles Personalizados:** Selector de perfiles en la cabecera (ej. *"Producción"*, *"Staging"*, *"DevOps"*). Puedes cambiar de ambiente en un clic sin perder configuraciones ni tener que re-asociar archivos.

### 3. ✏️ Alias Amigables y Dinamismo de Escaneo
* **Renombrado In Situ:** Haz clic en el lápiz `✏️` o en el título de cualquier clúster para asignarle un alias legible (ej. *"Aks-Prod-Core"*, *"DataOps"*) en lugar de largos nombres de contextos de archivo (`config-parques-prod-core`).
* **Control de Escaneo Rápido (`⚡ Activo` / `⏸️ Pausado`):** Haz clic sobre cualquier chip de clúster para excluirlo temporalmente del escaneo. Las consultas solo tocan los clústeres activos, haciendo que la sincronización sea instantánea.

### 4. ⏱️ Auto-Refresco en Tiempo Real (Live Poller)
* **Monitoreo Continuo:** Selector de refresco automático: **`Pausado`**, **`Cada 15s`**, **`Cada 30s`**, **`Cada 1 min`**, **`Cada 2 min`**.
* **Actualización Silenciosa:** Se ejecuta en segundo plano sin bloquear la interfaz ni congelar la pantalla. Si un pod se cae, el contador se torna rojo y la pestaña de diagnóstico se ilumina de inmediato.

### 5. 🔍 Inspector de Pods y Diagnóstico Unificado (Deep Links & Acciones Limpias)
* **Navegación con Enlaces Directos:** Al hacer clic en los números de `🟢 Vivos`, `🔴 Muertos` o `🟡 Otros` (tanto en las tarjetas como en los banners superiores), el dashboard te lleva automáticamente al inspector con ese clúster y ese estado preseleccionados.
* **Filtro Integral:**
  * Selector de clúster (*Todos* o específico).
  * Pestañas de estado con contadores en vivo: `Todos`, `🟢 Vivos`, `🔴 Muertos / Fallo`, `🟡 En Transición`.
  * Buscador en tiempo real por nombre de pod, namespace o causa de fallo.
* **Interfaz Limpia sin Ruido Visual (Contextual Action Popover):**
  * Se eliminan los botones sueltos de colores por fila. Cada pod cuenta con un único gatillo limpio `⚡ Acciones ▾` y selección de fila con clic.
  * Al seleccionar cualquier pod, se despliega un **menú popover flotante anclado directamente sobre el pod** con acceso instantáneo a todas sus herramientas: `Logs (En Vivo)`, `Terminal Shell (Exec)`, `Estructura del Manifiesto` y `Reiniciar / Eliminar Pod`.
  * Se cierra limpiamente con un clic fuera o pulsando la tecla `ESC`.
* **Columnas Enriquecidas:** Clúster, Namespace, Pod (mono), Contenedores listos (`1/1`, `2/2`), Estado/Fase, Reinicios (alerta >5), Edad (`2h`, `4d`), y Mensaje detallado del error de Kubernetes.

### 6. ⚖️ Comparador Avanzado de Deriva (Drift Inspector)
* **Workload Parity Matrix (Matriz de Paridad de Microservicios):**
  * Normaliza algorítmicamente los nombres de pods eliminando los hashes aleatorios de ReplicaSets (`-[a-z0-9]{8,10}-[a-z0-9]{5}$`).
  * Compara réplicas de microservicios lado a lado entre Clúster A y Clúster B.
  * Detecta:
    * `✓ Idéntico`: Misma cantidad de réplicas en ambos.
    * `⚠️ Desbalance`: Diferencia de réplicas (ej. 2 en A vs 1 en B).
    * `🔴 Solo en Clúster A`: Microservicio que está en A pero que **falta en B**.
    * `🔴 Solo en Clúster B`: Microservicio que está en B pero que **falta en A**.
* **Deriva de Infraestructura:** Comparación de versiones K8s, Cores de CPU, Nodos y Servicios de red.
* **Deriva de Namespaces:** Matriz de namespaces exclusivos vs compartidos.
* **📋 Copiar Reporte:** Botón de un solo clic que genera un informe estructurado en Markdown para pegar en Slack, Teams o Jira.

### 7. 📌 Anclaje a Accesos Directos (Hotbar Dock)
* **Acceso en 1 Clic desde el Dock Lateral:** Igual que tus conexiones de clústeres, ahora puedes anclar el Fleet Dashboard directamente en la barra vertical izquierda de FreeLens (Hotbar).
* **Vista Dedicada a Pantalla Completa:** Al hacer clic en el acceso directo del Dock, FreeLens despliega el Fleet Dashboard directamente en el área principal a pantalla completa, como una vista independiente, sin depender ni navegar por el árbol de categorías del Catálogo.
* **Botón Interactivo en la Cabecera:** Control instantáneo `[ 📌 Anclar al Dock ]` / `[ 📌 Anclado en Dock ]` en la barra superior para alternar el anclaje sin tener que tocar manualmente archivos JSON.
* **Persistencia Atómica en FreeLens:** Se sincroniza con el archivo `lens-hotbar-store.json` de FreeLens garantizando que el Catálogo nativo se mantenga intacto en el Slot 0 y el Fleet Dashboard ocupe el Slot 1 (o siguientes disponibles).

### 8. 🗂️ Consola Inferior Multipestaña Acoplada (Bottom Console Workbench)
* **Espacio de Trabajo Multipestaña 100% Integrado:** En lugar de modales que bloquean toda la pantalla o barras fijas que tapan el dock de FreeLens, las terminales Shell, visores de logs y manifiestos viven estrictamente dentro del contenedor del plugin mediante un diseño flex vertical.
* **Cero Invasión al Dock Lateral:** La consola se dibuja exclusivamente a la derecha de la barra de clústeres de FreeLens, manteniendo tus iconos de clústeres anclados siempre accesibles e intactos.
* **Redimensionable por Arrastre (Drag-to-Resize):** Pasa el ratón por el borde superior de la consola para ajustar su altura con total libertad (desde 160px hasta 800px).
* **Múltiples Pestañas en Paralelo:** Abre simultáneamente tantas pestañas como desees para diferentes pods o clústeres (ej. logs de un microservicio en la Pestaña 1 y terminal shell en la Pestaña 2).
* **Persistencia Total ante Cambio de Clúster (`ConsoleStore`):** Si sales del Fleet Dashboard para revisar un clúster anclado en el Dock de FreeLens (`AAP`, `ACP`, etc.) y luego regresas, **ninguna sesión se pierde**. Todas las pestañas abiertas, el historial de comandos de terminal y las trazas de logs se restauran de forma instantánea.
* **Controles de Ventana Flexibles:**
  * `▼ Minimizar` / `▲ Expandir`: Oculta el panel a una franja de 38px para concentrarse en la tabla o tarjetas de clústeres sin perder las sesiones activas.
  * `🗖 Agrandar` / `🗗 Reducir`: Maximiza la consola para examinar trazas extensas o ejecutar comandos largos.
  * `[ 💻 Consola Activa (N) ]`: Acceso directo en la barra superior de navegación para desplegar y enfocar la consola desde cualquier pestaña.
  * Cierre individual `✕` o `✕ Cerrar todo` con un solo clic.

### 9. 📄 Logs en Vivo Parseados y Estructurados (`tail -f` por Defecto)
* **Streaming Reactivo Activo por Defecto:** Al abrir los logs de cualquier pod, inicia inmediatamente en modo streaming continuo (`tail -f`) con indicador verde pulsante 🟢 sincronizando cada 2.2 segundos.
* **Diseño Parseado y Estructurado:**
  * **Columna de Timestamps:** Extracción visual limpia de marcas de tiempo RFC3339 / ISO en azul cian monospace (`#38bdf8`).
  * **Insignias de Nivel de Severidad:** Detección automática de niveles (`ERROR` en rojo, `WARN` en amarillo, `INFO` en verde, `DEBUG` en violeta).
  * **Formateo de JSON:** Reconocimiento de logs estructurados en JSON, renderizando atributos clave como badges legibles.
  * **Conmutador de Vista:** Alterna entre `Vista Estructurada` y `Texto Plano (Raw)` según la preferencia del operador.
* **Buscador en Tiempo Real con Resaltado y Contador:** Filtra instantáneamente líneas coincidentes y destaca los términos buscados indicando el número exacto de coincidencias encontradas.
* **Selector Multicontenedor e Histórico Prev:**
  * Selector de contenedor para pods con init-containers o sidecars.
  * Checkbox `Logs de instancia previa (--previous)`: vital para diagnosticar causas de muerte en pods con `CrashLoopBackOff` u `OOMKilled`.
* **Reiniciar Pods con 1 Clic (`🔄`):** Botón de reinicio rápido que elimina el pod de forma controlada para que Kubernetes lo vuelva a levantar. Incluye modal de confirmación de seguridad para evitar errores accidentales en producción.
* **Inspección de Manifiestos (`📋 YAML/JSON`):** Visor con desglose de metadatos, IPs, nodeName, QoS Class, contenedores, puertos y variables de entorno, además de exportación completa en JSON.

### 10. 💻 Terminal Interactiva Integrada (`Pod Shell / Exec`)
* **Ejecución de Comandos sin Salir del Dashboard:** Botón `[ >_ Shell ]` en cada pod del inspector para abrir una terminal oscura interactiva con streaming de `stdout` y `stderr`.
* **Presets de Diagnóstico Rápido:** Ejecuta con 1 clic comandos habituales de diagnóstico:
  * `uname -a` (Kernel y arquitectura)
  * `env` (Variables de entorno inyectadas)
  * `df -h` (Espacio en volúmenes y discos)
  * `ps aux` (Procesos en ejecución)
  * `cat /etc/resolv.conf` (Configuración DNS del pod)
  * `netstat -tuln` (Puertos abiertos y sockets en escucha)
  * `cat /proc/meminfo` (Memoria real disponible en el cgroup)
* **Prompt Interactivo y Buffer Histórico:** Navegación por el historial de comandos con las flechas `↑` y `↓`, soporte multilínea, salida coloreada según código de salida (0 verde, distinto de 0 rojo) y copia de salida al portapapeles.

### 11. 📊 Métricas de Consumo Real en Vivo (CPU & Memoria vía Metrics Server)
* **Barras de Consumo en Tiempo Real:** Visualización gráfica de la carga acumulada del clúster con porcentajes exactos de CPU y Memoria RAM comparados contra la capacidad total asignable (`allocatable`).
* **Indicadores Cromáticos de Saturación:**
  * 🟢 Verde: Consumo normal (<65%).
  * 🟡 Amarillo: Carga moderada (65% - 85%).
  * 🔴 Rojo: Saturación crítica (>85%).
* **Telemetría por Nodo Individual:** Cada nodo muestra su porcentaje de CPU en tiempo real (`⚡42%`) con tooltip de memoria en uso.
* **Resiliencia Extrema y Zero-Lock:** Consulta no bloqueante a `metrics.k8s.io` con timeout estricto de 3.5 segundos. Si un clúster no tiene instalado `metrics-server`, el dashboard continúa funcionando fluidamente sin advertencias ni retrasos.

### 12. 🚨 Sistema de Alarmas y Alertas en Tiempo Real por Reinicio de Pods
* **Detección Algorítmica de Deltas de Reinicio:** El colector compara el `restartCount` de cada contenedor entre ciclos de refresco. Si detecta un nuevo reinicio (`restarts > restartsPrevios`) o si el pod transiciona a `CrashLoopBackOff` u `OOMKilled`, dispara de inmediato la alerta. Cero falsos positivos en el primer arranque (memoriza el estado base).
* **Toast Flotante Estructurado:** Banner interactivo en la esquina superior derecha con borde rojo pulsante (`@keyframes alarmPulse`) y datos clave:
  * Clúster y alias.
  * Namespace y nombre del pod (monospace).
  * Delta de reinicios resaltado (`2 ➔ 3 (+1)`).
  * Motivo exacto del fallo y hora del incidente.
  * Botones rápidos: **`[ 📄 Ver Logs en Vivo ]`** (despliega streaming `tail -f` en la consola inferior) y **`[ 🔍 Diagnosticar ]`** (filtra directamente el pod en el inspector).
* **Centro de Alarmas e Historial (`🔔 Alarmas`):** Botón accesible en la cabecera superior y barra de pestañas con contador dinámico y panel lateral desplegable para revisar o limpiar todos los incidentes ocurridos durante la sesión.
* **Alertas Sonoras Locales (Web Audio API):** Campanilla / chime sintetizada en tiempo real mediante `AudioContext` en el navegador (100% offline, cero archivos de audio externos), con botón para silenciar o activar el sonido (`🔊` / `🔇`).
* **Notificaciones de Escritorio macOS / Electron:** Emisión al Centro de Notificaciones nativo de macOS para alertar al operador incluso si FreeLens se encuentra minimizado o en segundo plano.
* **Botón de Prueba Integrado (`[ 🧪 Probar Alarma ]`):** Permite simular una alerta instantánea para validar audio, formato visual y notificaciones de escritorio en un solo clic.

### 13. 🔀 Ordenamiento Dinámico Multicriterio de Pods
* **Cabeceras Interactivas (`<th>`):** Haz clic en las columnas de **Clúster**, **Namespace**, **Nombre del Pod**, **Estado / Fase**, **Reinicios** y **Edad** para alternar orden ascendente (`▲`) y descendente (`▼`).
* **Selector Rápido "Ordenar":** Menú desplegable integrado en la barra de herramientas para ordenar instantáneamente por:
  * 🕒 Más recientes primero (Edad - predeterminado).
  * ⏳ Más antiguos primero (Edad).
  * 🔴 Fallos y errores primero (prioriza `CrashLoopBackOff`, `OOMKilled`, `ImagePullBackOff`).
  * 🟢 Vivos y saludables primero.
  * 🔄 Más reinicios primero (para detectar pods inestables rápidamente).
  * 🔤 Nombre / Namespace / Clúster (A → Z y Z → A).

### 14. ⚡ Optimizaciones de Alto Rendimiento (Cache y Paginación Virtual)
* **Caché en Memoria con TTL (8s):** Las consultas repetitivas entre pestañas o clústeres no vuelven a saturar el API Server; se resuelven instantáneamente en <5ms desde el proceso Main de Electron.
* **Paginación Inteligente:** Selector de 25, 50 o 100 pods por página en el inspector con controles de navegación, garantizando renderizado a 60fps sin lag incluso en flotas con más de 1,000 pods.
* **Timeouts Estrictos (3.5s - 5s):** Cada clúster corre bajo un temporizador aislado con `Promise.allSettled`. Si un clúster está apagado, sin VPN o con credenciales expiradas, se cancela a los 5 segundos y se marca como inaccesible sin congelar jamás a los demás clústeres.

### 15. 🛡️ Soporte Universal MicroK8s & On-Premise con TLS Fallback Automático
* **Cero Problemas con Certificados Autofirmados:** Conexión nativa e inmediata con clústeres MicroK8s, Minikube, k3s o clústeres empresariales privados sin necesidad de flags manuales como `--insecure-skip-tls-verify`.
* **Detección Automática de Redes Privadas:** El colector identifica automáticamente rangos RFC 1918 (`192.168.*`, `10.*`, `172.16-31.*`, `localhost` y puertos `:16443` / `:6443`) y aplica de forma segura `skipTLSVerify` para evitar rechazos del motor TLS estricto de Node.js.
* **Auto-Recuperación Silenciosa:** Si una llamada al API Server es rechazada por certificado autofirmado, el sistema conmuta dinámicamente al modo bypass y reintenta de inmediato la recolección, garantizando que el dashboard presente siempre los pods, servicios y métricas reales.
* **Aislamiento Multi-Perfil a Nivel de Contenido:** Hash de clústeres basado en el contenido real del YAML, impidiendo sobreescrituras accidentales entre entornos que compartan el mismo nombre de archivo (ej. `bastian.alveal-kubeconfig.yaml` en Producción vs Preproducción).

---

## 🏛️ Estructura del Repositorio

```text
freelens-fleet-dashboard/
├── README.md                      # Documentación general de usuario y producto
├── ARCHITECTURE.md               # Especificación técnica interna, IPC y ciclo de vida
├── CONTEXT.md                    # Historial de decisiones, bugs resueltos y guía para IAs
├── package.json                  # Dependencias y scripts de compilación (v0.5.0)
├── tsconfig.json                 # Configuración de TypeScript
├── webpack.config.js             # Empaquetador dual (Node Electron Main + React Renderer)
├── src/
│   ├── common/
│   │   ├── category.ts           # Definición de la CatalogCategory de FreeLens
│   │   └── types.ts              # Modelos tipados (ClusterSummary, PodDetail, ClusterDrift, etc.)
│   ├── main/
│   │   ├── index.ts              # Proceso Main de Electron, 16 handlers IPC con resolvePayload
│   │   ├── hotbar-service.ts     # Servicio atómico de anclaje en el Dock de FreeLens
│   │   ├── fleet-store.ts        # Capa de persistencia en disco (~/.freelens/fleet-storage/)
│   │   └── k8s-collector.ts      # Colector K8s paralelo con metrics-server, exec shell y logs
│   └── renderer/
│       ├── index.tsx             # Proceso Renderer, integración con catálogo y globalPages
│       ├── styles.css            # Estilos oscuros adaptados al tema de FreeLens
│       ├── stores/
│       │   └── console-store.ts  # Almacén reactivo de sesiones multipestaña y persistencia en disco
│       └── components/
│           ├── FleetDashboard.tsx     # Contenedor raíz, perfiles, poller y métricas
│           ├── AlarmNotifications.tsx # Sistema de alarmas, toasts flotantes, audio sintetizado y drawer
│           ├── BottomConsolePanel.tsx # Consola inferior multipestaña acoplada para logs/shell/manifiestos
│           ├── ClusterCard.tsx        # Tarjeta con barras de CPU/RAM, toolbar interna y deep links
│           ├── PodsInspector.tsx      # Inspector de pods, popover contextual de acciones y ordenamiento
│           ├── PodLogsModal.tsx       # Logs con streaming por defecto, parseo estructurado y búsqueda
│           ├── PodShellModal.tsx      # Terminal interactiva de Pod Exec con presets y buffer
│           ├── PodManifestModal.tsx   # Visor estructurado y JSON/YAML de pods con ESC
│           └── DriftInspector.tsx     # Comparador de deriva y matriz de paridad de microservicios
```

---

## 🛠️ Compilación, Empaquetado e Instalación

### Requisitos Previos
* **Node.js:** v18.0.0 o superior (recomendado v20+ o v24).
* **npm:** v9.0.0 o superior.
* **FreeLens:** v1.10.x o superior instalada.

### Comandos de Construcción

```bash
# 1. Instalar dependencias
cd freelens-fleet-dashboard
npm install

# 2. Compilar bundles de producción (out/main y out/renderer)
npm run build

# 3. Generar el archivo empaquetado para distribución
npm run pack
```

### Instalación Directa en FreeLens (macOS / Linux / Windows)

Para desplegar la extensión directamente en tu instalación local de FreeLens:

```bash
# Copiar el build compilado y el package.json al directorio de extensiones de FreeLens
mkdir -p ~/.freelens/extensions/freelens-fleet-dashboard
cp -r out package.json ~/.freelens/extensions/freelens-fleet-dashboard/

# En macOS, reiniciar FreeLens limpiamente
osascript -e 'quit app "Freelens"' && sleep 1.5 && open -a Freelens
```

---

## 🔒 Privacidad y Seguridad (Zero-AI / 100% Local)

* **Cero APIs Externas:** No requiere tokens de OpenAI, Anthropic, Google Cloud ni telemetría externa.
* **Sin Tráfico Saliente:** Todas las consultas se dirigen exclusivamente desde tu máquina a los API Servers de los clústeres definidos en tus kubeconfigs.
* **Tus Kubeconfigs Están Seguros:** Los certificados, tokens y llaves privadas nunca se envían a servidores de terceros ni se registran en logs públicos.

---

## 👥 Créditos y Mantenimiento

* **Autor / Operador:** Bastian Alveal Lampe (DevOps / SRE).
* **Desarrollado con:** Antigravity (Advanced Agentic AI Assistant de Google DeepMind).
* **Licencia:** MIT.



agy --conversation=6505a85f-7ea4-439c-a141-d9d648658975