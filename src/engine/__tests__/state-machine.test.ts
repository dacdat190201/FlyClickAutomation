import {
  canTransition,
  EngineState,
  isActive,
  isTerminal,
  nextState,
  type EngineEvent,
} from '..';

const { IDLE, RUNNING, PAUSED, STOPPED, COMPLETED, ERROR } = EngineState;

describe('state machine', () => {
  it.each<[EngineState, EngineEvent, EngineState]>([
    [IDLE, 'start', RUNNING],
    [RUNNING, 'pause', PAUSED],
    [PAUSED, 'resume', RUNNING],
    [RUNNING, 'stop', STOPPED],
    [PAUSED, 'stop', STOPPED],
    [RUNNING, 'complete', COMPLETED],
    [RUNNING, 'fail', ERROR],
    [PAUSED, 'fail', ERROR],
    [STOPPED, 'start', RUNNING],
    [COMPLETED, 'start', RUNNING],
    [ERROR, 'start', RUNNING],
  ])('%s --%s--> %s', (from, event, to) => {
    expect(nextState(from, event)).toBe(to);
    expect(canTransition(from, event)).toBe(true);
  });

  it.each<[EngineState, EngineEvent]>([
    [RUNNING, 'start'], // no duplicate execution
    [PAUSED, 'start'],
    [IDLE, 'pause'],
    [IDLE, 'resume'],
    [IDLE, 'stop'],
    [RUNNING, 'resume'],
    [PAUSED, 'pause'],
    [PAUSED, 'complete'],
    [STOPPED, 'pause'],
    [STOPPED, 'stop'],
    [COMPLETED, 'resume'],
    [ERROR, 'stop'],
    [IDLE, 'complete'],
    [IDLE, 'fail'],
  ])('%s --%s--> rejected', (from, event) => {
    expect(nextState(from, event)).toBeNull();
    expect(canTransition(from, event)).toBe(false);
  });

  it('classifies active and terminal states', () => {
    expect([IDLE, RUNNING, PAUSED, STOPPED, COMPLETED, ERROR].map(isActive)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect([IDLE, RUNNING, PAUSED, STOPPED, COMPLETED, ERROR].map(isTerminal)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
