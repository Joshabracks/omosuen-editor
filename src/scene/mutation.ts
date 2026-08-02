/**
 * Pure scene-tree mutations (3b). Walks type / id / components only —
 * no per-field component parsers.
 */

import type {
  OmosceneFile,
  SerializedComponent,
  SerializedScene,
} from '../omoscene';

function isSerializedComponent(value: unknown): value is SerializedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export function findComponentById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  if (!Array.isArray(root.components)) return null;
  for (const child of root.components) {
    if (!isSerializedComponent(child)) continue;
    const hit = findComponentById(child, id);
    if (hit) return hit;
  }
  return null;
}

export function findParentId(
  root: SerializedComponent,
  childId: number,
): number | null {
  if (!Array.isArray(root.components)) return null;
  const selfId = typeof root.id === 'number' ? root.id : null;
  for (const child of root.components) {
    if (!isSerializedComponent(child)) continue;
    if (child.id === childId) return selfId;
    const nested = findParentId(child, childId);
    if (nested !== null) return nested;
  }
  return null;
}

/** Walk tree depth-first; yield each node with parent id and sibling index. */
export function walkSceneTree(
  root: SerializedComponent,
  visit: (node: SerializedComponent, parentId: number | null, index: number) => void,
  parentId: number | null = null,
): void {
  if (!Array.isArray(root.components)) return;
  root.components.forEach((child, index) => {
    if (!isSerializedComponent(child)) return;
    visit(child, parentId, index);
    const id = typeof child.id === 'number' ? child.id : null;
    walkSceneTree(child, visit, id);
  });
}

export function nextComponentId(file: OmosceneFile): number {
  const max = findMaxId(file.scene, -1);
  return max < 0 ? 1 : max + 1;
}

function findMaxId(node: SerializedComponent, current: number): number {
  let m = current;
  if (typeof node.id === 'number' && Number.isFinite(node.id) && node.id > m) {
    m = node.id;
  }
  if (Array.isArray(node.components)) {
    for (const child of node.components) {
      if (isSerializedComponent(child)) m = findMaxId(child, m);
    }
  }
  return m;
}

export function setNestedMutating(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const next = cursor[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[key] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[segments[segments.length - 1]!] = value;
}

function setNestedImmutable(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.');
  if (segments.length === 1) {
    return { ...obj, [segments[0]!]: value };
  }
  const [head, ...rest] = segments;
  const headKey = head!;
  const existing = obj[headKey];
  const childObj: Record<string, unknown> =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return {
    ...obj,
    [headKey]: setNestedImmutable(childObj, rest.join('.'), value),
  };
}

export function applyComponentUpdate(
  file: OmosceneFile,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): OmosceneFile {
  const { scene, changed } = updateComponentProperty(
    file.scene,
    id,
    componentType,
    property,
    value,
  );
  if (!changed) return file;
  return { ...file, scene };
}

function updateComponentProperty(
  root: SerializedScene,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): { scene: SerializedScene; changed: boolean } {
  const result = updateNode(root, id, componentType, property, value);
  if (result === root) return { scene: root, changed: false };
  return { scene: result as SerializedScene, changed: true };
}

function updateNode(
  node: SerializedComponent,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): SerializedComponent {
  const matches = node.type === componentType && node.id === id;
  let rebuilt: SerializedComponent[] | null = null;
  if (Array.isArray(node.components)) {
    const children = node.components as readonly SerializedComponent[];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child === undefined) continue;
      const updated = isSerializedComponent(child)
        ? updateNode(child, id, componentType, property, value)
        : child;
      if (rebuilt !== null) {
        rebuilt.push(updated);
      } else if (updated !== child) {
        rebuilt = children.slice(0, i);
        rebuilt.push(updated);
      }
    }
  }
  const childrenChanged = rebuilt !== null;
  if (!matches && !childrenChanged) return node;
  let nextNode: SerializedComponent = { ...node };
  if (matches) {
    nextNode = setNestedImmutable(
      nextNode as unknown as Record<string, unknown>,
      property,
      value,
    ) as SerializedComponent;
  }
  if (childrenChanged) {
    (nextNode as Record<string, unknown>).components = rebuilt;
  }
  return nextNode;
}

export function insertChildComponent(
  file: OmosceneFile,
  parentId: number,
  newComponent: SerializedComponent,
  index?: number,
): OmosceneFile {
  const { scene, changed } = insertUnderNexus(
    file.scene,
    parentId,
    newComponent,
    index,
  );
  if (!changed) return file;
  return { ...file, scene: scene as SerializedScene };
}

function insertUnderNexus(
  node: SerializedComponent,
  parentId: number,
  newComponent: SerializedComponent,
  index?: number,
): { scene: SerializedComponent; changed: boolean } {
  if (node.type === 'nexus' && node.id === parentId) {
    const existing: readonly SerializedComponent[] = Array.isArray(
      node.components,
    )
      ? (node.components as readonly SerializedComponent[])
      : [];
    const nextChildren = [...existing];
    if (
      index === undefined ||
      !Number.isFinite(index) ||
      index < 0 ||
      index > nextChildren.length
    ) {
      nextChildren.push(newComponent);
    } else {
      nextChildren.splice(index, 0, newComponent);
    }
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>).components = nextChildren;
    return { scene: nextNode, changed: true };
  }

  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }

  const children = node.components as readonly SerializedComponent[];
  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = insertUnderNexus(child, parentId, newComponent, index);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>).components = rebuilt;
  return { scene: nextNode, changed: true };
}

export type MoveDirection = 'up' | 'down';

export function moveComponent(
  file: OmosceneFile,
  componentId: number,
  direction: MoveDirection,
): OmosceneFile {
  const { scene, changed } = moveInTree(file.scene, componentId, direction);
  if (!changed) return file;
  return { ...file, scene: scene as SerializedScene };
}

function moveInTree(
  node: SerializedComponent,
  componentId: number,
  direction: MoveDirection,
): { scene: SerializedComponent; changed: boolean } {
  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }
  const children = node.components as readonly SerializedComponent[];
  const index = children.findIndex(
    (c) => isSerializedComponent(c) && c.id === componentId,
  );
  if (index !== -1) {
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= children.length) {
      return { scene: node, changed: false };
    }
    const nextChildren = [...children];
    const a = nextChildren[index]!;
    const b = nextChildren[swapWith]!;
    nextChildren[index] = b;
    nextChildren[swapWith] = a;
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>).components = nextChildren;
    return { scene: nextNode, changed: true };
  }

  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = moveInTree(child, componentId, direction);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>).components = rebuilt;
  return { scene: nextNode, changed: true };
}

export function removeComponent(
  file: OmosceneFile,
  componentId: number,
): OmosceneFile {
  if (file.scene.id === componentId) return file;
  const { scene, changed } = removeInTree(file.scene, componentId);
  if (!changed) return file;
  return { ...file, scene: scene as SerializedScene };
}

function removeInTree(
  node: SerializedComponent,
  componentId: number,
): { scene: SerializedComponent; changed: boolean } {
  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }
  const children = node.components as readonly SerializedComponent[];
  const index = children.findIndex(
    (c) => isSerializedComponent(c) && c.id === componentId,
  );
  if (index !== -1) {
    const nextChildren = [
      ...children.slice(0, index),
      ...children.slice(index + 1),
    ];
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>).components = nextChildren;
    return { scene: nextNode, changed: true };
  }

  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = removeInTree(child, componentId);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>).components = rebuilt;
  return { scene: nextNode, changed: true };
}

export function reparentComponent(
  file: OmosceneFile,
  componentId: number,
  newParentId: number,
  index?: number,
): OmosceneFile {
  if (componentId === newParentId) return file;
  if (file.scene.id === componentId) return file;

  const source = findComponentById(file.scene, componentId);
  if (source === null) return file;

  const target = findComponentById(file.scene, newParentId);
  if (target === null || target.type !== 'nexus') return file;

  if (findComponentById(source, newParentId) !== null) return file;

  const currentParent = findParentId(file.scene, componentId);
  if (currentParent === newParentId && index === undefined) {
    const targetChildren = Array.isArray(target.components)
      ? (target.components as readonly SerializedComponent[])
      : [];
    if (targetChildren.some((c) => isSerializedComponent(c) && c.id === componentId)) {
      return file;
    }
  }

  const withoutSource = removeInTree(file.scene, componentId);
  if (!withoutSource.changed) return file;
  const withInsert = insertUnderNexus(
    withoutSource.scene,
    newParentId,
    source,
    index,
  );
  if (!withInsert.changed) return file;
  return { ...file, scene: withInsert.scene as SerializedScene };
}

/** Deep-clone a component subtree and assign fresh ids. */
export function duplicateComponent(
  file: OmosceneFile,
  componentId: number,
): OmosceneFile {
  if (file.scene.id === componentId) return file;
  const source = findComponentById(file.scene, componentId);
  if (source === null) return file;
  const parentId = findParentId(file.scene, componentId);
  if (parentId === null) return file;

  const clone = JSON.parse(JSON.stringify(source)) as SerializedComponent;
  const name =
    typeof clone.name === 'string' && clone.name !== ''
      ? clone.name
      : clone.type;
  (clone as Record<string, unknown>).name = `${name} (copy)`;

  let next = nextComponentId(file);
  reassignIds(clone, () => {
    const id = next;
    next += 1;
    return id;
  });

  return insertChildComponent(file, parentId, clone);
}

export function reassignIds(
  component: SerializedComponent,
  nextId: () => number,
): void {
  (component as Record<string, unknown>).id = nextId();
  if (component.type === 'nexus' && Array.isArray(component.components)) {
    for (const child of component.components) {
      if (isSerializedComponent(child)) reassignIds(child, nextId);
    }
  }
}

export function countTypeInScene(
  root: SerializedComponent,
  type: string,
): number {
  let count = root.type === type ? 1 : 0;
  if (!Array.isArray(root.components)) return count;
  for (const child of root.components) {
    if (isSerializedComponent(child)) {
      count += countTypeInScene(child, type);
    }
  }
  return count;
}

export function countTypeUnderParent(
  root: SerializedComponent,
  parentId: number,
  type: string,
): number {
  const parent = findComponentById(root, parentId);
  if (!parent || !Array.isArray(parent.components)) return 0;
  let count = 0;
  for (const child of parent.components) {
    if (isSerializedComponent(child) && child.type === type) count += 1;
  }
  return count;
}
