# Virtual Inverter

Virtual Inverter mode lets SolarBuddy run as a safe sandbox against scripted synthetic telemetry instead of a live MQTT-connected inverter. It is intended for operator testing, UI walkthroughs, and planner experimentation without sending any real inverter commands.

## Behavior

- The mode is global to the running SolarBuddy instance.
- It is disabled by default and enabled from **Settings > Virtual Inverter**.
- While active, SolarBuddy serves status, rates, forecasts, schedules, and simulation data from the selected scenario.
- Outbound inverter actions are intercepted by the virtual command adapter and logged as simulated actions instead of being published to MQTT.
- Virtual telemetry and plan data are ephemeral. They live only in process memory and are not written into the normal SQLite readings, schedule-history, or MQTT-history tables.

## Preset Scenarios

SolarBuddy currently ships with four built-in scenarios:

- `overnight-recovery`: low battery with cheap overnight charging slots
- `sunny-surplus`: strong daytime PV and export opportunity
- `evening-peak`: expensive evening import with discharge opportunity
- `offline-recovery`: temporary connection loss followed by recovery

Each scenario provides:

- a scripted virtual clock
- synthetic telemetry for SOC, PV, load, grid, and battery power
- a tariff horizon and export-rate fixture
- an aligned PV forecast fixture

## Controls

Settings expose the following controls:

- enable or disable the global virtual runtime
- select the preset scenario
- choose playback speed
- override starting SOC for the next run
- apply a temporary load multiplier for the next run
- start, pause, or reset the current scenario

## Mode-Aware APIs

When virtual mode is active, these routes return scenario-backed data with the same response shape used in live mode:

- `/api/status`
- `/api/events`
- `/api/rates`
- `/api/forecast`
- `/api/schedule`
- `/api/simulate`
- `/api/system`

The dedicated control routes are:

- `GET /api/virtual-inverter`
- `POST /api/virtual-inverter`
- `GET /api/virtual-inverter/scenarios`

## Safety Contract

- SolarBuddy must not publish live MQTT inverter commands while virtual mode is active.
- The mode is explicitly operator-visible through the settings view, header badges, and the global virtual-mode banner.
- Disabling the mode restores the normal live runtime and allows SolarBuddy to reconnect to MQTT.
