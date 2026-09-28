# Third-party assets & libraries

## three.js (vendor/three.module.min.js, three.core.min.js, loaders/, utils/, addons/)

[three.js](https://threejs.org/) — MIT license, Copyright 2010-2025 Three.js Authors.
Everything is from the npm release `three@0.176.0` (r176): `build/three.module.min.js`,
`build/three.core.min.js`, and from `examples/jsm/` the `GLTFLoader` / `BufferGeometryUtils`
addons plus, under `addons/`, the post-processing passes (`EffectComposer`, `RenderPass`,
`ShaderPass`, `OutputPass`, `UnrealBloomPass`, `SMAAPass`, `Pass`, `MaskPass`), the shaders
they import (`CopyShader`, `FXAAShader`, `OutputShader`, `LuminosityHighPassShader`,
`SMAAShader`) and `environments/RoomEnvironment`. The loaders were originally taken from
[mrabhin03/3D-Chess-Game](https://github.com/mrabhin03/3D-Chess-Game)'s r176dev copy; they are
byte-identical to the 0.176.0 release, and the core build was replaced with the release so no
two revisions are mixed.

## Chess piece models (assets/chess-pieces.glb)

The six piece geometries were extracted from `assets/ChessGLB.glb` in
[mrabhin03/3D-Chess-Game](https://github.com/mrabhin03/3D-Chess-Game) (MIT license,
per its readme). The originals were Draco-decoded, stripped to the six white pieces
(texcoords/materials dropped), centred, scaled so the king is 1 unit tall,
mesh-simplified (~0.18 ratio) and re-quantized (KHR_mesh_quantization) — 4.3 MB → 0.37 MB.
They are used by `starfield.js` for the main-menu background.
