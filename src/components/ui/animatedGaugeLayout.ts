export interface GaugeDimensions {
  width: number;
  strokeWidth: number;
  fontSize: number;
  labelSize: number;
}

export interface AnimatedGaugeLayout {
  center: number;
  circumference: number;
  radius: number;
  svgHeight: number;
  unitY: number;
  valueY: number;
}

export function getAnimatedGaugeLayout(cfg: GaugeDimensions): AnimatedGaugeLayout {
  const radius = (cfg.width - cfg.strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const center = cfg.width / 2;
  const valueY = center - 4;
  const unitY = center + cfg.fontSize * 0.6;

  return {
    center,
    circumference,
    radius,
    svgHeight: Math.ceil(unitY + cfg.labelSize + cfg.strokeWidth),
    unitY,
    valueY,
  };
}
