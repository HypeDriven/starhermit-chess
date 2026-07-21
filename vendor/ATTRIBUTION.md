# Third-party assets & libraries

## three.js (vendor/three.module.min.js, three.core.min.js, loaders/, utils/)

[three.js](https://threejs.org/) — MIT license, Copyright 2010-2025 Three.js Authors.
The build (r176dev) and the `GLTFLoader` / `BufferGeometryUtils` addons were taken
from the vendored copy in [mrabhin03/3D-Chess-Game](https://github.com/mrabhin03/3D-Chess-Game).

## Chess piece models (assets/chess-pieces.glb)

The six piece geometries were extracted from `assets/ChessGLB.glb` in
[mrabhin03/3D-Chess-Game](https://github.com/mrabhin03/3D-Chess-Game) (MIT license,
per its readme). The originals were Draco-decoded, stripped to the six white pieces
(texcoords/materials dropped), centred, scaled so the king is 1 unit tall,
mesh-simplified (~0.18 ratio) and re-quantized (KHR_mesh_quantization) — 4.3 MB → 0.37 MB.
They are used by `starfield.js` for the main-menu background.
