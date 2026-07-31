/**
 * Engine type contract — mirrors omosuen 0.1.0 public API surface.
 * These types must stay in sync with the engine's actual types.
 * Source: https://github.com/Joshabracks/omosuen/tree/0.1.0
 */
export type COMPONENT_TYPE = 'nexus' | 'ui-overlay' | 'data-layer' | 'flag-manager' | 'messenger' | 'viewport' | 'texture-map' | 'atlas-manager' | 'sprite' | 'transform' | 'animation-controller' | 'cell-map' | 'camera' | 'input-controller' | 'collider' | 'event-collider' | 'timer' | 'light' | 'audio-track' | 'audio-player' | 'audio-effect';
export declare enum ComponentUnique {
    FALSE = 0,
    LOCAL = 1,
    GLOBAL = 2,
    NAME = 3
}
/**
 * Serialized vector types — engine uses _vectorType discriminator
 */
export interface SerializedVector2D {
    _vectorType: 'Vector2D';
    x: number;
    y: number;
}
export interface SerializedVector3D {
    _vectorType: 'Vector3D';
    x: number;
    y: number;
    z: number;
}
export interface SerializedVector4D {
    _vectorType: 'Vector4D';
    x: number;
    y: number;
    z: number;
    w: number;
}
/**
 * Base serialized component — common fields from ComponentData
 */
export interface SerializedComponent {
    type: COMPONENT_TYPE;
    name: string;
    id?: number;
    unique?: ComponentUnique;
    overrideKey?: string;
    updateOverride?: string;
    loader?: boolean;
    [key: string]: unknown;
}
/**
 * Serialized nexus — recursive scene tree structure
 */
export interface SerializedNexus extends SerializedComponent {
    type: 'nexus';
    components: SerializedComponent[];
    paused?: boolean;
}
/**
 * Type guard: is this component a nexus with children?
 */
export declare function isSerializedNexus(component: SerializedComponent): component is SerializedNexus;
