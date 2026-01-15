# Checklist de Smoke Manual (15–25 min)

Objetivo: validar rápido que **lo crítico** del aplicativo funciona end-to-end (UI + API + BD) sin tener que recorrer cada pantalla en profundidad.

Sugerencia: hazlo con 2 roles mínimo:
- **Planner** (planificador)
- **Operator** (operario)
- (Opcional) **Admin** para configuración/usuarios

> Nota: Este checklist NO reemplaza pruebas automáticas; sirve como “sanity check” visual y de flujo.

---

## 0) Preparación (1–2 min)
- Abre la app y confirma que carga sin errores visibles.
- Si tienes consola del navegador abierta: no debería haber errores rojos repetitivos.
- Ten a mano 1 máquina y 1 molde con al menos 1 parte (si no existen, créalos en el paso de Catálogo).

---

## 1) Autenticación y roles (2–3 min)
1. Inicia sesión como **Planner**.
   - Esperado: login exitoso, acceso a módulos de planificación.
2. Cierra sesión.
3. Inicia sesión como **Operator**.
   - Esperado: login exitoso y permisos restringidos (no debería permitir acciones de planner si aplica).
4. (Opcional) Intenta entrar directo a una URL de planner (si tu UI tiene rutas directas).
   - Esperado: redirección / bloqueo si no corresponde.

---

## 2) Catálogo (máquinas, moldes, partes) (3–5 min)
1. Como **Planner** o **Admin**, entra a **Máquinas**.
   - Crea una máquina de prueba (ej: `smoke_machine_YYYYMMDD`).
   - Esperado: se crea y aparece en listados.
2. Entra a **Moldes**.
   - Crea un molde de prueba (ej: `smoke_mold_YYYYMMDD`).
   - Esperado: se crea y aparece.
3. Dentro del molde, crea al menos **1 parte** (ej: `smoke_part_1`).
   - Esperado: la parte aparece asociada al molde.

---

## 3) Planificador (bloque normal) (3–5 min)
1. Planifica un bloque normal (no PRIORITY) para **mañana** o un día futuro laborable.
   - 1 molde, 1 parte, 1 máquina, 2–4 horas.
   - Esperado: confirmación de guardado; el bloque queda en la grilla/lista.
2. Edita o elimina ese bloque (si la UI lo permite).
   - Esperado: cambios reflejados sin errores.

---

## 4) PRIORITY (flujo clave) (4–6 min)
1. Crea un PRIORITY para una fecha futura laborable:
   - Preferible: 2 tareas (misma fecha), en 2 máquinas distintas, 4h cada una.
   - Esperado: respuesta exitosa, se “reanuda” lo existente después del PRIORITY.
2. Verifica que los trabajos existentes “se corrieron” (si había algo planificado en esas máquinas desde esa fecha).
   - Esperado: lo PRIORITY queda primero; lo previo no desaparece, se reubica.

---

## 5) Calendario (2–3 min)
1. Abre el calendario en el mes de la fecha usada.
   - Esperado: el día muestra las tareas; si hay PRIORITY, debería verse marcado/identificable.
2. Verifica el día siguiente laborable:
   - Esperado: aparecen tareas reprogramadas (si había existentes afectadas).

---

## 6) Registro de trabajo (Work Logs) (3–5 min)
1. Como **Operator**, crea un registro (work log) contra una tarea/parte/molde (según tu UI):
   - horas, comentario, fecha.
   - Esperado: se guarda y aparece en listados.
2. Intenta editar/eliminar un registro:
   - Esperado: respeta permisos (operator puede o no puede, según regla).

---

## 7) Datos / CRUD operativos (2–4 min)
Dependiendo de lo que maneje “Datos” en tu app:
- Crea 1 registro representativo.
- Edita 1 campo.
- Elimina (si aplica) o marca como inactivo.

Esperado: validaciones (400) cuando faltan campos y persistencia correcta cuando está OK.

---

## 8) Importación (si es clave) (2–4 min)
1. Usa un archivo pequeño realista (o de muestra) y ejecuta importación.
   - Esperado: preview/resultado correcto; errores entendibles si el archivo está mal.

---

## 9) Indicadores / reportes (2–3 min)
1. Abre **Indicadores** y ejecuta el filtro más común (por rango de fechas / máquina / molde).
   - Esperado: carga sin error y devuelve algo coherente (aunque sea vacío).
2. Abre **Reportes** (si existe) y genera el reporte más usado.
   - Esperado: respuesta OK; export/descarga si aplica.

---

## 10) Configuración / festivos / laborabilidad (2–3 min)
1. Entra a configuración de festivos/overrides (si aplica):
   - Crea un override de “no laborable” para una fecha futura.
   - Esperado: el calendario lo refleja (overrides) y planner respeta la restricción.
2. Limpia el override de prueba.

---

# Criterio de salida (Definition of Done)
- No hay errores visibles (UI) ni respuestas 500.
- Planner + Calendar muestran lo planificado.
- Roles básicos no se cruzan (operator no hace planner si no corresponde).
- CRUD principales crean/leen/actualizan/eliminan sin romper.

# Si algo falla
- Anota: módulo, usuario/rol, pasos exactos, fecha/hora, y si puedes, captura de pantalla.
- Si sale un error en consola/red (Network): guarda el endpoint y el payload.
