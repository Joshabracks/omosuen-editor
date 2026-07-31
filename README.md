# Omosuen Editor

Official Omosuen editor — **Electron desktop app** (in progress).

## Develop

```bash
npm install
npm run dev      # watch + Electron (electronmon)
npm start        # one-shot build + launch
npm test         # tsx logic tests
npm run pack     # electron-builder --dir
```

## Layout

| Path | Contents |
|---|---|
| [`electron/`](electron/) | Main process + preload |
| [`src/app/`](src/app/) | Renderer shell entry |
| [`src/bridge/`](src/bridge/) | IPC channel catalog |
| [`.design/electron/`](.design/electron/) | Active design track (priorities, architecture, full design) |
| [`_old/`](_old/) | Archive: first VS Code extension attempt (v0.1) |
| [`_old_v2/`](_old_v2/) | Archive: VS Code remake (v0.2) |

Start with [`.design/electron/03-design.md`](.design/electron/03-design.md).  
Implementation tickets: [`.design/tasks/`](.design/tasks/).

### Locked product decisions (2026-07-23)

- **Editor host:** Electron (Chromium + Node main) — not a VS Code fork
- **Game exports:** Web / itch zip; Desktop Electron (+ sidecars)
- **Code editing:** Monaco tiers A/B/C; highlighting for ts/js/omo.*/sst.*/json/css/html/omoscene/omocomp
- **Editor extensibility:** E16 contribution API (shared widgets/tools; plugin-ready schemas)

### State Street (2026-07-31)

- **UI:** `@state-street/state-street` **≥ 2.4.1**
- Docked Monaco/WebGL hosts: `:preserve` + **`moveTo`/`resetLocation`** — see [`.design/electron/04-state-street.md`](.design/electron/04-state-street.md)
