export interface FlightState {
  position: [number, number, number];
  velocity: [number, number, number];
  orientation: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  throttle: number; // 0..1
  speed: number;
}

export interface ControlInput {
  pitch: number; // -1..1  (nose up/down)
  yaw: number;   // -1..1  (turn left/right)
  roll: number;  // -1..1  (bank left/right)
  throttle: number; // -1..1 (increase/decrease throttle)
}
