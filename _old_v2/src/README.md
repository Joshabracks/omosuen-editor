# Source layout

See [.design/05-implementation-plan.md](../.design/05-implementation-plan.md) for the authoritative structure and phasing.

| Directory | Purpose |
|---|---|
| `app/` | Extension entry point, activation, commands. |
| `panel/` | Panel abstractions (base class, inspector, scene tree). Webview bundle entry lives here. |
| `bridge/` | Protocol transport — `postMessage` for in-extension webviews, WebSocket for cross-process preview-game instances. |
| `protocol/` | Typed message catalog (discriminated union). Single source of truth for editor ↔ scene communication. |
| `schema/` | `PropertySchema` infrastructure, schema registry, schema-drift test. |
| `component/` | Per-component editor directories, one per engine component. Each is a self-contained silo (no cross-component imports; enforced by eslint). |
| `scene/` | Specialized editor windows built as Omosuen scenes (animation editor, texture-map editor, etc.). Same silo rule as `component/`. |
| `test/` | `tsx`-run logic tests. |

Directories that aren't populated yet are created when the first real file for them lands in a later phase.
