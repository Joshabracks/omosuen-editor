/**
 * E16 editor contribution shapes (field widgets, type/tool/registry APIs).
 */

export type FieldWidgetType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'Vector2'
  | 'Vector3'
  | 'Vector4'
  | 'Color3'
  | 'Color4'
  | 'list'
  | 'map'
  | 'stringSet'
  | 'object';

/** @deprecated Prefer Vector2/3/4 — accepted aliases for remake schemas. */
export type LegacyVectorAlias = 'Vector2D' | 'Vector3D' | 'Vector4D' | 'array';

export type FieldType = FieldWidgetType | LegacyVectorAlias;

export type UniquenessMode = 'FALSE' | 'LOCAL' | 'GLOBAL' | 'NAME';

export type ToolKindId =
  | 'animation-timeline'
  | 'texture-frame'
  | 'audio-mix'
  | 'cell-materials'
  | 'cell-voxel-paint'
  | (string & {});

export type GizmoId =
  | 'gizmo.translate'
  | 'gizmo.rotate'
  | 'gizmo.scale'
  | 'gizmo.collider'
  | 'gizmo.light-direction'
  | 'overlay.grid'
  | 'paint.cell-map'
  | 'pick.screen'
  | (string & {});

export interface FilePickerOptions {
  readonly extensions: readonly string[];
}

export interface ComponentRefOptions {
  readonly componentType: string;
  readonly keyField: string;
}

export interface ValuesFromFieldOptions {
  readonly fieldName: string;
  readonly mapField?: string;
}

export interface RegistryRefOptions {
  readonly registryId: string;
}

export interface ListFieldOptions {
  /** Widget type for each row value (default string). */
  readonly itemType?: FieldWidgetType;
  readonly itemLabel?: string;
}

export interface MapFieldOptions {
  readonly valueType?: FieldWidgetType;
  readonly keyLabel?: string;
  readonly valueLabel?: string;
}

/**
 * One inspector field. `name` may be a dotted path into an allowlist root
 * (e.g. `config.atlasSize`); drift tests match on the root segment.
 */
export interface FieldSchema {
  readonly name: string;
  readonly type: FieldType;
  readonly label: string;
  readonly default?: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly values?: readonly (string | number)[];
  readonly filePicker?: FilePickerOptions;
  readonly componentRef?: ComponentRefOptions;
  readonly valuesFromField?: ValuesFromFieldOptions;
  readonly registryRef?: RegistryRefOptions;
  readonly options?: readonly string[];
  readonly alwaysOn?: readonly string[];
  readonly nullable?: boolean;
  readonly list?: ListFieldOptions;
  readonly map?: MapFieldOptions;
  /** Omit from inspector; still counts for drift via exclude or tool action. */
  readonly editor?: 'default' | 'tool-only';
}

export interface ActionSchema {
  readonly id: string;
  readonly label: string;
  readonly tool?: ToolKindId;
  /** Optional legacy / host command id. */
  readonly command?: string;
}

export interface ViewportContribution {
  readonly labelWhen?: 'has-sibling-transform' | 'always' | 'never';
  readonly gizmos?: readonly GizmoId[];
  readonly paintModes?: readonly string[];
}

/** One versioned contribution snapshot (E16 registerEditorType payload). */
export interface EditorTypeContribution {
  readonly type: string;
  readonly since: string;
  readonly icon?: string;
  readonly uniqueness?: UniquenessMode;
  readonly fields: readonly FieldSchema[];
  readonly actions?: readonly ActionSchema[];
  readonly viewport?: ViewportContribution;
  readonly excludeFromInspector?: readonly string[];
}

export interface ResolvedEditorType {
  readonly type: string;
  readonly since: string;
  readonly icon?: string;
  readonly uniqueness?: UniquenessMode;
  readonly fields: readonly FieldSchema[];
  readonly actions: readonly ActionSchema[];
  readonly viewport?: ViewportContribution;
  readonly excludeFromInspector: readonly string[];
}

export interface EditorTypeEntry {
  readonly type: string;
  readonly versions: readonly EditorTypeContribution[];
}

export interface ToolOpenContext {
  readonly componentId: string | number;
  readonly componentType: string;
  readonly toolId: string;
  readonly property?: string;
}

export interface EditorToolContribution {
  readonly id: string;
  readonly open: (ctx: ToolOpenContext) => void;
}

export interface EditorRegistryContribution {
  readonly id: string;
  readonly listKeys: () => readonly string[];
}
