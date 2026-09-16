import type { PersistencePort } from "./PersistencePort";

interface Queue { tail: Promise<unknown>; listeners: Set<() => void> }
const queues = new WeakMap<PersistencePort, Queue>();
function queueFor(backend: PersistencePort): Queue {
  let queue = queues.get(backend);
  if (!queue) { queue = { tail: Promise.resolve(), listeners: new Set() }; queues.set(backend, queue); }
  return queue;
}

/** Serialize whole operations across entries, chat, timers and sync (not just
 * individual statements). Never infer reentrancy from a shared boolean: an
 * unrelated async caller can arrive while a transaction is suspended. */
export function runDatabaseOperation<T>(backend: PersistencePort, work: () => Promise<T>): Promise<T> {
  const queue = queueFor(backend);
  const next = queue.tail.then(work);
  queue.tail = next.then(() => undefined, () => undefined);
  return next;
}
export function notifyLocalChange(backend: PersistencePort): void {
  for (const listener of queueFor(backend).listeners) listener();
}
export function subscribeLocalChanges(backend: PersistencePort, listener: () => void): () => void {
  const listeners = queueFor(backend).listeners; listeners.add(listener);
  return () => { listeners.delete(listener); };
}
