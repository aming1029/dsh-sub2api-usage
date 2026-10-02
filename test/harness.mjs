/**
 * A miniature React + DOM harness, just enough to execute the plugin's client
 * bundle outside a browser: function components, the hooks the bundle uses,
 * synchronous re-render on state updates, and text collection from the tree.
 * It is not React — it exists to catch real breakage (missing exports, wrong
 * slot options, reference errors, dead branches) without a browser.
 */

export function createHarness() {
  let hooks = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  // React keeps hook slots per component instance, not per render pass, so a new
  // hook added to one component must not shift another component's slots.
  const slots = new Map();

  const React = {
    createElement(type, props, ...children) {
      const flat = children.length <= 1 ? children[0] : children;
      return { type, props: { ...(props ?? {}), children: flat } };
    },
    useState(initial) {
      // Capture this component's slot array: the setter may run long after the
      // render finished, when `hooks` points at someone else's slots.
      const slot = hooks;
      const index = cursor++;
      if (!(index in slot)) slot[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slot[index],
        (next) => {
          slot[index] = typeof next === 'function' ? next(slot[index]) : next;
          dirty = true;
        },
      ];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      const changed = !previous || !deps || !previous.deps || deps.some((value, i) => value !== previous.deps[i]);
      if (changed) effects.push(effect);
      hooks[index] = { deps };
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (previous && deps && previous.deps && deps.every((value, i) => value === previous.deps[i])) return previous.value;
      const value = factory();
      hooks[index] = { deps, value };
      return value;
    },
    useCallback(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (previous && deps && previous.deps && deps.every((value, i) => value === previous.deps[i])) return previous.value;
      hooks[index] = { deps, value: fn };
      return fn;
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: value };
      return hooks[index];
    },
  };

  function renderNode(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(renderNode);
    const { type, props } = node;
    if (typeof type === 'function') {
      if (!slots.has(type)) slots.set(type, []);
      const outer = hooks;
      const outerCursor = cursor;
      hooks = slots.get(type);
      cursor = 0;
      try {
        return renderNode(type(props ?? {}));
      } finally {
        hooks = outer;
        cursor = outerCursor;
      }
    }
    return { type, props: { ...props, children: renderNode(props?.children) } };
  }

  return {
    React,
    /** Render a component tree, re-rendering while state updates, then run effects. */
    mount(element, { maxPasses = 12 } = {}) {
      let tree = null;
      for (let pass = 0; pass < maxPasses; pass += 1) {
        cursor = 0;
        dirty = false;
        effects = [];
        tree = renderNode(element);
        for (const effect of effects) {
          const cleanup = effect();
          if (typeof cleanup === 'function') this.cleanups.push(cleanup);
        }
        if (!dirty) break;
      }
      return tree;
    },
    cleanups: [],
    cleanupAll() {
      for (const cleanup of this.cleanups.splice(0)) cleanup();
    },
  };
}

/** Depth-first text of a rendered tree. */
export function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && node.props) return textOf(node.props.children);
  return '';
}

/** Find the first node matching a predicate. */
export function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate);
      if (hit) return hit;
    }
    return undefined;
  }
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}

/** All nodes matching a predicate. */
export function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
}
