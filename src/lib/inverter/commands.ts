import {
  setWorkMode as setRealWorkMode,
  setBatteryChargeRate as setRealBatteryChargeRate,
  startGridCharging as startRealGridCharging,
  stopGridCharging as stopRealGridCharging,
  startGridDischarge as startRealGridDischarge,
  stopGridDischarge as stopRealGridDischarge,
  startBatteryHold as startRealBatteryHold,
  setLoadFirstStopDischarge as setRealLoadFirstStopDischarge,
  setOutputSourcePriority as setRealOutputSourcePriority,
  setChargerSourcePriority as setRealChargerSourcePriority,
  setMaxGridChargeCurrent as setRealMaxGridChargeCurrent,
  setShutdownBatteryVoltage as setRealShutdownBatteryVoltage,
  syncDateTime as syncRealDateTime,
} from '@/lib/mqtt/commands';
import { handleVirtualCommand, isVirtualModeEnabled } from '@/lib/virtual-inverter/runtime';

export async function setWorkMode(mode: 'Grid first' | 'Battery first' | 'Load first') {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual work mode set to ${mode}.`, { workMode: mode });
    return;
  }
  await setRealWorkMode(mode);
}

export async function setBatteryChargeRate(rate: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual battery charge rate set to ${rate}%.`, { batteryFirstChargeRate: rate });
    return;
  }
  await setRealBatteryChargeRate(rate);
}

export async function startGridCharging(chargeRate: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual grid charging started at ${chargeRate}%.`, {
      action: 'charge',
      workMode: 'Grid first',
      batteryFirstChargeRate: chargeRate,
      outputSourcePriority: 'USB',
    });
    return;
  }
  await startRealGridCharging(chargeRate);
}

export async function stopGridCharging(defaultMode: 'Battery first' | 'Load first' = 'Battery first') {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual grid charging stopped. Restoring ${defaultMode}.`, {
      action: 'hold',
      workMode: defaultMode,
    });
    return;
  }
  await stopRealGridCharging(defaultMode);
}

export async function startGridDischarge(defaultMode: 'Battery first' | 'Load first' = 'Load first') {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual grid discharge started using ${defaultMode}.`, {
      action: 'discharge',
      workMode: defaultMode,
      outputSourcePriority: 'SBU',
    });
    return;
  }
  await startRealGridDischarge(defaultMode);
}

export async function stopGridDischarge(defaultMode: 'Battery first' | 'Load first' = 'Battery first') {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual grid discharge stopped. Restoring ${defaultMode}.`, {
      action: 'hold',
      workMode: defaultMode,
      outputSourcePriority: 'USB',
    });
    return;
  }
  await stopRealGridDischarge(defaultMode);
}

export async function startBatteryHold(currentSoc: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual battery hold applied at ${currentSoc}% stop-discharge threshold.`, {
      action: 'hold',
      workMode: 'Load first',
      outputSourcePriority: 'USB',
      loadFirstStopDischarge: currentSoc,
    });
    return;
  }
  await startRealBatteryHold(currentSoc);
}

export async function setLoadFirstStopDischarge(soc: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual stop-discharge threshold set to ${soc}%.`, {
      loadFirstStopDischarge: soc,
    });
    return;
  }
  await setRealLoadFirstStopDischarge(soc);
}

export async function setOutputSourcePriority(priority: string) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual output source priority set to ${priority}.`, {
      outputSourcePriority: priority,
    });
    return;
  }
  await setRealOutputSourcePriority(priority);
}

export async function setChargerSourcePriority(priority: string) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual charger source priority set to ${priority}.`);
    return;
  }
  await setRealChargerSourcePriority(priority);
}

export async function setMaxGridChargeCurrent(amps: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual max grid charge current set to ${amps}A.`);
    return;
  }
  await setRealMaxGridChargeCurrent(amps);
}

export async function setShutdownBatteryVoltage(voltage: number) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual shutdown battery voltage set to ${voltage}V.`);
    return;
  }
  await setRealShutdownBatteryVoltage(voltage);
}

export async function syncDateTime(formatted: string) {
  if (isVirtualModeEnabled()) {
    handleVirtualCommand(`Virtual inverter time sync requested for ${formatted}.`);
    return;
  }
  await syncRealDateTime(formatted);
}
