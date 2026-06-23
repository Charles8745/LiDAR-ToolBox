# 3D model source attributions

Raw model assets (`*.glb` / glTF folders / textures) under this directory are
**git-ignored** — only the baked point-cloud templates in
`../ship-models/*.json` are committed. The point clouds are derivative works of
the models below, so the attributions travel with the project.

## 貨櫃 (container ship) → `../ship-models/貨櫃.json`

This work is based on **"Container Ship"**
(https://sketchfab.com/3d-models/container-ship-aaa41cca946b4a08bc08cf692b7757be)
by **RM02** (https://sketchfab.com/RM02) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## 油品 (oil tanker) → `../ship-models/油品.json`

This work is based on **"Tanker Ship"**
(https://sketchfab.com/3d-models/tanker-ship-96ebf61af42b4062ae98a6ad848e1a25)
by **KoreanNavy** (https://sketchfab.com/KoreanNavy) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## 散雜 (bulk carrier) → `../ship-models/散雜.json`

This work is based on **"Bulk Carrier"**
(https://sketchfab.com/3d-models/bulk-carrier-93c076900f004102b78dfac989efae1d)
by **medialog** (https://sketchfab.com/medialog) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## LNG → `../ship-models/LNG.json`

This work is based on **"LNG Ship"**
(https://sketchfab.com/3d-models/lng-ship-fa335b96450d4344863bbf5d912a0288)
by **KoreanNavy** (https://sketchfab.com/KoreanNavy) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## 工作 (tug boat) → `../ship-models/工作.json`

This work is based on **"Tug Boat Xy"**
(https://sketchfab.com/3d-models/tug-boat-xy-3093fdebf5bc4f61a8130ec433498a29)
by **gogiart** (https://sketchfab.com/agt14032013) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## 軍艦 (warship) → `../ship-models/軍艦.json`

This work is based on **"Alreigh Burke Destroyer"**
(https://sketchfab.com/3d-models/alreigh-burke-destroyer-52a04129e8f64134ae26d365c4e82ce7)
by **waelXcm** (https://sketchfab.com/waelXcm) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

## 客運 (cruise/passenger) → `../ship-models/客運.json`

This work is based on **"Cruise Ship"**
(https://sketchfab.com/3d-models/cruise-ship-bb782326932e4c179e34f3d6c8e36b86)
by **farhad.Guli** (https://sketchfab.com/farhad.Guli) licensed under **CC-BY-4.0**
(http://creativecommons.org/licenses/by/4.0/).

Baked via `npm run port:models` (geometry-only contour-slice + voxel sampling →
normalized templates; textures/materials stripped before sampling).
