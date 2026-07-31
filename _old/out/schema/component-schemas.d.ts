/**
 * Property schemas for all 20 component types.
 * Derived from engine's PROPERTY_ALLOWLIST and *Options interfaces in each data.ts.
 */
import type { COMPONENT_TYPE } from '../types/engine';
export type PropertyType = 'string' | 'number' | 'boolean' | 'enum' | 'Vector2D' | 'Vector3D' | 'Vector4D' | 'Color3' | 'Color4' | 'object' | 'readonly' | 'action' | 'frameList' | 'filepath';
export interface PropertySchema {
    name: string;
    type: PropertyType;
    label: string;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    values?: string[];
    readOnly?: boolean;
    subFields?: PropertySchema[];
    /** VS Code command to execute when an 'action' type button is clicked */
    command?: string;
    /** Accepted file extensions for filepath type (e.g. ['png', 'jpg', 'gif']) */
    acceptedTypes?: string[];
    /** Optional regex (as string) to match against file contents for validation */
    contentMatch?: string;
}
export declare const COMPONENT_SCHEMAS: Record<COMPONENT_TYPE, PropertySchema[]>;
/**
 * Returns the property schema for a given component type.
 */
export declare function getSchemaForType(type: COMPONENT_TYPE): PropertySchema[];
