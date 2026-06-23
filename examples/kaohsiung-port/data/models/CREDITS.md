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

Baked via `npm run port:models` (geometry-only surface sampling → 300-point
normalized template; textures/materials stripped before sampling).
