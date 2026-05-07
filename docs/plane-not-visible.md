# Plane Not Visible

## Summary

Plane visual is not producing visible pixels on screen despite being fully processed by the renderer (6 parts in `_activeMeshes`, all meshes visible, enabled, and ready).

## Evidence

Confirmed via CDP on dev VM (Chrome 148 + SwiftShader WebGL2):

```
RENDER_ID: 5234
_activeMeshes: parts=6  chunks=231   (all 6 plane parts in SmartArray.data)
```

**Scene graph:**
```
camera (0, 0, 0)  ← floating origin reset
worldGroup (-5993.37, -2182.39, 1.88)
  └ planeGroup (5993.87, 2181.71, 0)
      └ part 0 (fuselage): absPos (0.500, -0.705, 1.936), visible, enabled
      └ part 1 (nose):     absPos (0.500, -0.823, 2.260), visible, enabled
      └ part 2 (cockpit):  absPos (0.455, -0.746, 2.049), visible, enabled
      └ part 3 (wings):    absPos (0.512, -0.684, 1.879), visible, enabled
      └ part 4 (tail):     absPos (0.509, -0.602, 1.654), visible, enabled
      └ part 5 (fin):      absPos (0.425, -0.612, 1.682), visible, enabled
```

Camera forward (from rotationQuaternion): (0.342, 0, 0.936) — looking +Z +X
Dot product (camera → plane): +1.98 — plane is in front

Screen-space projection: ~(590, 179) — should be in upper quarter of 1280×720 frame.

## Pixel Analysis

Screenshot `/tmp/plane-final.png` sampled at 1280×720:

- Center pixel: (5, 5, 15) — clear color `#050510`, no content
- Planet surface occupies only top ~20% of frame (rows 0–140): gray/green tones, RGB ~(30–130)
- Rest of image: solid dark background (clear color)
- **Zero pixels** are distinct from planet surface or clear color — the plane produces no visible output

## Hypotheses

### 1. Z-buffer occlusion (most likely)

The planet LOD chunks render in front of the plane despite being geometrically farther from camera:

- Camera is ~7.3 units above planet surface
- Plane is ~2.12 units from camera
- LOD chunks use custom geometry with potential bounding box issues
- Babylon.js rendering order within group 0 is arbitrary for opaque meshes; Z-buffer should resolve correctly, but chunk bounding volumes may extend beyond their actual geometry

### 2. PBRMaterial emissive not effective

```
new PBRMaterial('partMat', scene)
mat.albedoColor = Color3.FromHexString('#5a5a5a')    // (0.35, 0.35, 0.35)
mat.metallic = 0.3
mat.roughness = 0.6
mat.emissiveColor = Color3.FromHexString(color).scale(0.85)  // (0.3, 0.3, 0.3)
```

- PBRMaterial requires environment lighting for metallic reflections — without an environment texture, metallic surfaces render black
- `emissiveColor` at (0.3, 0.3, 0.3) may be too dim against the dark clear color (0.02, 0.02, 0.06) — only ~5× brighter
- `emissiveIntensity` defaults to 1.0 — might need explicit verification

### 3. Material not compiling for SwiftShader

PBRMaterial with metallic/roughness requires WebGL2 extension `GL_EXT_disjoint_timer_query` or similar. SwiftShader (software WebGL) may silently fail to compile the PBR shader.

- `isReady()` returns `true` — but this may not reflect actual GL compilation
- SwiftShader is known to have issues with complex PBR shaders

### 4. Scene rendering order issue

The render loop in `SceneManager.ts` applies floating origin AFTER update callbacks but BEFORE `scene.render()`. If the worldGroup transform is applied while the camera quaternion was set for the pre-floating-origin camera position, the view matrix may produce incorrect clip-space coordinates for the plane.

## Bisection Plan

Для выяснения коренной причины используется редукция сцены (метод в `docs/skills/visual-debugging.md`).

**Инфраструктура:**
- `debug.html` — HTML-шаблон, ссылается на `src/debug-main.ts`
- `src/debug-main.ts` — минимальный entry point
- Запуск: `http://localhost:8080/debug.html` (тот же Vite сервер)
- Основная сцена (`src/main.ts`) не изменяется

**Шаги:**

| Шаг | Компоненты | Ожидание |
|-----|-----------|----------|
| 0 | Только SceneManager + FlightModel + PlaneVisual + ChaseCamera + минимальный свет | Плоскость видна |
| 1 | + Sun.ts (DirectionalLight + HemisphereLight + sun disc) | Плоскость видна или нет? |
| 2 | + LODPlanet (ландшафт, parented в worldGroup) | Плоскость видна или нет? |
| 3 | Весь набор как в main.ts | Полная сцена |

Если плоскость ломается на шаге 1 — проблема в освещении Sun (интенсивность, направление, PBR-взаимодействие).
Если на шаге 2 — проблема в LODPlanet (z-buffer, bounding boxes, порядок рендеринга).

**На каждом шаге:** скриншот через CDP + пиксельный анализ. Скриншоты сохранять в `/tmp/debug-bisect-step-*.png`.

## Quick Fixes (для проверки гипотез)

Если бисект укажет на конкретный компонент, проверить:

- **PBR → StandardMaterial**: заменить `PBRMaterial` на `StandardMaterial` в PlaneVisual
- **emissiveIntensity**: `mat.emissiveIntensity = 5.0`
- **renderingGroupId**: выставить частям самолёта `renderingGroupId = 1` (рендерить после земли)
- **alwaysSelectAsActiveMesh**: включить на частях самолёта
- **Light direction**: проверить, не светит ли солнце с обратной стороны
