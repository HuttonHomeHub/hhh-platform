// One lock around every write that touches files and the database together (save a
// file then insert its row, rename a folder then update rows, restore), so the two
// can never disagree. Node runs one thing at a time, but these writes await in the
// middle, and two of them interleaving is exactly the race this prevents.
export type WithLock = <T>(work: () => T | Promise<T>) => Promise<T>;

export function createLock(): WithLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => T | Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined); // a failed write doesn't block the next one
    return run;
  };
}
