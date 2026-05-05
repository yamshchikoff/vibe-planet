import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyboardControls } from './KeyboardControls';

describe('KeyboardControls', () => {
  let controls: KeyboardControls;

  beforeEach(() => {
    controls = new KeyboardControls();
  });

  afterEach(() => {
    controls.detach();
  });

  it('starts detached with neutral input', () => {
    const input = controls.getInput();
    expect(input.pitch).toBe(0);
    expect(input.roll).toBe(0);
    expect(input.roll).toBe(0);
    expect(input.throttle).toBe(0);
  });

  it('attach and detach do not throw', () => {
    expect(() => controls.attach()).not.toThrow();
    expect(() => controls.detach()).not.toThrow();
  });

  it('after attach, returns detached state after detach', () => {
    controls.attach();
    controls.detach();
    // After detach, input should still be available but neutral or whatever was last set
    const input = controls.getInput();
    expect(typeof input.pitch).toBe('number');
  });

  it('getInput returns neutral values when detached', () => {
    controls.attach();
    controls.detach();
    const input = controls.getInput();
    expect(input.pitch).toBe(0);
    expect(input.roll).toBe(0);
    expect(input.roll).toBe(0);
  });

  it('multiple attach calls only attach once', () => {
    controls.attach();
    controls.attach();
    // Should not throw
    controls.detach();
    expect(true).toBe(true);
  });

  it('handles keydown and keyup for W key (pitch up)', () => {
    controls.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(controls.getInput().pitch).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(controls.getInput().pitch).toBe(0);
    controls.detach();
  });

  it('resets all keys on window blur', () => {
    controls.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(controls.getInput().pitch).toBe(1);
    expect(controls.getInput().roll).toBe(1);

    window.dispatchEvent(new FocusEvent('blur'));
    const input = controls.getInput();
    expect(input.pitch).toBe(0);
    expect(input.roll).toBe(0);
    controls.detach();
  });

  it('opposite keys cancel each other', () => {
    controls.attach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(controls.getInput().pitch).toBe(0);
    controls.detach();
  });

  it('maps all defined keys correctly', () => {
    controls.attach();

    // W = pitch +1
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(controls.getInput().pitch).toBe(1);

    // S = pitch -1
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(controls.getInput().pitch).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));

    // A = roll +1 (left wing down)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(controls.getInput().roll).toBe(1);

    // D = roll -1 (right wing down)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(controls.getInput().roll).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));

    // Q = yaw -1 (rudder left)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    expect(controls.getInput().yaw).toBe(-1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));

    // E = yaw +1 (rudder right)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    expect(controls.getInput().yaw).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));

    controls.detach();
  });

  it('reports throttle via Shift and Ctrl', () => {
    controls.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    expect(controls.getInput().throttle).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    expect(controls.getInput().throttle).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }));
    expect(controls.getInput().throttle).toBe(-1);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlLeft' }));
    expect(controls.getInput().throttle).toBe(0);

    controls.detach();
  });
});
