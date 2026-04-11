# Home Assistant Integration

SolarBuddy can publish its runtime state and controls to Home Assistant via the standard **MQTT Discovery** protocol. Once enabled, a single "SolarBuddy" device appears in Home Assistant with read-only sensors (SOC, current rate, current action) and writable entities (switches, selects, buttons) you can drive from automations, dashboards, and voice assistants.

The publisher connects to a **separately configured MQTT broker**, independent of the Solar Assistant broker SolarBuddy already uses for inverter telemetry. Typically this is the Mosquitto add-on running alongside Home Assistant.

The integration is **disabled by default**. No broker, credentials, or topics are touched until you explicitly enable it.

## Prerequisites

- A running Home Assistant instance with the MQTT integration configured and the discovery prefix set (default: `homeassistant`).
- An MQTT broker both Home Assistant and SolarBuddy can reach — commonly the [Mosquitto broker add-on](https://github.com/home-assistant/addons/tree/master/mosquitto) on the same host as Home Assistant.
- Host, port, and (optional) username/password for that broker.

## Enabling the integration

1. In SolarBuddy open **Settings → Connections → Home Assistant**.
2. Set **Enable Home Assistant Integration** to `Enabled`.
3. Fill in broker details:
   - **Broker Host** — hostname or IP of the Mosquitto broker.
   - **Broker Port** — usually `1883`.
   - **Username** / **Password** — if your broker requires authentication.
4. Leave **Base Topic** (`solarbuddy`) and **Discovery Prefix** (`homeassistant`) alone unless your Home Assistant MQTT integration uses a non-default prefix.
5. Click **Test Connection**. A short round-trip publishes and retracts a single discovery topic to verify the broker is reachable and credentials are correct.
6. Click **Save Settings**. SolarBuddy connects to the broker immediately, publishes every entity's discovery config (retained), and begins streaming state updates.

Within a few seconds Home Assistant auto-discovers a new device called **SolarBuddy** containing every entity in the catalog below. No YAML edits are required.

## Published entities

All entities live under a single Home Assistant device `SolarBuddy` with identifier `solarbuddy`. Unique IDs follow the pattern `solarbuddy_<key>` and remain stable across SolarBuddy restarts.

### Read-only sensors

| Entity | Component | Unit | Source |
| --- | --- | --- | --- |
| `sensor.solarbuddy_battery_soc` | sensor | % | Live inverter SOC |
| `sensor.solarbuddy_pv_power` | sensor | W | Live PV power |
| `sensor.solarbuddy_grid_power` | sensor | W | Signed grid power (+ import / − export) |
| `sensor.solarbuddy_load_power` | sensor | W | Home load power |
| `sensor.solarbuddy_battery_power` | sensor | W | Signed battery power |
| `sensor.solarbuddy_battery_temperature` | sensor | °C | Battery temperature |
| `sensor.solarbuddy_battery_voltage` | sensor | V | Battery pack voltage |
| `sensor.solarbuddy_inverter_temperature` | sensor | °C | Inverter temperature |
| `sensor.solarbuddy_current_rate` | sensor | GBP/kWh | Current Octopus Agile slot price |
| `sensor.solarbuddy_next_rate` | sensor | GBP/kWh | Next half-hour slot price |
| `sensor.solarbuddy_rate_status` | sensor | enum | `negative` / `best` / `cheap` / `average` / `expensive` |
| `sensor.solarbuddy_current_action` | sensor | enum | `charge` / `discharge` / `hold` — the planner's current resolved action |
| `sensor.solarbuddy_current_action_reason` | sensor | text | Human-readable explanation from the resolver |
| `sensor.solarbuddy_current_work_mode` | sensor | text | Inverter work mode read-back |
| `sensor.solarbuddy_last_updated` | sensor | timestamp | Last state update timestamp |
| `sensor.solarbuddy_runtime_mode` | sensor | enum | `real` / `virtual` — shows when Virtual Inverter mode is active |
| `binary_sensor.solarbuddy_mqtt_connected` | binary_sensor | connectivity | Solar Assistant MQTT health |
| `binary_sensor.solarbuddy_charging_active` | binary_sensor | power | True when the battery is actively charging from grid |
| `binary_sensor.solarbuddy_discharging_active` | binary_sensor | power | True when the battery is actively discharging |

### Writable controls

| Entity | Component | Options | What it does |
| --- | --- | --- | --- |
| `switch.solarbuddy_auto_schedule` | switch | ON/OFF | Toggles the `auto_schedule` setting and triggers a replan |
| `switch.solarbuddy_watchdog_enabled` | switch | ON/OFF | Toggles the inverter watchdog (same as the Settings → General toggle) |
| `switch.solarbuddy_smart_discharge` | switch | ON/OFF | Toggles smart discharge and triggers a replan |
| `select.solarbuddy_charging_strategy` | select | `night_fill` / `opportunistic_topup` | Switches strategy and triggers a replan |
| `select.solarbuddy_current_slot_override` | select | `none` / `charge` / `discharge` / `hold` | Writes an override for the current half-hour slot and immediately reconciles the inverter |
| `button.solarbuddy_replan_now` | button | — | Triggers `requestReplan()` |
| `button.solarbuddy_fetch_rates` | button | — | Fetches fresh Octopus Agile rates (no-op in Virtual Inverter mode) |
| `button.solarbuddy_clear_overrides` | button | — | Clears all manual overrides for today |
| `button.solarbuddy_reconcile_now` | button | — | Runs the watchdog reconciliation loop without replanning |

## Topic layout

All topics are composed from two settings:

- `homeassistant_base_topic` (default `solarbuddy`) — owns SolarBuddy's own state and command topics.
- `homeassistant_discovery_prefix` (default `homeassistant`) — matches the HA MQTT integration's discovery prefix.

| Purpose | Topic pattern |
| --- | --- |
| Availability (LWT + birth, retained) | `<base>/status` — payloads `online` / `offline` |
| Discovery config (retained) | `<discovery>/<component>/solarbuddy/<key>/config` |
| State | `<base>/<component>/<key>/state` |
| Command (writable switches / selects) | `<base>/<component>/<key>/set` |
| Command (buttons) | `<base>/<component>/<key>/press` |
| Home Assistant birth (subscribed) | `<discovery>/status` |

On connect, SolarBuddy publishes every discovery config (retained) and a full initial state snapshot, then subscribes to its command topics and the HA birth topic. When Home Assistant restarts and re-publishes `homeassistant/status = online`, SolarBuddy republishes every discovery config so entities reappear immediately.

## How state publishing is scheduled

Solar Assistant publishes telemetry to MQTT many times per second. Re-publishing every delta directly to Home Assistant would waste broker bandwidth and create noisy history graphs. SolarBuddy applies two rules:

1. **1-second debounced flush** — all telemetry-driven entities (battery_soc, pv_power, grid_power, etc.) are coalesced into a single publish burst at most once per second. Numeric tolerances (e.g. 5W for power, 1% for SOC, 0.5°C for temperatures) suppress nuisance deltas.
2. **60-second periodic tick** — tariff-driven and planner-driven entities (`current_rate`, `next_rate`, `rate_status`, `current_action`, `current_action_reason`) are refreshed once per minute, plus opportunistically whenever the shared state store changes.

On broker reconnect or on Home Assistant birth, SolarBuddy forces a full snapshot (every entity, including unchanged ones) so HA sees the latest values immediately.

## Example automations

**Force charge when the EV starts charging**

```yaml
automation:
  - alias: EV charging → SolarBuddy force charge
    trigger:
      - platform: state
        entity_id: binary_sensor.ev_charging
        to: 'on'
    action:
      - service: select.select_option
        target:
          entity_id: select.solarbuddy_current_slot_override
        data:
          option: charge
```

**Notify when the current rate turns negative**

```yaml
automation:
  - alias: SolarBuddy negative price alert
    trigger:
      - platform: state
        entity_id: sensor.solarbuddy_rate_status
        to: negative
    action:
      - service: notify.mobile_app
        data:
          title: Negative Agile rate
          message: >
            Current rate is {{ states('sensor.solarbuddy_current_rate') }} GBP/kWh.
```

**Trigger a replan after editing SolarBuddy settings from HA**

```yaml
automation:
  - alias: SolarBuddy nightly replan kick
    trigger:
      - platform: time
        at: '23:05:00'
    action:
      - service: button.press
        target:
          entity_id: button.solarbuddy_replan_now
```

## Virtual Inverter mode

The publisher runs identically when Virtual Inverter mode is enabled — the in-memory state store is populated by both the live MQTT path and the sandbox runtime. Telemetry sensors update from the active scenario, and the `sensor.solarbuddy_runtime_mode` sensor reads `virtual` so you can see at a glance that Home Assistant is looking at sandbox data.

Writable commands in virtual mode still update SolarBuddy's stored settings and overrides, but any command that would drive the real inverter is caught (the Solar Assistant MQTT client is not connected in sandbox). A warning is logged to the Activity feed and the command handler stays responsive.

`button.solarbuddy_fetch_rates` is a no-op in virtual mode — scenario rates come from the fixture, not Octopus.

## Troubleshooting

**Entities don't appear in Home Assistant.**
- Check **Settings → Connections → Home Assistant → Publisher Status**. If `Connected` is `No`, the last error is shown there.
- Confirm the MQTT integration in Home Assistant is using the same discovery prefix you configured in SolarBuddy (default `homeassistant`).
- Manually subscribe with `mosquitto_sub -h <host> -t '#' -v` and look for `homeassistant/sensor/solarbuddy/battery_soc/config` — it should be retained.

**Entities appear but are all "Unavailable".**
- SolarBuddy sets availability via a retained `<base>/status` topic. If you see `solarbuddy/status = offline`, the publisher disconnected or is still connecting. Save settings again or check the SolarBuddy logs.

**Duplicate SolarBuddy devices.**
- If you previously changed `homeassistant_base_topic`, the old discovery topics may still be retained on the broker. Clear them with `mosquitto_pub -h <host> -t 'homeassistant/sensor/solarbuddy/<key>/config' -r -n` for each stale entity, or use a broker UI (e.g. MQTT Explorer).

**Base topic rejected as invalid.**
- Base topic cannot be empty, contain whitespace, start/end with a slash, or be the literal string `homeassistant` (that would collide with the discovery prefix).

**HA doesn't see entity changes after SolarBuddy restart.**
- The publisher's on-connect burst should republish every discovery + state. If HA stays stale, republish HA's birth manually: `mosquitto_pub -h <host> -t 'homeassistant/status' -m online` — SolarBuddy reacts by republishing every discovery config.

## Related documentation

- [API Reference](api.md) — `POST /api/home-assistant/test` and `GET /api/home-assistant/status`
- [Software Architecture](architecture.md) — how the Home Assistant publisher fits into SolarBuddy's background services
