# Reference Debug Slice — 2026-05-08

Рабочий минимальный debug-срез с рендерящимся самолётом. Используется как
референс для сравнения («золотой снэпшот»): если будущие изменения ломают
рендеринг, дифф против этого среза покажет что именно.

## Что в срезе

| Файл | Описание |
|------|----------|
| `SceneManager.ts` | С fixes: `disableUniformBuffers=true`, `_referencePoint=(0,0,1000)`, `_useRotationForTarget=true` |
| `PlaneVisual.ts` | 6 частей, StandardMaterial, emissiveColor = полная яркость, scale 1.5 |
| `debug-main.ts` | Точка входа: камера identity, самолёт на (0,0,8), rotation 25° вокруг Y |
| `debug.html` | HTML-шаблон для независимого хостинга (архивный URL) |
| `archive-main.ts` | Точка входа для независимого хостинга (импортирует `./SceneManager`, `./PlaneVisual`) |
| `style.css` | Стили (копия `src/style.css`) |
| `debug-plane-final.png` | Скриншот (CDP → OpenCV: 40,706 не-фоновых пикселей, CONTENT DETECTED) |

## Независимый хостинг (рекомендуемый)

Архивный срез хостится сам из своей директории — не требует копирования файлов в `src/`:

```bash
npm run dev
# → http://localhost:8080/docs/archives/2026-05-08-debug-plane-slice/debug.html
```

Верифицировано 2026-05-08: 6 active meshes, 13,927 px, CONTENT DETECTED.

## Ручное развёртывание (альтернативный способ)

```bash
# 1. Скопировать файлы на место
cp docs/archives/2026-05-08-debug-plane-slice/SceneManager.ts src/scene/
cp docs/archives/2026-05-08-debug-plane-slice/PlaneVisual.ts src/plane/
cp docs/archives/2026-05-08-debug-plane-slice/debug-main.ts src/
cp docs/archives/2026-05-08-debug-plane-slice/debug.html ./

# 2. Отключить основную сцену (если активна)
mv index.html index.html.bak

# 3. Запустить
npm run dev
# → http://localhost:8080/debug.html
```

## Ожидаемый результат

- 6 active meshes (все `"part"`)
- `_renderId` инкрементируется
- OpenCV `analyze`: CONTENT DETECTED, >40,000 px
- Визуально: серый самолёт (фюзеляж, крылья, хвост) на тёмно-синем фоне

## Ключевые параметры сцены

| Параметр | Значение |
|----------|---------|
| Камера | `FreeCamera`, identity quaternion, FOV 70°, nearZ 0.001 |
| Позиция самолёта | `(0, 0, 8)` |
| Rotation самолёта | 0.44 rad вокруг Y (≈25°) |
| Scale самолёта | 1.5 |
| Emissive | `Color3.FromHexString(color)` — полная яркость |
| Clear color | `(0.02, 0.02, 0.06)` — #050510 |
| Свет | DirectionalLight (0.5,-1,0.5) + HemisphericLight (0,1,0) |
| UBO | `disableUniformBuffers = true` |

## Три root causes, которые фиксит этот срез

1. **UBO пустой** — `finalizeSceneUbo()` не вызывается → `viewProjection = zero`
2. **`_referencePoint = (0,0,0)`** — LookAt вырождается после floating origin
3. **ChaseCamera `_camOffset`** — неправильный маппинг осей камеры (в debug-сцене не используется)
