/**
 * Inspector property schemas, versioned per engine release.
 *
 * A component's editor schema is not a single document — it's a list of
 * versions, each marked with the first engine release it applies to.
 * The floor-match rule (largest `since` that is ≤ engine version) is how
 * both the editor UI and the drift test pick the right schema for any
 * given engine version.
 *
 * Adding a new schema version only becomes necessary when the engine
 * changes a component's shape (field added, removed, renamed, or retyped).
 * Until then, the original entry keeps applying to every release.
 */

/**
 * Allowed value shapes the inspector UI can render. New types are added as
 * inspector widgets are built out in later phases; the drift test only cares
 * about field-name alignment, so an as-yet-unsupported type is acceptable
 * as a placeholder for structural shape.
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'stringSet'
  | 'Vector2D'
  | 'Vector3D'
  | 'Vector4D'
  | 'object'
  | 'array'
  | 'map';

/**
 * Describes one inspector field corresponding to one PROPERTY_ALLOWLIST entry.
 */
export interface PropertySchema {
  /**
   * Must match the engine's PROPERTY_ALLOWLIST entry for the target
   * component, OR be a dot-separated path INTO an allowlist entry to
   * surface a nested value as its own inspector row (e.g. `config.atlasSize`
   * targets the `atlasSize` member of the `config` allowlist entry).
   *
   * Dotted-path fields collectively cover their root allowlist entry —
   * the schema-drift test normalizes by stripping at the first `.`
   * before matching against the allowlist, so `config.atlasSize` +
   * `config.maxAtlases` are both classified under `config`.
   */
  name: string;
  /** Value shape hint for the inspector UI. */
  type: PropertyType;
  /** Display label shown in the inspector. */
  label: string;
  /** Default value used when the serialized data is missing or unparseable. */
  default?: unknown;
  /** Numeric bounds; only meaningful for `type: 'number'`. */
  min?: number;
  max?: number;
  step?: number;
  /**
   * Allowed values for `type: 'enum'`. May be all-string (rendered with
   * the string value as both option value and label) or all-number (the
   * widget routes through `editEnumNumber` which dispatches the parsed
   * `Number(value)` on change).
   */
  values?: readonly (string | number)[];
  /**
   * Opt-in for `type: 'string'` fields that represent a path on disk.
   * When present, the inspector renders a "Browse…" button next to the
   * text input that dispatches `omosuen.browseForFile` with the
   * declared `extensions` as the open-dialog filter. The picked path is
   * written back as scene-relative through the standard
   * `component:update` flow. No effect on other `type` values.
   */
  filePicker?: {
    readonly extensions: readonly string[];
  };
  /**
   * Opt-in for `type: 'enum'` fields whose option values come from
   * other components in the same scene rather than a static list.
   * Example: a sprite's `textureMapKeys.albedo` should let the user
   * pick from any `texture-map`'s `textureMapKey` field in the
   * current scene.
   *
   * When set, `values` is ignored — the inspector walks the scene
   * tree, collects every component matching `componentType`, reads
   * `keyField` from each, dedupes + sorts the strings, and passes
   * the resulting list as the enum's options at render time. The
   * currently-saved value is always included so a stale reference
   * stays visible (and the user can switch off it).
   */
  componentRef?: {
    readonly componentType: string;
    readonly keyField: string;
  };
  /**
   * Opt-in for `type: 'enum'` fields whose options come from another
   * field on the *same* component. Sibling of `componentRef` (which
   * scans across components in the scene). Used by
   * animation-controller's `currentAnimation` to populate the dropdown
   * from `animations[*].name` of the same controller.
   *
   * `mapField` is the property to extract from each array item when
   * the source array contains objects. Omit it when the source array
   * is already a `string[]`. The resolved list is deduped, sorted,
   * and prefixed with an empty option so the user can clear the
   * selection.
   */
  valuesFromField?: {
    readonly fieldName: string;
    readonly mapField?: string;
  };
  /**
   * For `type: 'stringSet'` only. The full set of allowed members
   * the widget renders as toggleable checkboxes. The on-disk value
   * is a `string[]` containing some subset of these.
   */
  options?: readonly string[];
  /**
   * For `type: 'stringSet'` only. Members in this list render as
   * checked + disabled — the user can't toggle them off through the
   * inspector. Use when the engine requires a member to always be
   * present (animation-controller's `albedo` channel).
   */
  alwaysOn?: readonly string[];
  /**
   * For `type: 'enum'` only. When true, the empty `''` option is
   * labelled `(none)` and the change handler dispatches `null` (not
   * `''`) for the empty selection — matches engines that distinguish
   * "no value" from "the empty-string value." Saved values that are
   * present but not in the resolved options list also render as
   * `<value> (missing)` (disabled, still selected) so the user can
   * see what's stored before picking a replacement.
   */
  nullable?: boolean;
}

/**
 * Schema-declared inspector action button. Rendered by the inspector as
 * a clickable button below the component's fields; a click emits a
 * `command:invoke` message that the extension host forwards to
 * `vscode.commands.executeCommand(command, componentId)`.
 *
 * Used to launch Phase 8's specialized editors (animation, texture-map,
 * cell-map, cell-map-materials) from the inspector panel without the
 * user having to memorize command-palette entries.
 */
export interface ComponentAction {
  /** Display text on the inspector button. */
  label: string;
  /** VS Code command id registered via `commands.registerCommand`. */
  command: string;
}

/**
 * One versioned schema snapshot for a component.
 */
export interface ComponentSchemaVersion {
  /**
   * First engine release this schema applies to, formatted like the engine's
   * git tags: "v0.1.30". The `v` prefix is required for consistency with the
   * rest of the tooling (UMD filenames, sync-releases, etc.).
   */
  since: string;
  /** Inspector fields, ordered as the UI should render them. */
  fields: readonly PropertySchema[];
  /**
   * PROPERTY_ALLOWLIST entries intentionally not modeled as inspector fields.
   * Typical contents: WebGL resource bundles, DOM refs the engine rebuilds at
   * runtime, private cache maps, callback slots populated by `init()`. The
   * drift test requires every allowlist entry to appear in either `fields` or
   * `exclude` — this field is how a schema author affirmatively says "yes,
   * this allowlist entry exists, and yes, it's intentionally not a UI field."
   */
  exclude?: readonly string[];
  /**
   * Optional inspector action buttons (Phase 8.1). Rendered after the
   * fields; each entry becomes one button whose click dispatches the
   * named VS Code command with the current component's id.
   */
  actions?: readonly ComponentAction[];
}

/**
 * Complete versioned schema for one component type.
 */
export interface ComponentSchemas {
  /** Must match an engine COMPONENT_TYPE (e.g. "transform", "animation-controller"). */
  componentType: string;
  /**
   * Schemas ordered ascending by `since`. The registry validates this order
   * and rejects duplicate `since` values for the same component.
   */
  versions: readonly ComponentSchemaVersion[];
}
