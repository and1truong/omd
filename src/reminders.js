
/** Delivery is recorded before presentation, and serialized across tabs with Web Locks. */
export function startReminders(store, { deliver, onError, locks = globalThis.navigator?.locks,
  now = () => Date.now(), interval = 15000, timers = globalThis } = {}) {
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    const run = async () => {
      // A different tab may have delivered a reminder while this tab was suspended.
      await store.reload();
      for (const reminder of await store.dueReminders(now())) {
        const page = store.getPageMetadata(reminder.pageId);
        await store.dispatch('reminder_fired', { pageId: page.id, blockId: reminder.id, firedAt: new Date(now()).toISOString() }, { quiet: true, reminderBlockId:reminder.id, reminderPageId:page.id });
        await deliver({ ...reminder, pageId: page.id }, page.notificationMode);
      }
    };
    try { if (locks?.request) await locks.request('omd.reminder-delivery', run); else await run(); }
    catch (error) { onError?.(error); }
    finally { running = false; }
  }
  const timer = timers.setInterval(tick, interval);
  return { tick, stop() { stopped = true; timers.clearInterval(timer); } };
}
