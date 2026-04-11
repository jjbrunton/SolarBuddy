export async function register() {
  // Only run on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { connectMqtt } = await import('./lib/mqtt/client');
    const { startCronJobs } = await import('./lib/scheduler/cron');
    const { syncInverterWatchdogSetting } = await import('./lib/scheduler/watchdog');
    const { startReadingsIngestion } = await import('./lib/readings/ingest');
    const { scheduleStartupReplan } = await import('./lib/scheduler/reevaluate');
    const { syncVirtualInverterSetting, isVirtualModeEnabled } = await import('./lib/virtual-inverter/runtime');
    const { syncHomeAssistantSetting } = await import('./lib/home-assistant/runtime');

    console.log('[Init] Starting background services...');
    if (!isVirtualModeEnabled()) {
      connectMqtt();
    } else {
      await syncVirtualInverterSetting();
    }
    startCronJobs();
    syncInverterWatchdogSetting();
    startReadingsIngestion();
    scheduleStartupReplan();
    // HA publisher runs in both real and virtual modes — the shared state
    // store is populated identically.
    await syncHomeAssistantSetting();
  }
}
