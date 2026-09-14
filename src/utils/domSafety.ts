let installed = false;

export function installDomMutationGuards(): void {
  if (installed || typeof Node === 'undefined') return;
  installed = true;

  const originalRemoveChild = Node.prototype.removeChild;

  Node.prototype.removeChild = function removeChildGuard<T extends Node>(child: T): T {
    if (child && child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  } as typeof Node.prototype.removeChild;
}
