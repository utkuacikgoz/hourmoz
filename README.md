# HOURMUZ — Break the tide

A standalone 3D naval arcade game. No ads, tracking, account system, or live shipping feed.

## Play locally

Serve `dist` over HTTP, for example `python3 -m http.server 4173 --directory dist`, then open http://localhost:4173.

- WASD / arrows: steer. Shift: boost. Escape: pause.
- Runner: Space deploys decoys to divert incoming missiles.
- Blockade: hold Space to fire with automatic targeting, or aim and fire with the mouse.
- Phones and tablets: virtual joystick, boost and ability buttons.
- Choose an upgrade after each 35-second sector. Survive all three sectors to complete the operation.
- Sound is opt-in. Best scores are stored only on the current device.

## Verification

`node tests/engine.test.mjs`

The simulation is independent of the rendering layer and uses a fixed 60 Hz step. Three.js 0.180.0 is vendored under `dist/vendor`; its license is included. Google Fonts are optional; system fonts are fallbacks. WebGL is required.

The map, military activity, and passage conditions are fictional arcade mechanics. This game does not report current conditions in the Strait of Hormuz.
